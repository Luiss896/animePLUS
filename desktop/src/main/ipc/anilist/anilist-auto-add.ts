import { appStore } from "@/main/store";

import { AniListRateLimitError } from "./anilist-api";
import { postAniListAuthedGraphql } from "./anilist-authed-api";

/**
 * Automatically adds announced or currently-airing sequels to the user's
 * AniList list.
 *
 * WHY THIS EXISTS
 * AniList does not link seasons together for you: finishing "Show S2" does not
 * put "Show S3" on your list, so a sequel can be airing for weeks without ever
 * appearing in the app. This module closes that gap by following the SEQUEL
 * relation from shows the user has actually engaged with.
 *
 * SAFETY RULES (this writes to a real account, so the bias is to do nothing):
 *  1. Opt-in only. Disabled unless "anilist.autoAddSequels" is explicitly true.
 *  2. PLANNING only. The list status is never set to CURRENT/COMPLETED, so
 *     nothing the user is tracking gets altered.
 *  3. Sources are limited to COMPLETED, CURRENT and REPEATING entries. A show
 *     sitting in PLANNING or DROPPED is not a signal that the user wants its
 *     sequel.
 *  4. Direct SEQUEL edges only. No prequels, spin-offs, side stories or
 *     adaptations, which would drag in unrelated entries.
 *  5. Already-listed media is never touched, whatever its status.
 *  6. A single bounded pass per invocation, with a hard cap, so a bad relation
 *     graph cannot spam the list.
 */

const AUTO_ADD_KEY = "anilist.autoAddSequels";

/** Hard ceiling on additions per run; a safety valve, not a target. */
const MAX_ADDITIONS_PER_RUN = 25;

/** List statuses that count as "the user cares about this show". */
const SOURCE_STATUSES = new Set(["COMPLETED", "CURRENT", "REPEATING"]);

/** Statuses worth adding: airing now, or announced. */
const WANTED_SEQUEL_STATUSES = new Set(["RELEASING", "NOT_YET_RELEASED"]);

export function isAutoAddSequelsEnabled(): boolean {
  return appStore.get(AUTO_ADD_KEY) === true;
}

export function setAutoAddSequelsEnabled(enabled: boolean): void {
  appStore.set(AUTO_ADD_KEY, enabled === true);
}

export interface PlannedAddition {
  mediaId: number;
  title: string;
  /** Title of the show on the user's list that led here. */
  fromTitle: string;
  status: string;
  season: string | null;
  seasonYear: number | null;
}

export interface AutoAddResult {
  /** False when the feature is off; the caller then does nothing. */
  enabled: boolean;
  added: PlannedAddition[];
  /** True when the cap was hit, so not everything found was added. */
  truncated: boolean;
  /** Set when the pass could not complete; additions already made still count. */
  error?: string;
}

const LOOKUP_QUERY = `
  query ($userId: Int, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      mediaList(userId: $userId, type: ANIME, sort: UPDATED_TIME_DESC) {
        status
        media {
          id
          title { english romaji userPreferred }
          relations {
            edges {
              relationType
              node {
                id
                status
                season
                seasonYear
                title { english romaji userPreferred }
              }
            }
          }
        }
      }
    }
  }
`;

const ADD_MUTATION = `
  mutation ($mediaId: Int) {
    SaveMediaListEntry(mediaId: $mediaId, status: PLANNING) {
      id
      status
    }
  }
`;

/** How many list entries are scanned for sequel relations. */
const SCAN_LIMIT = 100;

interface RawTitle {
  english?: string | null;
  romaji?: string | null;
  userPreferred?: string | null;
}

interface RawNode {
  id?: number | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  title?: RawTitle | null;
}

interface RawListEntry {
  status?: string | null;
  media?: {
    id?: number | null;
    title?: RawTitle | null;
    relations?: { edges?: ({ relationType?: string | null; node?: RawNode | null } | null)[] | null } | null;
  } | null;
}

function titleOf(t: RawTitle | null | undefined): string {
  return t?.english?.trim() || t?.romaji?.trim() || t?.userPreferred?.trim() || "Unknown title";
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * Find sequels worth adding, then add them.
 *
 * A single list query supplies both the existing media ids (to avoid touching
 * anything already there) and the SEQUEL relations, so this costs two requests
 * per run regardless of list size: one lookup, plus one mutation per addition.
 */
export async function autoAddMissingSequels(userId: number): Promise<AutoAddResult> {
  if (!isAutoAddSequelsEnabled()) {
    return { enabled: false, added: [], truncated: false };
  }

  const added: PlannedAddition[] = [];

  try {
    const data = await postAniListAuthedGraphql<{
      Page?: { mediaList?: (RawListEntry | null)[] | null } | null;
    }>(LOOKUP_QUERY, { userId, perPage: SCAN_LIMIT });

    const entries = (data.Page?.mediaList ?? []).filter(
      (e): e is RawListEntry => e != null && e.media != null
    );

    // Everything already on the list, so nothing existing is ever overwritten.
    const listedIds = new Set<number>();
    for (const entry of entries) {
      const id = entry.media?.id;
      if (isPositiveInt(id)) listedIds.add(id);
    }

    // Collect candidates, de-duplicated: several shows can share one sequel.
    const candidates = new Map<number, PlannedAddition>();
    for (const entry of entries) {
      if (!entry.status || !SOURCE_STATUSES.has(entry.status)) continue;
      const sourceId = entry.media?.id;
      if (!isPositiveInt(sourceId)) continue;
      const sourceTitle = titleOf(entry.media?.title ?? null);

      for (const edge of entry.media?.relations?.edges ?? []) {
        if (!edge || edge.relationType !== "SEQUEL") continue;
        const node = edge.node;
        if (!node || !isPositiveInt(node.id)) continue;
        // Rule 5: never touch something already on the list.
        if (listedIds.has(node.id)) continue;
        if (!node.status || !WANTED_SEQUEL_STATUSES.has(node.status)) continue;
        if (candidates.has(node.id)) continue;

        candidates.set(node.id, {
          mediaId: node.id,
          title: titleOf(node.title ?? null),
          fromTitle: sourceTitle,
          status: node.status,
          season: node.season ?? null,
          seasonYear: node.seasonYear ?? null,
        });
      }
    }

    const list = Array.from(candidates.values());
    const truncated = list.length > MAX_ADDITIONS_PER_RUN;
    const toAdd = list.slice(0, MAX_ADDITIONS_PER_RUN);

    for (const candidate of toAdd) {
      try {
        await postAniListAuthedGraphql(ADD_MUTATION, { mediaId: candidate.mediaId });
        added.push(candidate);
      } catch (error) {
        // A single failure (rate limit, deleted entry) must not abort the pass
        // and strand the remainder; report it and keep going only on rate limit.
        if (error instanceof AniListRateLimitError) {
          return {
            enabled: true,
            added,
            truncated,
            error: `Rate limited after ${added.length} addition(s).`,
          };
        }
        // Otherwise skip this candidate and continue.
      }
    }

    return { enabled: true, added, truncated };
  } catch (error) {
    if (error instanceof AniListRateLimitError) {
      return { enabled: true, added, truncated: false, error: "Rate limited during lookup." };
    }
    return {
      enabled: true,
      added,
      truncated: false,
      error: error instanceof Error ? error.message : "Auto-add failed.",
    };
  }
}

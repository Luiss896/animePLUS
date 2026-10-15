export const HIANIME_BASE = process.env.HIANIME_BASE || "https://hianime.at";
export const HIANIME_REFERER = `${HIANIME_BASE.replace(/\/$/, "")}/`;
/**
 * Chromium storage partition for the hidden provider window.
 *
 * NOTE: the `openanime-` prefix is a legacy storage identifier, deliberately NOT
 * renamed with the animePLUS rebrand. It is never shown to the user; changing it
 * would point the app at an empty profile and invalidate the provider cookies and
 * anti-bot challenge state that live there.
 */
export const HIANIME_PARTITION = "persist:openanime-hianime";

export function isHianimeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "hianime.at" || host.endsWith(".hianime.at");
}

export function isHianimeUrl(url: string): boolean {
  try {
    return isHianimeHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Slug id from search/watch URLs (`steinsgate-872`, `one-piece-1`). */
export function hianimeSlug(providerId: string): string {
  const trimmed = providerId.trim();
  const slug = trimmed.replace(/^\/(?:watch\/)?/, "").split(/[?#]/)[0] ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
    throw new Error(`Invalid HiAnime provider id: ${providerId}`);
  }
  return slug;
}

/**
 * Trailing numeric catalog id used by `/api/theme/episode/list/{id}`.
 * `steinsgate-0-2640` → `2640` (not the first hyphen suffix).
 *
 * ## Do NOT add a "looks like another provider's id" guard here
 *
 * An earlier revision rejected any id whose leading segment was numeric, on the
 * assumption that AnimeUnity's `{numericId}-{slug}` shape was distinguishable
 * from HiAnime's `{slug}-{numericId}` shape. That assumption is false: HiAnime
 * genuinely serves ids of the form `{digits}-{slug}`, and the site confirms it —
 * `https://hianime.at/7775-the-ramparts-of-ice-2` returns HTTP 200.
 *
 * The guard therefore broke real shows. Fetching episodes for
 * `7775-the-ramparts-of-ice-2` threw
 * "HiAnime provider id looks like another provider's id (leading numeric segment)",
 * which surfaced in the UI as a 502 on the watch page.
 *
 * The two id spaces overlap in shape and cannot be told apart from the string
 * alone. Callers must ensure the id came from the same provider they are passing
 * it to; see `providerIdBelongsToProvider` in the watch page for the (also
 * imperfect) cross-host handling.
 */
export function hianimeAnimeId(providerId: string): string {
  const slug = hianimeSlug(providerId);
  const match = /-(\d+)$/.exec(slug);
  if (!match?.[1]) {
    throw new Error(`Invalid HiAnime provider id: ${providerId}`);
  }
  return match[1];
}

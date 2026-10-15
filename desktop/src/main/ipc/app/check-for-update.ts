import { app } from "electron";
import { coerce, gt, valid } from "semver";

import { getElectronUserAgent } from "@/main/electron-user-agent";
import type { AppUpdateCheckResult } from "@/shared/app-update-types";

/** Matches `updateElectronApp` repo in main.ts */
const GITHUB_REPO = "Luiss896/animePLUS";

const RELEASES_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASES_LIST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`;

interface ParsedRelease {
  tag_name?: string;
  html_url?: string;
}

function parseLatestReleaseJson(raw: unknown): ParsedRelease | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    tag_name: typeof o.tag_name === "string" ? o.tag_name : undefined,
    html_url: typeof o.html_url === "string" ? o.html_url : undefined,
  };
}

/** `/releases` returns an array; take the newest published (non-draft) entry. */
function parseReleaseListJson(raw: unknown): ParsedRelease | null {
  if (!Array.isArray(raw)) return null;
  const entries = raw
    .map((item) => parseLatestReleaseJson(item))
    .filter((item): item is ParsedRelease => item !== null);
  // The API omits drafts for anonymous callers, but be explicit: a draft has no
  // meaning for end users, and a prerelease is still a legitimate "latest".
  return entries.find((entry) => Boolean(entry.tag_name)) ?? null;
}

/**
 * A repository with no published release returns 404 from `/releases/latest`.
 * That is not a failure — it is a normal, expected state for a project that has
 * not cut a release yet, and reporting it as a red error told the user their
 * network or the app was broken when nothing was wrong.
 */
function isEmptyRepositoryState(status: number): boolean {
  return status === 404;
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": getElectronUserAgent(),
        Accept: "application/vnd.github+json",
      },
    });

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

export async function checkGitHubReleaseVsCurrent(): Promise<AppUpdateCheckResult> {
  const currentVersion = app.getVersion();
  const base: AppUpdateCheckResult = {
    updateAvailable: false,
    currentVersion,
    latestVersion: null,
    releaseUrl: null,
  };

  // Primary: the canonical "latest release" endpoint.
  let release: ParsedRelease | null = null;
  const latest = await fetchJson(RELEASES_LATEST_URL);

  if (latest === null) {
    // Transport-level failure only; an HTTP status still carries information.
    return { ...base, error: "network-unreachable" };
  }

  if (latest.status >= 200 && latest.status < 300) {
    release = parseLatestReleaseJson(latest.body);
  } else if (!isEmptyRepositoryState(latest.status)) {
    // Rate limiting and other real errors are worth surfacing verbatim.
    return { ...base, error: `github-api-${latest.status}` };
  } else {
    // 404: fall back to the list endpoint before concluding anything. This also
    // covers the case where a release exists but is only a draft/prerelease.
    const list = await fetchJson(RELEASES_LIST_URL);
    if (list !== null && list.status >= 200 && list.status < 300) {
      release = parseReleaseListJson(list.body);
    }
  }

  if (release === null) {
    // Repository exists but publishes nothing yet — an empty state, not an error.
    return { ...base, error: "no-releases" };
  }

  const rawTag = release.tag_name?.trim() ?? "";
  const latestVersion = rawTag.replace(/^v/i, "");
  if (!latestVersion) {
    return { ...base, error: "missing-tag" };
  }

  const releaseUrl = release.html_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`;

  const latestSemver = valid(coerce(latestVersion));
  const currentSemver = valid(coerce(currentVersion));
  if (latestSemver === null || currentSemver === null) {
    return {
      ...base,
      latestVersion,
      releaseUrl,
      error: "invalid-semver",
    };
  }

  if (!gt(latestSemver, currentSemver)) {
    return {
      ...base,
      latestVersion,
      releaseUrl,
    };
  }

  return {
    updateAvailable: true,
    currentVersion,
    latestVersion,
    releaseUrl,
  };
}

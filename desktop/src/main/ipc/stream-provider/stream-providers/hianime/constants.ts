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
 * A leading numeric segment means this is another provider's id (AnimeUnity
 * publishes `{numericId}-{slug}`, e.g. `6722-dan-da-dan-2`). Without this guard
 * the trailing-number rule would read that id as catalog `2` and quietly look up
 * a completely different anime, which surfaced much later as a confusing
 * "episode not found". Failing loudly here names the real problem.
 */
export function hianimeAnimeId(providerId: string): string {
  const slug = hianimeSlug(providerId);
  if (/^\d+-/.test(slug)) {
    throw new Error(
      `HiAnime provider id looks like another provider's id (leading numeric segment): ${providerId}`
    );
  }
  const match = /-(\d+)$/.exec(slug);
  if (!match?.[1]) {
    throw new Error(`Invalid HiAnime provider id: ${providerId}`);
  }
  return match[1];
}

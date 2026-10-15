/**
 * Toggle stream providers without code changes.
 * Set `enabled: false` to hide a provider from settings and block its IPC routes.
 *
 * Selection rationale (measured, see docs section 8.3-bis):
 *
 * - `hianime` — PRIMARY. The only provider verified end-to-end from a real
 *   network: search -> episode list -> servers -> ZokoAnime embed -> HLS master,
 *   with the quality ladder confirmed at both 1920x1080 and 1422x800 depending
 *   on the episode. It also reports a full `qualities` list, which is what makes
 *   the player quality selector (and the 1080p warning) meaningful.
 * - `allanime` — FALLBACK. Also verified working (search returns HTTP 200 with a
 *   full catalogue in ~190 ms), and it is the only provider that already picks
 *   the highest rendition on its own. Kept enabled deliberately as redundancy:
 *   these sites break regularly, and a single-provider setup means the app is
 *   dead the moment its one upstream changes markup or blocks the CDN.
 *
 * - `animeunity` — ITALIAN SUB FALLBACK. Enabled because the other sources do not
 *   guarantee Italian subtitles for every episode. It publishes two entries per
 *   show and the `dub` flag separates them, so only the `dub: 0` release is used:
 *   Japanese audio with burned-in Italian subtitles. Verified end-to-end against
 *   the live site (search -> episode list -> embed -> HLS master carrying the
 *   1080p rendition, with segments downloadable through the local proxy).
 *
 * The remaining five stay disabled: they are compiled and instantiated anyway
 * (see `stream-providers.ts`), so re-enabling one is a one-line change here.
 */
export const streamProviderAvailability = {
  hianime: true,
  allanime: true,
  animeunity: true,
  anidb: false,
  animepahe: false,
  animeparadise: false,
  reanime: false,
  senshi: false,
} as const;

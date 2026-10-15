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
 *
 * - `animeunity` — ITALIAN SUB FALLBACK. Enabled because the other sources do not
 *   guarantee Italian subtitles for every episode. It publishes two entries per
 *   show and the `dub` flag separates them, so only the `dub: 0` release is used:
 *   Japanese audio with burned-in Italian subtitles. Verified end-to-end against
 *   the live site (search -> episode list -> embed -> HLS master carrying the
 *   1080p rendition, with segments downloadable through the local proxy).
 *
 * - `reanime` — DISABLED. Search, episode lists and subtitle tracks all work, and
 *   its subtitle conversion is verified, BUT it cannot play video: every playlist
 *   flixcloud serves contains **image** segments, never video. Measured by
 *   fetching a segment and reading its magic bytes for four shows (DAN DA DAN,
 *   Naruto, ONE PIECE, Jujutsu Kaisen):
 *
 *     video.m3u8          → Content-Type image/webp, body starts `RIFF....WEBP`
 *     audio/native.m3u8   → image/webp
 *     audio/english.m3u8  → image/png
 *
 *   ffmpeg reported this correctly all along (`Video: png` / `Video: webp`,
 *   "Output file is empty, nothing was encoded"); the master even advertises
 *   CODECS="avc1.64001f,mp4a.40.2" while serving images. Two genuine bugs in our
 *   own code were found and fixed on the way (playlist decryption keyed by the
 *   wrong id, and relative variant URIs handed to ffmpeg), so the remaining
 *   blocker is purely upstream.
 *
 * - `animeparadise` — DISABLED. It works technically (plain GET JSON API, HLS
 *   master with a 1080p/720p/480p ladder) but carries **no subtitle tracks at
 *   all**, and its raw API has no subtitle field. Italian subtitles are the main
 *   reason to fall back to a second source, so a provider without them adds a
 *   host to the menu and nothing else.
 *
 * `allanime` is DISABLED because its upstream broke in two ways at once
 * (verified against the live API, not inferred):
 *
 *   1. The `episode` query now requires a `translationType` argument. Without it
 *      the API answers `400 Bad Request` — which is the error the user saw.
 *      Adding it yields HTTP 200 but the body reports `AA_CRYPTO_MISSING`.
 *   2. That crypto (`aaReq`) must be extracted from the site's JS, and AllAnime
 *      has since obfuscated the bundle: the `__aaCrypto` marker is gone, no
 *      64-hex mask is present, and `graceMs` was removed. The app logs
 *      "could not fetch aaReq crypto, using fallback values" and is rejected.
 *
 * Search and details still work on allanime (they use the `shows` query, which
 * needs no crypto), so only streaming is affected. Re-enabling it is one line
 * here, but it will stay broken until the obfuscated crypto extraction is
 * reimplemented — a fragile job that breaks again on every upstream rebuild.
 *
 * ── Subtitle reality, measured across 15 popular titles ──────────────────────
 *
 * Italian subtitles are scarce on every source. Each provider below was tested
 * through the app's own `/stream` proxy — fetching subtitle URLs directly gives
 * a false negative, because the proxy is what rewrites `Content-Type` and
 * converts `.ass` to WebVTT (see `utils/ass-to-webvtt.ts`).
 *
 *   hianime  — 1 to 18 tracks per title; a **working Italian VTT on 4/15** titles
 *              (DAN DA DAN 356 cues, Chainsaw Man 218, Vinland Saga 533, Mob
 *              Psycho 100 421). Serves `.vtt` directly.
 *   reanime  — 3 to 14 tracks; an Italian track on 2/15 (DAN DA DAN 402 cues,
 *              Spy x Family 655). Serves `.ass`, which browsers cannot parse in a
 *              `<track>`; the proxy converts it, verified at `readyState 2` with
 *              402 cues loaded. Subtitle delivery works — but the provider is
 *              disabled because its video does not (see above).
 *   animeunity — 0 tracks on every title (subtitles are burned into the video).
 *   anidb      — search returns 0 results.
 *   animepahe  — search throws "returned invalid JSON".
 *   senshi     — search throws "fetch failed".
 *
 * So HiAnime is the only **enabled** source that delivers selectable subtitles,
 * and the only one that plays video and carries Italian tracks on some titles.
 *
 * The remaining four stay disabled: they are compiled and instantiated anyway
 * (see `stream-providers.ts`), so re-enabling one is a one-line change here.
 */
export const streamProviderAvailability = {
  hianime: true,
  allanime: false,
  animeunity: true,
  anidb: false,
  animepahe: false,
  animeparadise: false,
  reanime: false,
  senshi: false,
} as const;

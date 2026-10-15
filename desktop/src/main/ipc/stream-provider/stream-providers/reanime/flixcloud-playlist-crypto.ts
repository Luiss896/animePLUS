/**
 * Flixcloud CDN playlists are base64(XOR(plaintext, repeating __pk)).
 * `__pk` is the base64 of 32 bytes from WASM export `_c()` after `_s`/`_r`.
 * Patched hls.js on flixcloud.cc does the same transform before parsing #EXTM3U.
 *
 * ## Why the key is stored globally, not per video
 *
 * `__pk` is produced once per **embed session** by the WASM module, and the same
 * key decrypts every playlist of that session. It is NOT scoped to a video id.
 *
 * This used to be keyed by the `/_v7/{id}/` segment of the URL, which broke
 * playback in a way that looked unrelated to encryption:
 *
 *   master.m3u8      /_v7/30b0920b-55fe-4709-98b2-3531eb241994/  → key found, decrypted
 *   audio/native.m3u8 /_v7/AxnglPQldZPwBDOIrxRNFp3HofhyHwf7EdQ/  → key NOT found
 *   video.m3u8        /_v7/AxnglPQldZPwBDOIrxRNFp3HofhyHwf7EdQ/  → key NOT found
 *
 * Flixcloud serves the master and its child playlists under **different** `_v7`
 * ids, so the lookup missed and the children were passed through still
 * base64-encrypted. The stream proxy then rejected them as "not valid HLS"
 * (`missing #EXTM3U`) and answered 502, which surfaced to the user as
 * `ffmpeg duration probe failed … Server returned 5XX`.
 *
 * Keeping the most recent key globally fixes it and also matches the real
 * lifetime: one key per embed session, replaced when a new stream is prepared.
 */

/** The key for the most recently prepared embed session. */
let currentPlaylistKey: string | null = null;

/**
 * Last-resort fallback keyed by video id, kept only so a caller that registered a
 * key can still retrieve it after a newer session replaced the global one. The
 * global key is preferred because it is the one that matches how `__pk` works.
 */
const playlistKeysByVideoId = new Map<string, string>();

export function flixcloudVideoIdFromUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/_v7\/([^/]+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function registerFlixcloudPlaylistKey(streamUrl: string, playlistKey: string): void {
  if (!playlistKey) return;
  currentPlaylistKey = playlistKey;

  const videoId = flixcloudVideoIdFromUrl(streamUrl);
  if (videoId) playlistKeysByVideoId.set(videoId, playlistKey);
}

export function getFlixcloudPlaylistKey(streamUrl: string): string | null {
  // Preferred: the session key. Child playlists live under a different `_v7` id
  // than the master, so a per-id lookup alone is not enough.
  if (currentPlaylistKey) return currentPlaylistKey;

  const videoId = flixcloudVideoIdFromUrl(streamUrl);
  if (videoId) return playlistKeysByVideoId.get(videoId) ?? null;
  return null;
}

/**
 * Drop the cached session key. Called on sign-out of a stream so a later,
 * unrelated stream cannot be decrypted with a stale key.
 */
export function clearFlixcloudPlaylistKeys(): void {
  currentPlaylistKey = null;
  playlistKeysByVideoId.clear();
}

/**
 * Decrypt a Flixcloud playlist body when it is XOR-wrapped (not already #EXTM3U).
 * Returns null if decryption fails or the body is not a playlist ciphertext.
 */
export function decryptFlixcloudPlaylistBody(
  body: string | Buffer,
  playlistKeyB64: string
): string | null {
  const text = typeof body === "string" ? body : body.toString("utf8");
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#EXTM3U")) return trimmed;

  try {
    const key = Buffer.from(playlistKeyB64, "base64");
    if (key.length === 0) return null;
    const cipher = Buffer.from(trimmed, "base64");
    if (cipher.length === 0) return null;

    const plain = Buffer.alloc(cipher.length);
    for (let i = 0; i < cipher.length; i++) {
      plain[i] = cipher[i]! ^ key[i % key.length]!;
    }
    const decoded = plain.toString("utf8");
    if (!decoded.trimStart().startsWith("#EXTM3U")) return null;
    return decoded;
  } catch {
    return null;
  }
}

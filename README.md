<img src="./assets/openanime-logo.png" width="128"/>

# animePLUS

[Features](#features) | [Watch party](#watch-party) | [Stream sources](#stream-sources) | [Installation](#installation) | [Building](#building) | [Contributing](#contributing) | [License](#license)

![Home page](./assets/home.png)

**animePLUS** is a desktop anime app for Windows and macOS. It follows a provider-based
architecture: one source at a time drives search, episode lists and playback, and you can switch
source in the middle of an episode without losing your place.

Built and maintained by **Luiss896**.

## Features

### Playback

- **Live host switching.** Change stream source while an episode is playing. The app finds the same
  show on the target source, keeps your position, and reloads the stream. Useful when one source is
  missing an episode, or carries no Italian subtitles for it.
- **Intro skip.** A `Skip intro` button appears over the video during the opening and jumps 90
  seconds ahead. It hides itself once used, and never appears later in the episode.
- **Subtitle controls.** Pick a track (including Italian when the source carries one), turn
  subtitles off, and adjust text size, background opacity and colour. Appearance is remembered
  between sessions.
- **Anime4K upscaling over WebGPU**, with selectable presets (A, B, C, A+A, GAN) and native-resolution
  output: the shader renders to your monitor's pixel grid instead of letting the compositor rescale
  the result. Output can also be pinned to 1080p, 1440p or 4K.
- **Quality warning** when a stream has no 1080p rendition, naming the highest resolution that
  actually exists for that episode.
- **Automatic recovery.** A dropped stream reconnects and resumes on its own before the manual
  retry overlay appears.

### Library

- **AniList integration.** Your list drives the _Following_ page (what airs today and what comes
  next), _Continue watching_, progress sync and the bookmarks and favourites pages. Announced
  sequels of shows you are watching can be added to your list automatically.
- **Continue watching** keeps one card per show, with playback progress, and a control to remove a
  show from the row.
- **History** lists everything watched, most recent first, with local playback progress.
- **Incognito mode** stops watching from touching local history or AniList progress.

### Sources

- **Recently uploaded** from the active source, so new episodes are one click away.
- **Search** with source-specific filters when the source offers them.
- Graceful degradation: providers that cannot currently stream are disabled rather than shown as
  broken options. See [Stream sources](#stream-sources) for what is enabled and why.

## Watch party

Two people can watch the same episode in sync from a room of two. One side hosts, the other joins,
and the host controls playback.

- **Two transports.** LAN for machines on the same network (address and 6 digit PIN), or internet
  with a pair of invite codes exchanged by chat. The internet transport is WebRTC, so no account and
  no server are involved.
- **Timeline synchronisation, not video forwarding.** Each peer resolves its own stream and the
  peers exchange only what is being watched: episode, pause, seek. Drift is corrected gradually
  (playback rate nudges under 1.5 seconds, a seek above it), and video never has to pass through the
  connection.
- **Episode handoff.** When the host changes episode, the guest follows automatically and loads its
  own copy of the stream.
- **Honest connection state.** A slow handshake is reported as waiting, not as an error. A red error
  is reserved for a connection that genuinely failed.

Rooms are limited to two peers by design.

## Stream sources

Sources are toggled in `desktop/src/shared/stream-providers.config.ts`. Every provider is compiled
and instantiated regardless, so enabling or disabling one is a one line change.

| Source                   | Status   | Notes                                                                                                                                                                                             |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HiAnime**              | Enabled  | Primary. Reports a full quality ladder, so the quality selector and the 1080p warning mean something. The only enabled source that carries selectable subtitles, Italian included on some titles. |
| **AnimeUnity**           | Enabled  | Italian fallback. Japanese audio with **Italian subtitles burned into the video**, so they cannot be toggled, and the subtitle panel says so instead of showing dead controls.                    |
| Reanime                  | Disabled | Subtitles work (many `.ass` tracks per show, converted to WebVTT on the fly), but it **cannot play video**: every playlist its CDN serves contains image segments. See the note below.            |
| AllAnime                 | Disabled | Upstream broke: the `episode` query now requires `translationType`, and its request signing crypto has to be scraped from an obfuscated bundle.                                                   |
| AnimeParadise            | Disabled | Works, but carries no subtitle tracks at all.                                                                                                                                                     |
| AniDB, AnimePahe, Senshi | Disabled | Search currently fails or returns nothing.                                                                                                                                                        |

> **On Reanime:** its master playlist advertises `CODECS="avc1.64001f,mp4a.40.2"` while every segment
> it serves is an image. Measured across four shows by reading the segment magic bytes
> (`RIFF....WEBP`, `image/png`). Nothing in the app can play that, so the source is off.

> **On Italian subtitles:** no free source carries them for every title. Coverage was measured across
> 15 popular shows: HiAnime had a working Italian track on 4, Reanime on 2 (but it cannot play
> video). If a show has no Italian track, switch host from the player and check again. AnimeUnity
> guarantees Italian subtitles, at the cost of them being permanent and burned in.

> **On source domains:** providers move. AnimeUnity has changed site domain and player domain more
> than once, which is why its host is resolved at runtime from a candidate list instead of being
> hardcoded. If a source suddenly returns nothing, that resolution is the first place to look.

## Installation

### Windows

Download the latest `animePLUS-*.Setup.exe` from the [releases page](../../releases) and run it.

The build is not code signed, so SmartScreen may warn you on first launch. Choose _More info_ then
_Run anyway_, or verify the source yourself: the full source is in this repository.

### macOS

Download the latest `animePLUS-darwin-arm64-*.zip` from the [releases page](../../releases) and
unzip it (Apple Silicon).

The app is not signed or notarized, so macOS attaches a `com.apple.quarantine` flag and Gatekeeper
may refuse to launch it. Clearing that flag is the workaround:

```bash
xattr -cr /Applications/animePLUS.app
```

Downloading an app from outside the App Store attaches `com.apple.quarantine` to it. If the app is
not correctly signed, Gatekeeper blocks it. Running `xattr -cr` on the application folder wipes those
flags, so macOS treats the file as locally created and allows it to run.

### Linux

Not supported, and no Linux packages are produced. Building from source is the only option, see
[Building](#building). The Linux makers are not configured, so `npm run make` produces the Windows
and macOS artifacts only.

## Building

Requires Node.js 20 or newer.

```bash
# from the desktop/ directory
npm install
npm start          # development, with dev server and hot reload
```

To produce a distributable build:

```bash
npm run make       # installers for the current platform
# or
npm run package    # unpacked app in out/
```

FFmpeg is downloaded automatically on install and before packaging. The binary is not committed to
the repository.

> **Note for AniList login:** the OAuth redirect uses a custom deep link scheme
> (`animeplus://auth/anilist/callback`). If you fork this project, register your own client ID and a
> matching redirect URI in the AniList API settings, otherwise the Connect AniList flow fails at the
> callback step.

### Release process

Pushing a tag that matches `v*.*.*` builds both platforms on GitHub Actions and publishes the
artifacts as a GitHub release, through `.github/workflows/release.yml`. Version bumps belong in
`desktop/package.json`.

## Screenshots

### Player and subtitle controls

Pick a track, Italian included when the source carries it, then adjust text size, background opacity
and colour. The appearance settings are remembered between sessions.

![Player with subtitle controls open](./assets/player-subtitles.png)

### Following

What airs today and what comes next, straight from your AniList list. Every card opens the show in
the app, not in a browser.

![Following page](./assets/following.png)

### Search

![Search page](./assets/search.png)

### Show details

![Show details page](./assets/show-details.png)

### Settings

![Settings page](./assets/settings.png)

## Contributing

See [desktop/CONTRIBUTING.md](./desktop/CONTRIBUTING.md) for the development setup and the
conventions this codebase follows. Bug reports and provider fixes are welcome; for a provider that
broke upstream, include the failing request from the app log (Settings, then Logs, then Open).

## Legal

animePLUS is a client application. It does **not** host, store, or distribute any video content. All
media is fetched from third party services chosen by the user.

## License

[AGPL-3.0-or-later](./LICENSE), Copyright (C) 2025 Luiss896.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU
Affero General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

**In short:** you may read, run and modify this code, but any redistributed or network hosted version
must remain open source under the same license and must keep the attribution intact. Taking this
code, closing it, and shipping it as your own proprietary product is not permitted. See
[NOTICE](./NOTICE) for the additional terms under section 7 of the AGPL.

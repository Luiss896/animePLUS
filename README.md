<img src="./assets/openanime-logo.png" width="128"/>

# animePLUS

[Features](#features) | [Installation](#installation) | [Building](#building) | [License](#license)

![Home Page Screen](./assets/home.png)

**animePLUS** is an easy-to-use desktop anime application with a provider-based architecture. The current provider implementation builds on ideas from [pystardust/ani-cli](https://github.com/pystardust/ani-cli), while keeping the app ready for additional providers over time.

Built and maintained by **Luiss896**.

## Features

- Stay up to date with the most recently uploaded anime
- Browse and search for a specific anime series
- Sub / dub support
- **Anime4K upscaling over WebGPU** with selectable presets (A, B, C, A+A, GAN)
- **Native-resolution output**: the shader renders straight to your monitor's pixel grid (e.g. 1080p → 1440p at 1:1), instead of letting the compositor rescale the result
- Adjustable output resolution: source, display, 1080p, 1440p or 4K
- Quality warning when a stream has no 1080p rendition available

## Installation

### Windows

Download the latest `animePLUS-*.Setup.exe` from the [releases page](../../releases) and run it.

The build is not code-signed, so SmartScreen may warn you on first launch. Choose *More info → Run anyway*, or verify the source yourself — the full source is in this repository.

### OSX

Download the latest `animePLUS-darwin-arm64-*.zip` from the [releases page](../../releases).

Since the application is not signed or notarized, you will have to run this command via terminal:

```bash
xattr -cr /Applications/animePLUS.app
```

**Why do I need to do this?**

When you download an app from outside the App Store, macOS attaches a `com.apple.quarantine` attribute to it. If the app isn't digitally signed correctly, Gatekeeper may block it. Running `xattr -cr` on the application folder wipes those security flags, essentially "tricking" macOS into thinking the file was created locally rather than downloaded, allowing it to run.

### Linux (Experimental)

`.rpm` and `.deb` packages are published with each release. Linux is not actively optimized — if something is broken, please open an issue.

## Building

Requires Node.js 20+.

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

FFmpeg is downloaded automatically on install and before packaging; the binary is not committed to the repository.

> **Note for AniList login:** the OAuth redirect uses a custom deep-link scheme (`animeplus://auth/anilist/callback`). If you fork this project, you must register your own client ID and matching redirect URI in the AniList API settings, otherwise the "Connect AniList" flow will fail at the callback step.

## Additional Screenshots

![Search Page](./assets/search.png)

![Show Details Page](./assets/show-details.png)

## Legal

animePLUS is a client application. It does **not** host, store, or distribute any video content. All media is fetched from third-party services chosen by the user.

## License

[AGPL-3.0-or-later](./LICENSE) — Copyright (C) 2025 Luiss896.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

**In short:** you may read, run and modify this code, but any redistributed or network-hosted version must remain open source under the same license and must keep the attribution intact. Taking this code, closing it, and shipping it as your own proprietary product is not permitted. See [NOTICE](./NOTICE) for the additional terms under section 7 of the AGPL.

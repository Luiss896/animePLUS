import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const isWindows = process.platform === "win32";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: "./public/icon",
    protocols: [
      {
        name: "animePLUS",
        schemes: ["animeplus"],
      },
    ],
    // Must match `package.json` `name` — MakerDeb looks up the binary by that name.
    // If this differs (e.g. "openanime"), the .deb step fails on Linux CI.
    executableName: "animePLUS",
    /**
     * Ship ffmpeg alongside the app so the main process can execute it from a
     * packaged build. The binary is downloaded into bin/ by scripts/download-ffmpeg.mjs
     * (npm install / package) — it is not committed.
     */
    extraResource: isWindows ? ["bin/ffmpeg.exe"] : ["bin/ffmpeg"],
  },
  rebuildConfig: {},
  makers: [new MakerSquirrel({}), new MakerZIP({}, ["darwin"]), new MakerRpm({}), new MakerDeb({})],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
        },
        {
          entry: "src/main/preload.ts",
          config: "vite.preload.config.ts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "Luiss896",
          name: "animePLUS",
        },
        /*
         * `draft` MUST be set explicitly. PublisherGithub tests
         * `draft: config.draft !== false`, so omitting it creates a *draft*
         * release. A draft is invisible to the public releases API and to
         * logged-out visitors, which looks identical to "nothing was published"
         * even though the CI step reports success.
         *
         * `prerelease` was true, which would have marked a normal 1.0.0 release
         * as a prerelease.
         */
        draft: false,
        prerelease: false,
      },
    },
  ],
};

export default config;

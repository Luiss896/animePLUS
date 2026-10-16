import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";

/**
 * Provide the `7z.exe` that Squirrel.Windows shells out to.
 *
 * `make` on Windows failed for several sessions with
 * `CreateZipFromDirectory … Win32Exception (0x80004005): the system cannot find
 * the file specified`. It was **not** a missing 7-Zip installation: Squirrel.exe
 * contains the invocation `a "{0}" -tzip -aoa -y -mmt on *` and hardcodes the
 * bare command name **`7z.exe`**, which it launches **relative to its current
 * working directory**. `electron-winstaller` spawns Squirrel with no `cwd`
 * option, so the child inherits the Forge process directory — this project root —
 * and looks for `7z.exe` *there*. Nothing ever placed it there, so the process
 * launch failed and Squirrel reported the failure as a failed extraction.
 *
 * The vendored `7z-x64.exe` cannot satisfy the lookup either: the file name
 * differs. It is therefore copied in under the exact name Squirrel asks for,
 * together with its DLL.
 *
 * Note this is a local-development problem only — CI has a 7-Zip install the
 * lookup happens to find. The file is generated, never committed.
 */
function stageSevenZipForSquirrel(): void {
  const vendor = path.resolve(__dirname, "node_modules/electron-winstaller/vendor");
  const source = path.join(vendor, "7z-x64.exe");
  if (!existsSync(source)) return;
  // `__dirname` is the directory holding this config, which is also the working
  // directory Forge runs in and Squirrel therefore inherits.
  try {
    copyFileSync(source, path.join(__dirname, "7z.exe"));
    const dll = path.join(vendor, "7z-x64.dll");
    if (existsSync(dll)) copyFileSync(dll, path.join(__dirname, "7z.dll"));
  } catch {
    // Staging is best effort: if it fails, Squirrel reports its own error.
  }
}

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
    executableName: "animePLUS",
    /**
     * Ship ffmpeg alongside the app so the main process can execute it from a
     * packaged build. The binary is downloaded into bin/ by scripts/download-ffmpeg.mjs
     * (npm install / package) — it is not committed.
     */
    extraResource: isWindows ? ["bin/ffmpeg.exe"] : ["bin/ffmpeg"],
  },
  rebuildConfig: {},
  /*
   * Windows and macOS only. The Linux makers (deb/rpm) were removed along with
   * the Linux CI job: they shell out to `dpkg`/`fakeroot` (declared as
   * `requiredExternalBinaries`), which made the job fail before it produced
   * anything, and Linux is not a target for now.
   */
  makers: [new MakerSquirrel({}), new MakerZIP({}, ["darwin"])],
  hooks: {
    /*
     * Stage 7z.exe before and after the makers run: the release directory may not
     * exist yet on the first pass, and Squirrel deletes/recreates it during make.
     * The hooks are declared to return a promise because Forge requires one.
     */
    preMake: () => {
      if (isWindows) stageSevenZipForSquirrel();
      return Promise.resolve();
    },
    postMake: (_forgeConfig, makeResults) => {
      if (isWindows) stageSevenZipForSquirrel();
      // Returning the results unchanged keeps Forge's default behaviour.
      return Promise.resolve(makeResults);
    },
  },
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

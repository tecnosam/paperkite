import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Real macOS signing + notarization only activates once a Developer ID
// Application certificate is imported into the runner's keychain (see
// .github/workflows/release-browser.yml's "Import Apple code-signing
// certificate" step) and these three secrets are set. Without them,
// `osxSign`/`osxNotarize` are left undefined below and electron-packager
// falls back to its default ad-hoc-only signing, same as today - this
// keeps `npm run make` working locally with no Apple account at all,
// and lets the real thing turn on by adding secrets, no code change
// needed. (Ad-hoc-only builds fail Gatekeeper's assessment once
// downloaded/quarantined - "is damaged and can't be opened" - which is
// exactly what real signing + notarization fixes.)
const macSigningConfigured = Boolean(process.env.APPLE_TEAM_ID);

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // electron-packager appends .icns on macOS and .ico on Windows
    // automatically; Linux packages don't embed an icon this way, see
    // the makers below instead.
    icon: './assets/icon',
    ...(macSigningConfigured
      ? {
          // No `identity` given - @electron/osx-sign auto-discovers the
          // single "Developer ID Application" identity in the active
          // keychain, which the CI import step guarantees is the only
          // one present. Avoids hardcoding a certificate name that
          // breaks the moment the cert is renewed.
          osxSign: {},
          osxNotarize: {
            appleId: process.env.APPLE_ID!,
            appleIdPassword: process.env.APPLE_ID_PASSWORD!,
            teamId: process.env.APPLE_TEAM_ID!,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ setupIcon: './assets/icon.ico' }),
    // A plain zip you unzip and run directly (no dpkg/rpm/Squirrel
    // install, no root/admin) - the .deb/.rpm/.exe below are for users
    // who want a real package-manager/installer experience, this is for
    // everyone else, and it's architecture-agnostic in a way a system
    // package manager isn't. Also the only Windows arm64 artifact right
    // now, since MakerSquirrel's arm64 support is unverified (see
    // packaging/README.md) - win32 is included here specifically so
    // there's always a working fallback if Squirrel fails for that arch.
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    new MakerRpm({ options: { icon: './assets/icon.png' } }),
    new MakerDeb({ options: { icon: './assets/icon.png' } }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/chrome.ts',
          config: 'vite.preload.chrome.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/preload/chat.ts',
          config: 'vite.preload.chat.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/preload/pageTranslate.ts',
          config: 'vite.preload.pageTranslate.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'chrome_window',
          config: 'vite.renderer.chrome.config.ts',
        },
        {
          name: 'chat_window',
          config: 'vite.renderer.chat.config.ts',
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
};

export default config;

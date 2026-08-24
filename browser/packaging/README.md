# Packaging

`.github/workflows/release-browser.yml` (at the repo root) builds installers
for Windows and Linux (x64 and arm64) whenever a `browser-v*` tag is
pushed (see the top-level README's "Releasing" section for the full
bump → tag → push flow), and attaches them, plus a
`checksums/<platform>-<arch>-checksums.txt` file per build, to a GitHub
Release created from that tag. No signing, no notarization, no external
servers, all of that needs its own paid/managed setup and is deliberately
left out for now.

**macOS isn't built by CI right now.** `forge.config.ts` already has
`osxSign`/`osxNotarize` wired up (activates automatically once
`MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PWD`, `APPLE_ID`,
`APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID` are set as repo secrets - a real
Apple Developer Program membership is required for those), but without
them a CI-built `.app` only gets ad-hoc signed, which fails Gatekeeper's
assessment the moment it's downloaded ("is damaged and can't be opened") -
not something worth shipping. Until those credentials exist, Mac users
build from source instead:

```bash
cd browser
npm install
npm run make          # produces out/make/zip/darwin/<arch>/paperkite-browser-darwin-<arch>-<version>.zip
```

Since it's built locally rather than downloaded, there's no quarantine
flag and no Gatekeeper prompt - just unzip and run. Once real signing
credentials are added, re-add `{ os: macos-latest, platform: darwin }` to
the matrix in `release-browser.yml` and this section goes back to
describing a normal downloadable release.

**Windows arm64 is cross-compiled, not natively built.** GitHub doesn't
offer a free arm64 Windows-hosted runner, so that build runs on the same
`windows-latest` (x64) runner as the regular Windows build, via
`electron-forge make --arch=arm64`. This works for packaging itself (no
native/node-gyp dependencies here, so electron-packager just fetches the
prebuilt win32/arm64 Electron distribution and repackages it - confirmed
locally), but two things follow from not having real arm64 Windows
hardware anywhere in this pipeline: the Squirrel installer (`Setup.exe`)
is genuinely untested on arm64 (it needs Wine+Mono to even attempt
building off Windows, so it could only be checked by real CI on real
Windows - if it turns out broken there, drop Squirrel for this arch and
keep the zip), and CI's own smoke test is skipped for this build (an x64
Windows runner can't execute an arm64 `.exe` to test it). Treat the
arm64 zip as: builds and packages correctly, but not been confirmed to
actually launch on a real arm64 Windows machine yet.

## Installing a release directly

No package manager needed, just grab the right file from the release page:

| Platform | File | Install |
|----------|------|---------|
| Windows (x64) | `paperkite-browser-<version> Setup.exe` | Run it. Unsigned, so SmartScreen will warn once, "More info" → "Run anyway". |
| Windows (arm64) | `paperkite-browser-win32-arm64-<version>.zip` | Cross-compiled on the x64 runner (see below) - unzip and run `paperkite-browser.exe` rather than relying on a Setup.exe here, since the Squirrel installer isn't verified working for arm64 yet. |
| Linux (any distro, x64) | `paperkite-browser-linux-x64-<version>.zip` | Unzip, run `./paperkite-browser`. No install, no root. |
| Linux (any distro, arm64) | `paperkite-browser-linux-arm64-<version>.zip` | Same, unzip and run. |
| Linux (Debian/Ubuntu, x64) | `paperkite-browser_<version>_amd64.deb` | `sudo dpkg -i paperkite-browser_<version>_amd64.deb` |
| Linux (Debian/Ubuntu, arm64) | `paperkite-browser_<version>_arm64.deb` | `sudo dpkg -i paperkite-browser_<version>_arm64.deb` |
| Linux (Fedora/RHEL, x64) | `paperkite-browser-<version>-1.x86_64.rpm` | `sudo rpm -i paperkite-browser-<version>-1.x86_64.rpm` |
| Linux (Fedora/RHEL, arm64) | `paperkite-browser-<version>-1.aarch64.rpm` | `sudo rpm -i paperkite-browser-<version>-1.aarch64.rpm` |

The `.deb`/`.rpm` install into the system properly (desktop entry, icon,
`apt`/`dnf` bookkeeping) but need the right architecture - installing an
x64 package on an arm64 machine (or vice versa) doesn't fail loudly, it
just silently doesn't work (GNOME Software in particular will spin
forever on "Install" without ever erroring). If you're not sure which
architecture you're on (`uname -m`: `x86_64` = x64, `aarch64`/`arm64` =
arm64) or just want to try it without installing anything, the zip is the
safer default.

## Homebrew

[`homebrew/paperkite.rb`](homebrew/paperkite.rb) is a ready-to-use Cask
template for once macOS releases are back - it isn't usable yet for two
independent reasons: Homebrew resolves casks from a repo literally named
`homebrew-<tapname>` (so `tecnosam/homebrew-paperkite` needs to exist),
and casks pointing at an ad-hoc-signed, unnotarized `.app` hit the same
Gatekeeper wall described above, just via `brew install` instead of a
browser download. Both need the real signing credentials in place first
(see above); once they are, and CI is building macOS again:

1. Create a repo named `tecnosam/homebrew-paperkite` (empty is fine).
2. Copy `homebrew/paperkite.rb` into that repo's `Casks/` folder, filling
   in `version` and `sha256` from a release's `darwin-checksums.txt`.
3. `brew tap tecnosam/paperkite && brew install --cask paperkite`

Keeping that file's version/checksum in sync on every release is itself
automatable (a CI job in the tap repo, or a step here that pushes to it
with a repo-scoped token), left out here since it needs that second repo
provisioned first.

## apt / a real Linux package repository

The `.deb` and `.rpm` files above install fine directly, but there's no
hosted `apt`/`dnf` repository (`apt install paperkite-browser`) here. A
real one needs a signed, indexed repository (`reprepro`/`aptly` plus a
GPG key) hosted somewhere with a stable URL, e.g. GitHub Pages or a
package host like Cloudsmith or PackageCloud. That's exactly the kind of
extra infrastructure this setup intentionally skips for now. If you want
it later, GitHub Pages + `reprepro` is the lowest-cost option since it
doesn't need a server, just a signing key and a scheduled publish step.

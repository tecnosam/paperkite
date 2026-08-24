## Homebrew Cask template for Paperkite.
##
## This file is NOT wired into any tap yet. Homebrew resolves casks by
## looking in a repo literally named `homebrew-<tapname>` (e.g.
## `tecnosam/homebrew-paperkite`), so this only becomes `brew install
## --cask paperkite` once that tap repo exists and this file (with the
## placeholders below filled in) is copied into its `Casks/` folder.
## See ../README.md for the full setup note.
##
## The release workflow (.github/workflows/release-browser.yml, at the
## repo root) writes a `checksums/darwin-checksums.txt` file to every
## GitHub Release it creates, which has the sha256 you need for the
## `sha256` line below.
##
## Only Apple Silicon (arm64) is built right now, see ../README.md for
## what it'd take to add an Intel build too.

cask "paperkite" do
  version "1.0.0"
  sha256 "REPLACE_WITH_SHA256_FROM_RELEASE_CHECKSUMS_TXT"

  url "https://github.com/tecnosam/paperkite/releases/download/v#{version}/paperkite-browser-darwin-arm64-#{version}.zip"
  name "Paperkite"
  desc "Open-source browser with a built-in chat room for every page"
  homepage "https://github.com/tecnosam/paperkite"

  depends_on arch: :arm64

  app "paperkite-browser.app"

  zap trash: [
    "~/Library/Application Support/paperkite-browser",
    "~/Library/Preferences/com.paperkite.browser.plist",
    "~/Library/Saved Application State/com.paperkite.browser.savedState",
  ]
end

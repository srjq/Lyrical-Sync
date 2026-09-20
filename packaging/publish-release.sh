#!/usr/bin/env bash
set -euo pipefail

REPO="srjq/Lyrical-Sync"
TAG="v0.6.1"
TITLE="v0.6.1 — Linux, Windows, and macOS Multi-Platform Release"
NOTES_FILE="RELEASE_NOTES.md"
ASSETS_DIR="release-assets"

if ! command -v gh &>/dev/null; then
  echo "Error: gh (GitHub CLI) is not installed." >&2
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "GitHub CLI is not authenticated."
  echo "Please authenticate using one of the following methods:"
  echo "  1. Run: gh auth login"
  echo "  2. Or set: export GH_TOKEN=your_personal_access_token"
  echo ""
  echo "Then re-run this script: ./packaging/publish-release.sh"
  exit 1
fi

echo "Publishing release $TAG to $REPO..."

ASSETS=(
  "$ASSETS_DIR/Lyrical Sync_0.6.1_amd64.AppImage"
  "$ASSETS_DIR/lyrical-sync-0.6.1-1-x86_64.pkg.tar.zst"
  "$ASSETS_DIR/Lyrical Sync_0.6.1_amd64.deb"
  "$ASSETS_DIR/Lyrical Sync-0.6.1-1.x86_64.rpm"
  "$ASSETS_DIR/Lyrical.Sync_0.6.1_x64-setup.exe"
  "$ASSETS_DIR/Lyrical.Sync_0.6.1_x64.msi"
  "$ASSETS_DIR/Lyrical.Sync_0.6.1_x64-setup.exe.sig"
  "$ASSETS_DIR/Lyrical.Sync_0.6.1_aarch64.dmg"
  "$ASSETS_DIR/Lyrical.Sync_aarch64.app.tar.gz"
  "$ASSETS_DIR/Lyrical.Sync_aarch64.app.tar.gz.sig"
  "$ASSETS_DIR/latest.json"
  "$ASSETS_DIR/sha256sums.txt"
)

# Check if release already exists
if gh release view "$TAG" --repo "$REPO" &>/dev/null; then
  echo "Release $TAG already exists on $REPO. Uploading / overwriting assets..."
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
  gh release edit "$TAG" --title "$TITLE" --notes-file "$NOTES_FILE" --repo "$REPO"
else
  echo "Creating new release $TAG on $REPO..."
  gh release create "$TAG" "${ASSETS[@]}" \
    --repo "$REPO" \
    --title "$TITLE" \
    --notes-file "$NOTES_FILE"
fi

echo "Successfully published release $TAG to https://github.com/$REPO/releases/tag/$TAG"

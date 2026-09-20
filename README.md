<div align="center">

# 🎵 Lyrical Sync

**A fast, modern desktop app for creating, syncing, and editing LRC lyric files.**

[한국어](README.ko.md) • [日本語](README.ja.md)

[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-blue?style=flat-square)](https://github.com/srjq/Lyrical-Sync/releases)
[![Version](https://img.shields.io/badge/version-0.6.1-green?style=flat-square)](https://github.com/srjq/Lyrical-Sync/releases/tag/v0.6.1)
[![License](https://img.shields.io/badge/license-MIT-purple?style=flat-square)](LICENSE)

<br/>

![Lyrical Sync Preview](img/main_en.png)

</div>

---

## ✨ Features

- ⏱️ **Real-Time & Word-Level Sync** — Tap <kbd>Space</kbd> to stamp lines live, or paint character-by-character timing (Enhanced LRC / A2).
- 🤖 **AI Auto-Alignment** — Align lyrics automatically using MMS-300M (1,100+ languages) with optional Demucs vocal separation and VAD.
- 🎧 **Spotify & YouTube Integration** — Sync live playback from your Spotify app or load audio directly from YouTube URLs.
- 🌊 **Interactive Waveform** — Seek, zoom, and nudge markers with instant karaoke preview and customizable themes.
- 🔄 **Smart Editing Tools** — Bulk offset, time scaling, split, merge, undo/redo, and drag-and-drop line reordering.
- 🌐 **LRCLIB & Multi-Format Export** — Search and publish to LRCLIB. Export to LRC, Enhanced LRC, SRT, WebVTT, and ASS.

---

## 🚀 Installation

Download the latest release for your platform from **[Releases](https://github.com/srjq/Lyrical-Sync/releases)**:

### 🐧 Linux

| Package | Target Distribution | Quick Command |
|---|---|---|
| **AppImage** | Universal (any 64-bit Linux) | `chmod +x *.AppImage && ./*.AppImage` |
| **.pkg.tar.zst** | Arch Linux / CachyOS / Manjaro | `sudo pacman -U lyrical-sync-*.pkg.tar.zst` |
| **.deb** | Ubuntu / Debian / Linux Mint | `sudo apt install ./*.deb` |
| **.rpm** | Fedora / openSUSE / RHEL | `sudo dnf install ./*.rpm` |

<details>
<summary><b>Linux system prerequisites</b></summary>

Ensure WebKit2GTK and GStreamer plugins are installed:
- **Arch / CachyOS**: `sudo pacman -S webkit2gtk-4.1 gst-plugins-base gst-plugins-good gst-plugins-bad libsecret`
- **Debian / Ubuntu**: `sudo apt install libwebkit2gtk-4.1-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good libsecret-1-0`
- **Fedora**: `sudo dnf install webkit2gtk4.1 gstreamer1-plugins-base gstreamer1-plugins-good libsecret`
</details>

### 🍏 macOS

Download `.dmg` from [Releases](https://github.com/srjq/Lyrical-Sync/releases) and drag to `/Applications`.

<details>
<summary><b>Unsigned app note (Gatekeeper)</b></summary>

If macOS displays a developer verification prompt, run once in Terminal:
```bash
xattr -cr /Applications/Lyrical\ Sync.app
```
</details>

### 🪟 Windows

Download `.msi` or `_x64-setup.exe` from [Releases](https://github.com/srjq/Lyrical-Sync/releases) and run the installer.

<details>
<summary><b>SmartScreen note</b></summary>

If Windows SmartScreen warns of an unknown publisher, click **More info** → **Run anyway**.
</details>

---

## ⌨️ Shortcuts

All shortcuts can be remapped in **Settings → Shortcuts**.

| Key | Action | Key | Action |
|:---|:---|:---|:---|
| <kbd>Space</kbd> | Stamp line + move next | <kbd>3</kbd> | Play / Pause |
| <kbd>Backspace</kbd> | Move to previous line | <kbd>1</kbd> / <kbd>5</kbd> | Skip ∓5s |
| <kbd>Enter</kbd> | Insert new line below | <kbd>2</kbd> / <kbd>4</kbd> | Skip ∓1s |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Split line at caret | <kbd>6</kbd> | Reset to 0:00 |
| <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> | Undo / Redo | <kbd>Ctrl/⌘</kbd>+<kbd>F</kbd> | Find & Replace |

---

## 🛠️ Development

```bash
# Clone & install dependencies
git clone https://github.com/srjq/Lyrical-Sync.git
cd Lyrical-Sync
npm install

# Start development server
npm run tauri dev

# Build production bundle
npm run tauri build

# Run test suite
npm test
```

---

<div align="center">

Licensed under [MIT](LICENSE). Originally created by [Tsukimori Ahri](https://github.com/AHRI2nd).

</div>

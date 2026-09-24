# Lyrical Sync v0.6.1 — Multi-Platform Release

Lyrical Sync is a modern desktop application for creating, synchronizing, and editing `.lrc` and Enhanced LRC lyric files with AI-powered alignment, Spotify integration, and YouTube audio extraction.

This release introduces comprehensive **Linux** support alongside the existing **Windows** and **macOS** platforms.

---

## What's New in v0.6.1 (Linux Support & Port)

- **Linux Platform Support**: Built and tested natively for Linux using WebKit2GTK and GStreamer.
- **AI Auto-Sync on Linux**: Linux x86_64 `python-build-standalone` embedded runtime with automatic virtualenv bootstrapping for `ctc-forced-aligner` and `demucs`.
- **Linux YouTube Audio Extraction**: Native Linux `yt-dlp` binary management and caching.
- **Linux Secret Service / Keyring**: Integrated Secret Service (`libsecret`) backend for secure Spotify PKCE OAuth token storage across Linux desktop sessions.
- **Desktop Integration**: Linux desktop application entry (`.desktop`), standard icon sets (32x32 to 512x512), Audio/Video categories, and MIME associations for `.lrc` and `.srt` files.
- **Codebase Standardization**: Full translation of non-English codebase comments to English.
- **Comprehensive Distribution Packages**: Pre-built packages for Arch Linux, Debian/Ubuntu, Fedora/RHEL/openSUSE, and a portable AppImage.

---

## Downloads

### Linux
| File | Size | Target OS / Distribution | Description |
|---|---|---|---|
| [`Lyrical Sync_0.6.1_amd64.AppImage`](Lyrical%20Sync_0.6.1_amd64.AppImage) | ~178 MB | Universal Linux (x86_64) | Standalone portable AppImage with bundled runtime libraries |
| [`lyrical-sync-0.6.1-1-x86_64.pkg.tar.zst`](lyrical-sync-0.6.1-1-x86_64.pkg.tar.zst) | ~5.6 MB | Arch Linux, CachyOS, Manjaro, EndeavourOS | Native Arch package installable via `pacman -U` |
| [`Lyrical Sync_0.6.1_amd64.deb`](Lyrical%20Sync_0.6.1_amd64.deb) | ~7.9 MB | Debian, Ubuntu, Linux Mint, Pop!_OS | Native Debian package installable via `apt` / `dpkg` |
| [`Lyrical Sync-0.6.1-1.x86_64.rpm`](Lyrical%20Sync-0.6.1-1.x86_64.rpm) | ~7.9 MB | Fedora, RHEL, CentOS, Rocky Linux, openSUSE | Native RPM package installable via `dnf` / `zypper` |

### Windows
| File | Size | Target OS | Description |
|---|---|---|---|
| [`Lyrical.Sync_0.6.1_x64-setup.exe`](Lyrical.Sync_0.6.1_x64-setup.exe) | ~4.3 MB | Windows 10 / 11 (x64) | Standard NSIS installer |
| [`Lyrical.Sync_0.6.1_x64.msi`](Lyrical.Sync_0.6.1_x64.msi) | ~6.2 MB | Windows 10 / 11 (x64) | Windows Installer package |
| [`Lyrical.Sync_0.6.1_x64-setup.exe.sig`](Lyrical.Sync_0.6.1_x64-setup.exe.sig) | 424 B | Windows (x64) | Tauri updater signature |

### macOS
| File | Size | Target OS | Description |
|---|---|---|---|
| [`Lyrical.Sync_0.6.1_aarch64.dmg`](Lyrical.Sync_0.6.1_aarch64.dmg) | ~6.9 MB | macOS 11+ (Apple Silicon) | Drag-and-drop disk image |
| [`Lyrical.Sync_aarch64.app.tar.gz`](Lyrical.Sync_aarch64.app.tar.gz) | ~6.6 MB | macOS (Apple Silicon) | Application bundle archive for updater |
| [`Lyrical.Sync_aarch64.app.tar.gz.sig`](Lyrical.Sync_aarch64.app.tar.gz.sig) | 412 B | macOS | Tauri updater signature |

---

## Installation Guide

### Linux

#### AppImage
```bash
chmod +x "Lyrical Sync_0.6.1_amd64.AppImage"
./"Lyrical Sync_0.6.1_amd64.AppImage"
```

#### Arch Linux / CachyOS / Manjaro
```bash
sudo pacman -U lyrical-sync-0.6.1-1-x86_64.pkg.tar.zst
```

#### Debian / Ubuntu / Linux Mint / Pop!_OS
```bash
sudo apt install ./"Lyrical Sync_0.6.1_amd64.deb"
```

#### Fedora / RHEL / openSUSE
```bash
# Fedora / RHEL:
sudo dnf install ./"Lyrical Sync-0.6.1-1.x86_64.rpm"

# openSUSE:
sudo zypper install ./"Lyrical Sync-0.6.1-1.x86_64.rpm"
```

### Windows
Run `Lyrical.Sync_0.6.1_x64-setup.exe` or `Lyrical.Sync_0.6.1_x64.msi`.
If SmartScreen shows an unrecognized application prompt, click **More info** → **Run anyway**.

### macOS
Open `Lyrical.Sync_0.6.1_aarch64.dmg` and drag `Lyrical Sync.app` to your `/Applications` folder.
To bypass the Gatekeeper quarantine for unsigned builds:
```bash
xattr -cr /Applications/Lyrical\ Sync.app
```

---

## SHA-256 Checksums

```text
818e03fcb76953e80a887c01ec6ee8b428f5e8ff5082690841c2a65c515ba474  latest.json
702633ab708863e827444f18125a3ba406ed906aebe1f79c7c287400a2929e00  lyrical-sync-0.6.1-1-x86_64.pkg.tar.zst
7b70db0ea72e9cd3c472506fda3757266d64d9574fadfd7ba5cca476804e4927  Lyrical Sync-0.6.1-1.x86_64.rpm
dd00ccd06afc282dd345f2a03fa8ea942fcf3361a193e7ac71729e54bc84bd1b  Lyrical.Sync_0.6.1_aarch64.dmg
378762a7a47282570100fc38bf988ee18f66fe70aebb24be4bad102dc71f0954  Lyrical Sync_0.6.1_amd64.AppImage
85226645f7f050157ace0d76e899d6d00e371d7ea5845058e435f43c79cbf169  Lyrical Sync_0.6.1_amd64.deb
142ce25020e2546ee318ba378193917ef633ce4522e746efa9502390fe953c80  Lyrical.Sync_0.6.1_x64.msi
834aba9a5264fae275c8165614e8a9bf8e054c3505df1bbd5cf2127ac90175c1  Lyrical.Sync_0.6.1_x64-setup.exe
0270a99a243551be9ae059e8bc2176cad2a03bef3a46b216d2863554b2172658  Lyrical.Sync_0.6.1_x64-setup.exe.sig
f798d760fbf7ac3b5bb355e601ee8f8d325d0e54b783d90bba69393b5d7eefd0  Lyrical.Sync_aarch64.app.tar.gz
61373e5377b5d4bf7cd6ccfc9f57dc5f50bfeac88f71c0c1c69c8b5e0e395efa  Lyrical.Sync_aarch64.app.tar.gz.sig
```

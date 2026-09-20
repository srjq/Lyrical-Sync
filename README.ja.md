<div align="center">

# 🎵 Lyrical Sync

**`.lrc`（LRC）歌詞ファイルを作成・同期・編集するための高速でモダンなデスクトップアプリ。**

[English](README.md) • [한국어](README.ko.md)

[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-blue?style=flat-square)](https://github.com/srjq/Lyrical-Sync/releases)
[![Version](https://img.shields.io/badge/version-0.6.1-green?style=flat-square)](https://github.com/srjq/Lyrical-Sync/releases/tag/v0.6.1)
[![License](https://img.shields.io/badge/license-MIT-purple?style=flat-square)](LICENSE)

<br/>

![Lyrical Sync Preview](img/main_ja.png)

</div>

---

## ✨ 主な機能

- ⏱️ **リアルタイム & 単語単位の同期** — <kbd>Space</kbd> キーで再生に合わせて同期、文字単位のタイミング（Enhanced LRC / A2）も直感的にペイント可能。
- 🤖 **AI 自動同期** — MMS-300M（1,100以上の言語に対応）と Demucs によるボーカル分離・VAD 検出を活用した自動アライメント。
- 🎧 **Spotify & YouTube 連携** — Spotify アプリの再生とリアルタイム同期、または YouTube URL から音声を直接読み込み。
- 🌊 **波形表示 & ビジュアル編集** — ドラッグ操作可能なマーカー付き波形、微調整コントロール、リアルタイムカラオケプレビュー。
- 🔄 **スマートな編集機能** — 一括オフセット、テンポ伸縮、行の分割・結合、アンドゥ/リドゥ、ドラッグ＆ドロップによる並び替え。
- 🌐 **LRCLIB 対応 & 多様な書き出し** — LRCLIB からの歌詞検索・投稿に対応。LRC、Enhanced LRC、SRT、WebVTT、ASS 出力をサポート。

---

## 🚀 インストール

お使いの OS に合わせた最新ビルドを **[Releases](https://github.com/srjq/Lyrical-Sync/releases)** ページからダウンロードしてください：

### 🐧 Linux

| 形式 | 対象ディストリビューション | インストールコマンド |
|---|---|---|
| **AppImage** | 汎用（主要な 64bit Linux） | `chmod +x *.AppImage && ./*.AppImage` |
| **.pkg.tar.zst** | Arch Linux / CachyOS / Manjaro | `sudo pacman -U lyrical-sync-*.pkg.tar.zst` |
| **.deb** | Ubuntu / Debian / Linux Mint | `sudo apt install ./*.deb` |
| **.rpm** | Fedora / openSUSE / RHEL | `sudo dnf install ./*.rpm` |

<details>
<summary><b>Linux の前提パッケージ</b></summary>

WebKit2GTK および GStreamer プラグインがインストールされていることを確認してください：
- **Arch / CachyOS**: `sudo pacman -S webkit2gtk-4.1 gst-plugins-base gst-plugins-good gst-plugins-bad libsecret`
- **Debian / Ubuntu**: `sudo apt install libwebkit2gtk-4.1-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good libsecret-1-0`
- **Fedora**: `sudo dnf install webkit2gtk4.1 gstreamer1-plugins-base gstreamer1-plugins-good libsecret`
</details>

### 🍏 macOS

[Releases](https://github.com/srjq/Lyrical-Sync/releases) から `.dmg` をダウンロードし、アプリケーションフォルダへドラッグします。

<details>
<summary><b>未署名アプリの警告について（Gatekeeper）</b></summary>

セキュリティ警告が表示される場合は、ターミナルで一度だけ以下を実行してください：
```bash
xattr -cr /Applications/Lyrical\ Sync.app
```
</details>

### 🪟 Windows

[Releases](https://github.com/srjq/Lyrical-Sync/releases) から `.msi` または `_x64-setup.exe` をダウンロードしてインストーラーを実行します。

<details>
<summary><b>SmartScreen の警告について</b></summary>

Windows Defender SmartScreen が「不明な発行元」を表示した場合は、**詳細情報** → **実行** をクリックしてください。
</details>

---

## ⌨️ ショートカット

すべてのキー割り当ては **設定 → ショートカット** からいつでも変更できます。

| キー | 動作 | キー | 動作 |
|:---|:---|:---|:---|
| <kbd>Space</kbd> | 現在行を記録して次へ | <kbd>3</kbd> | 再生 / 一時停止 |
| <kbd>Backspace</kbd> | 前の行へ移動 | <kbd>1</kbd> / <kbd>5</kbd> | -5秒 / +5秒スキップ |
| <kbd>Enter</kbd> | 下に新しい行を挿入 | <kbd>2</kbd> / <kbd>4</kbd> | -1秒 / +1秒スキップ |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | カーソル位置で行を分割 | <kbd>6</kbd> | 停止して 0:00 へ戻す |
| <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> | 元に戻す / やり直す | <kbd>Ctrl/⌘</kbd>+<kbd>F</kbd> | 検索と置換 |

---

## 🛠️ 開発

```bash
# クローンと依存関係のインストール
git clone https://github.com/srjq/Lyrical-Sync.git
cd Lyrical-Sync
npm install

# 開発サーバーの起動
npm run tauri dev

# プロダクションビルド
npm run tauri build

# テスト実行
npm test
```

---

<div align="center">

ライセンス: [MIT](LICENSE) • 原作者: [Tsukimori Ahri](https://github.com/AHRI2nd)

</div>

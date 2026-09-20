<div align="center">

# 🎵 Lyrical Sync

**`.lrc`(LRC) 가사 파일을 만들고, 동기화하고, 편집하기 위한 빠르고 현대적인 데스크톱 앱.**

[English](README.md) • [日本語](README.ja.md)

[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-blue?style=flat-square)](https://github.com/srjq/Lyrical-Sync/releases)
[![Version](https://img.shields.io/badge/version-0.6.1-green?style=flat-square)](https://github.com/srjq/Lyrical-Sync/releases/tag/v0.6.1)
[![License](https://img.shields.io/badge/license-MIT-purple?style=flat-square)](LICENSE)

<br/>

![Lyrical Sync Preview](img/main_ko.png)

</div>

---

## ✨ 주요 기능

- ⏱️ **실시간 & 글자 단위 싱크** — <kbd>Space</kbd> 키로 재생에 맞춰 실시간 태깅, 글자 단위 타이밍(Enhanced LRC / A2)도 브러시처럼 간편하게 지정.
- 🤖 **AI 자동 싱크 정렬** — MMS-300M(1,100+ 언어 지원) 모델과 Demucs 보컬 분리 및 VAD를 통한 높은 정확도의 자동 싱크.
- 🎧 **Spotify & YouTube 연동** — Spotify 재생 트랙과 실시간 연동 및 YouTube URL에서 직접 오디오 추출.
- 🌊 **인터랙티브 파형 편집** — 드래그 가능한 마커가 있는 파형, 미세 시간 조절, 실시간 노래방 프리뷰 지원.
- 🔄 **스마트 라인 편집** — 일괄 오프셋, 타임스탬프 배율 조절, 줄 분할/병합, 실행취소/다시실행, 드래그 순서 변경.
- 🌐 **LRCLIB 지원 & 다양한 내보내기** — LRCLIB 데이터베이스 연동 및 LRC, Enhanced LRC, SRT, WebVTT, ASS 포맷 지원.

---

## 🚀 설치

**[Releases](https://github.com/srjq/Lyrical-Sync/releases)** 페이지에서 운영체제에 맞는 최신 빌드를 다운로드하세요:

### 🐧 Linux

| 패키지 | 대상 배포판 | 설치 명령어 |
|---|---|---|
| **AppImage** | 범용 (모든 64비트 Linux) | `chmod +x *.AppImage && ./*.AppImage` |
| **.pkg.tar.zst** | Arch Linux / CachyOS / Manjaro | `sudo pacman -U lyrical-sync-*.pkg.tar.zst` |
| **.deb** | Ubuntu / Debian / Linux Mint | `sudo apt install ./*.deb` |
| **.rpm** | Fedora / openSUSE / RHEL | `sudo dnf install ./*.rpm` |

<details>
<summary><b>Linux 시스템 요구 사항</b></summary>

WebKit2GTK 및 GStreamer 플러그인이 설치되어 있는지 확인하세요:
- **Arch / CachyOS**: `sudo pacman -S webkit2gtk-4.1 gst-plugins-base gst-plugins-good gst-plugins-bad libsecret`
- **Debian / Ubuntu**: `sudo apt install libwebkit2gtk-4.1-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good libsecret-1-0`
- **Fedora**: `sudo dnf install webkit2gtk4.1 gstreamer1-plugins-base gstreamer1-plugins-good libsecret`
</details>

### 🍏 macOS

[Releases](https://github.com/srjq/Lyrical-Sync/releases)에서 `.dmg`를 다운로드하여 응용 프로그램 폴더로 드래그합니다.

<details>
<summary><b>미확인 개발자 앱 안내 (Gatekeeper)</b></summary>

보안 경고 창이 나타나는 경우, 터미널에서 다음 명령어를 1회 실행하세요:
```bash
xattr -cr /Applications/Lyrical\ Sync.app
```
</details>

### 🪟 Windows

[Releases](https://github.com/srjq/Lyrical-Sync/releases)에서 `.msi` 또는 `_x64-setup.exe`를 다운로드하여 실행합니다.

<details>
<summary><b>SmartScreen 경고 안내</b></summary>

Windows Defender SmartScreen이 "알 수 없는 게시자"를 표시하면 **추가 정보** → **실행**을 클릭하세요.
</details>

---

## ⌨️ 단축키

모든 단축키는 **설정 → 단축키**에서 원하는 대로 변경할 수 있습니다.

| 키 | 동작 | 키 | 동작 |
|:---|:---|:---|:---|
| <kbd>Space</kbd> | 현재 줄 찍기 + 다음 줄 | <kbd>3</kbd> | 재생 / 일시정지 |
| <kbd>Backspace</kbd> | 이전 줄로 이동 | <kbd>1</kbd> / <kbd>5</kbd> | -5초 / +5초 스킵 |
| <kbd>Enter</kbd> | 아래에 새 줄 삽입 | <kbd>2</kbd> / <kbd>4</kbd> | -1초 / +1초 스킵 |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | 커서 위치에서 줄 분할 | <kbd>6</kbd> | 정지 후 0:00으로 |
| <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> | 실행취소 / 다시실행 | <kbd>Ctrl/⌘</kbd>+<kbd>F</kbd> | 찾기 & 바꾸기 |

---

## 🛠️ 개발

```bash
# 저장소 클론 및 패키지 설치
git clone https://github.com/srjq/Lyrical-Sync.git
cd Lyrical-Sync
npm install

# 개발 서버 실행
npm run tauri dev

# 프로덕션 빌드
npm run tauri build

# 테스트 실행
npm test
```

---

<div align="center">

[MIT](LICENSE) 라이선스로 배포됩니다 • 원작자: [Tsukimori Ahri](https://github.com/AHRI2nd)

</div>

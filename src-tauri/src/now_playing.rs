// Detect and control currently playing media (Spotify desktop app, Apple Music, browser playback, etc.)
// regardless of source app. Windows uses official WinRT API (Windows.Media.Control),
// macOS uses the adapter bundled in resources/mediaremote-adapter/ (see macOS module comments below).
// On other platforms, compiles to a stub that always returns empty results.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct NowPlayingInfo {
    title: String,
    artist: String,
    album: String,
    position_ms: i64,
    duration_ms: i64,
    is_playing: bool,
    source_app: String,
    /// Last timeline update time based on Unix epoch (ms) — used as anchor by frontend when
    /// interpolating against Date.now() (same technique as Spotify mode).
    last_updated_unix_ms: i64,
}

#[cfg(target_os = "windows")]
mod platform {
    use super::NowPlayingInfo;
    use tauri::AppHandle;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    // Difference between WinRT DateTime epoch (1601-01-01 UTC) and Unix epoch (1970-01-01 UTC) in 100ns ticks.
    const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

    // tokio worker threads do not have COM initialized by default, which may be needed before WinRT calls.
    // Safe to call again on already initialized threads (ignores failure — usually means "already initialized").
    fn ensure_com_initialized() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    pub async fn get_now_playing(_app: &AppHandle) -> Result<Option<NowPlayingInfo>, String> {
        ensure_com_initialized();

        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;

        let session = match manager.GetCurrentSession() {
            Ok(s) => s,
            Err(_) => return Ok(None), // No active session
        };

        let media_props = session
            .TryGetMediaPropertiesAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;

        let title = media_props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = media_props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let album = media_props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();

        // If both title and artist are empty, effectively treat as "nothing playing"
        if title.is_empty() && artist.is_empty() {
            return Ok(None);
        }

        let timeline = session.GetTimelineProperties().map_err(|e| e.to_string())?;
        let playback_info = session.GetPlaybackInfo().map_err(|e| e.to_string())?;

        let position_ticks = timeline.Position().map(|t| t.Duration).unwrap_or(0);
        let end_ticks = timeline.EndTime().map(|t| t.Duration).unwrap_or(0);
        let last_updated_ticks = timeline.LastUpdatedTime().map(|d| d.UniversalTime).unwrap_or(0);
        let last_updated_unix_ms = (last_updated_ticks - EPOCH_DIFF_TICKS) / 10_000;

        let status_raw = playback_info.PlaybackStatus().map(|s| s.0).unwrap_or(0);
        let is_playing = status_raw == 4; // GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing

        let source_app = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();

        Ok(Some(NowPlayingInfo {
            title,
            artist,
            album,
            position_ms: position_ticks / 10_000,
            duration_ms: end_ticks / 10_000,
            is_playing,
            source_app,
            last_updated_unix_ms,
        }))
    }

    pub async fn toggle_play_pause(_app: &AppHandle) -> Result<(), String> {
        ensure_com_initialized();
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
        session
            .TryTogglePlayPauseAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn seek(_app: &AppHandle, position_ms: i64) -> Result<(), String> {
        ensure_com_initialized();
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
        let ticks = position_ms.max(0) * 10_000;
        session
            .TryChangePlaybackPositionAsync(ticks)
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// macOS has no official public API to read system-wide "Now Playing" info. The private MediaRemote.framework
// blocks direct calls from third-party processes on macOS 15.4+ (due to entitlement verification),
// but the system binary /usr/bin/perl is exceptionally allowed thanks to its Apple signature. Using this workaround,
// the open-source adapter (BSD-3-Clause, https://github.com/ungive/mediaremote-adapter)
// is bundled in resources/mediaremote-adapter/ and invoked as a subprocess (no direct linking).
// Excluded from App Store builds as private API workarounds fail review.
#[cfg(target_os = "macos")]
mod platform {
    use super::NowPlayingInfo;
    use serde::Deserialize;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::{AppHandle, Manager};
    use tokio::process::Command;

    #[derive(Deserialize, Default)]
    struct AdapterInfo {
        title: Option<String>,
        artist: Option<String>,
        album: Option<String>,
        #[serde(rename = "elapsedTime")]
        elapsed_time: Option<f64>,
        duration: Option<f64>,
        playing: Option<bool>,
        #[serde(rename = "bundleIdentifier")]
        bundle_identifier: Option<String>,
        /// The time this snapshot was actually updated (ISO 8601, UTC). Since elapsedTime is only updated
        /// when the playback app pushes a value (not recalculated on every poll), using this field as the anchor
        /// ensures frontend elapsed-time interpolation works correctly (same role as Windows LastUpdatedTime).
        timestamp: Option<String>,
    }

    /// Convert UTC timestamp in "YYYY-MM-DDTHH:MM:SS(.fff)?Z" format to Unix epoch ms.
    /// Minimal parser to avoid external crates (chrono, etc.) — sufficient since adapter output format is fixed.
    fn parse_iso8601_utc_ms(s: &str) -> Option<i64> {
        let s = s.strip_suffix('Z')?;
        let (date, time) = s.split_once('T')?;
        let mut date_parts = date.split('-');
        let year: i64 = date_parts.next()?.parse().ok()?;
        let month: i64 = date_parts.next()?.parse().ok()?;
        let day: i64 = date_parts.next()?.parse().ok()?;
        let (time_main, frac_ms) = match time.split_once('.') {
            Some((t, f)) => {
                let padded = format!("{:0<3}", f);
                (t, padded.get(0..3)?.parse().ok()?)
            }
            None => (time, 0i64),
        };
        let mut time_parts = time_main.split(':');
        let hour: i64 = time_parts.next()?.parse().ok()?;
        let min: i64 = time_parts.next()?.parse().ok()?;
        let sec: i64 = time_parts.next()?.parse().ok()?;

        // Howard Hinnant's days_from_civil algorithm (public domain).
        let y = if month <= 2 { year - 1 } else { year };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (month + 9) % 12;
        let doy = (153 * mp + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146097 + doe - 719468;

        let total_seconds = days * 86400 + hour * 3600 + min * 60 + sec;
        Some(total_seconds * 1000 + frac_ms)
    }

    fn adapter_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
        let base = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("mediaremote-adapter");
        Ok((
            base.join("mediaremote-adapter.pl"),
            base.join("MediaRemoteAdapter.framework"),
        ))
    }

    async fn run_adapter(app: &AppHandle, args: &[&str]) -> Result<String, String> {
        let (script, framework) = adapter_paths(app)?;
        let output = Command::new("/usr/bin/perl")
            .arg(&script)
            .arg(&framework)
            .args(args)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub async fn get_now_playing(app: &AppHandle) -> Result<Option<NowPlayingInfo>, String> {
        let stdout = run_adapter(app, &["get"]).await?;
        if stdout.is_empty() || stdout == "null" {
            return Ok(None);
        }
        let info: AdapterInfo = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;

        let title = info.title.unwrap_or_default();
        let artist = info.artist.unwrap_or_default();
        // If both title and artist are empty, treat as "nothing playing" (same rule as Windows)
        if title.is_empty() && artist.is_empty() {
            return Ok(None);
        }

        // Since elapsedTime is only updated when the playback app actually pushes a value, the timestamp
        // provided by the adapter (when the snapshot was taken) must be used as the interpolation anchor.
        // Fallback to current time only if parsing fails (slight skew is better than freezing).
        let last_updated_unix_ms = info
            .timestamp
            .as_deref()
            .and_then(parse_iso8601_utc_ms)
            .unwrap_or_else(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0)
            });

        Ok(Some(NowPlayingInfo {
            title,
            artist,
            album: info.album.unwrap_or_default(),
            position_ms: (info.elapsed_time.unwrap_or(0.0) * 1000.0) as i64,
            duration_ms: (info.duration.unwrap_or(0.0) * 1000.0) as i64,
            is_playing: info.playing.unwrap_or(false),
            source_app: info.bundle_identifier.unwrap_or_default(),
            last_updated_unix_ms,
        }))
    }

    pub async fn toggle_play_pause(app: &AppHandle) -> Result<(), String> {
        // MediaRemote command ID 2 = kMRTogglePlayPause
        run_adapter(app, &["send", "2"]).await.map(|_| ())
    }

    pub async fn seek(app: &AppHandle, position_ms: i64) -> Result<(), String> {
        let micros = position_ms.max(0) * 1000;
        let micros_str = micros.to_string();
        run_adapter(app, &["seek", &micros_str]).await.map(|_| ())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    use super::NowPlayingInfo;
    use tauri::AppHandle;

    pub async fn get_now_playing(_app: &AppHandle) -> Result<Option<NowPlayingInfo>, String> {
        Ok(None)
    }

    pub async fn toggle_play_pause(_app: &AppHandle) -> Result<(), String> {
        Err("이 플랫폼에서는 지원하지 않습니다".into())
    }

    pub async fn seek(_app: &AppHandle, _position_ms: i64) -> Result<(), String> {
        Err("이 플랫폼에서는 지원하지 않습니다".into())
    }
}

#[tauri::command]
pub async fn get_now_playing(app: tauri::AppHandle) -> Result<Option<NowPlayingInfo>, String> {
    platform::get_now_playing(&app).await
}

#[tauri::command]
pub async fn now_playing_toggle_play_pause(app: tauri::AppHandle) -> Result<(), String> {
    platform::toggle_play_pause(&app).await
}

#[tauri::command]
pub async fn now_playing_seek(position_ms: i64, app: tauri::AppHandle) -> Result<(), String> {
    platform::seek(&app, position_ms).await
}

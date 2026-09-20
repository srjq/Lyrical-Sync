mod service_auth;
use service_auth::*;
mod now_playing;
use now_playing::*;
mod models;
use models::*;
mod python_env;
use python_env::*;
mod alignment;
use alignment::*;
mod ytdlp;
use ytdlp::*;
mod lrclib;
use lrclib::*;

// ─── LRC / audio commands ────────────────────────────────────────

#[tauri::command]
async fn read_lrc_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_lrc_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<tauri::ipc::Response, String> {
    // Return bytes as raw binary instead of JSON (number[]) -> fast even for large audio files
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// Transcode formats not supported by WebView2 (such as AIFF) to WAV and return the temporary file path.
#[tauri::command]
async fn decode_audio_to_wav(path: String) -> Result<String, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(&path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("지원하지 않는 포맷: {e}"))?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("오디오 트랙 없음")?;
    let codec_params = track.codec_params.clone();
    let track_id = track.id;

    let sample_rate = codec_params.sample_rate.ok_or("샘플레이트 없음")?;
    let channels = codec_params.channels.ok_or("채널 정보 없음")?.count();

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("디코더 오류: {e}"))?;

    let mut samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let mut buf =
                    SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                buf.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buf.samples());
            }
            Err(_) => continue,
        }
    }

    let spec = hound::WavSpec {
        channels: channels as u16,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let temp_path = std::env::temp_dir().join("lyrical_sync_transcoded.wav");
    {
        let mut writer =
            hound::WavWriter::create(&temp_path, spec).map_err(|e| format!("WAV 생성 오류: {e}"))?;
        for &s in &samples {
            writer.write_sample(s).map_err(|e| format!("WAV 쓰기 오류: {e}"))?;
        }
        writer.finalize().map_err(|e| format!("WAV 완료 오류: {e}"))?;
    }

    Ok(temp_path.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
struct AudioMetadata {
    title: String,
    artist: String,
    album: String,
}

/// Read title, artist, and album from audio file tags (ID3, Vorbis, MP4, etc.).
/// Returns empty strings if tags are missing or read fails (frontend only fills empty fields).
#[tauri::command]
fn read_audio_metadata(path: String) -> Result<AudioMetadata, String> {
    use lofty::file::TaggedFileExt;
    use lofty::tag::Accessor;
    let tagged = lofty::read_from_path(&path).map_err(|e| e.to_string())?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let s = |o: Option<std::borrow::Cow<str>>| o.map(|c| c.trim().to_string()).unwrap_or_default();
    Ok(match tag {
        Some(t) => AudioMetadata { title: s(t.title()), artist: s(t.artist()), album: s(t.album()) },
        None => AudioMetadata { title: String::new(), artist: String::new(), album: String::new() },
    })
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadState::default())
        .manage(ModelsDirState::default())
        .manage(AlignmentState::default())
        .manage(YtdlpState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Updater is desktop-only (not present on mobile targets)
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_lrc_file,
            write_lrc_file,
            read_audio_file,
            decode_audio_to_wav,
            read_audio_metadata,
            set_models_dir_override,
            get_models_dir,
            check_model_files,
            download_model,
            cancel_model_download,
            delete_model_files,
            get_python_env_info,
            download_embedded_python,
            install_python_packages,
            run_alignment,
            cancel_alignment,
            start_oauth_listener,
            exchange_spotify_token,
            refresh_spotify_token,
            save_refresh_token,
            load_refresh_token,
            clear_refresh_token,
            check_ytdlp,
            download_ytdlp,
            ytdlp_load_audio,
            cancel_ytdlp_load,
            lrclib_publish,
            get_now_playing,
            now_playing_toggle_play_pause,
            now_playing_seek,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

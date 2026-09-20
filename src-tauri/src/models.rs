use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};

pub struct DownloadState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self { cancels: Mutex::new(HashMap::new()) }
    }
}

/// Custom model storage directory specified by user. If None, default app directory is used.
pub struct ModelsDirState {
    custom_path: Mutex<Option<PathBuf>>,
}

impl Default for ModelsDirState {
    fn default() -> Self {
        Self { custom_path: Mutex::new(None) }
    }
}

#[derive(Deserialize)]
pub struct FileSpec {
    url: String,
    filename: String,
    /// Optional SHA-256 (lowercase hex). If specified, verifies integrity after download; deletes file and fails on mismatch.
    #[serde(default)]
    sha256: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressEvent {
    model_id: String,
    file_index: usize,
    file_count: usize,
    downloaded: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

pub fn models_dir(app: &AppHandle, dir_state: &ModelsDirState) -> Result<PathBuf, String> {
    let custom = dir_state.custom_path.lock().unwrap();
    if let Some(ref p) = *custom {
        return Ok(p.clone());
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join("models"))
        .map_err(|e| e.to_string())
}

/// Set custom model storage path. If None, resets to default app path.
#[tauri::command]
pub fn set_models_dir_override(
    dir_state: tauri::State<'_, ModelsDirState>,
    path: Option<String>,
) -> Result<(), String> {
    let mut custom = dir_state.custom_path.lock().unwrap();
    *custom = path.filter(|p| !p.is_empty()).map(PathBuf::from);
    Ok(())
}

#[tauri::command]
pub async fn get_models_dir(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
) -> Result<String, String> {
    let dir = models_dir(&app, &dir_state)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Check if each file exists in the models directory.
#[tauri::command]
pub async fn check_model_files(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    filenames: Vec<String>,
) -> Result<Vec<bool>, String> {
    let base = models_dir(&app, &dir_state)?;
    Ok(filenames.iter().map(|f| base.join(f).exists()).collect())
}

/// Download model file list. Progress is emitted via `model-download-progress` event.
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    dl_state: tauri::State<'_, DownloadState>,
    model_id: String,
    files: Vec<FileSpec>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    dl_state.cancels.lock().unwrap().insert(model_id.clone(), cancel.clone());

    let base = models_dir(&app, &dir_state)?;
    let file_count = files.len();
    let client = reqwest::Client::new();

    for (i, spec) in files.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            dl_state.cancels.lock().unwrap().remove(&model_id);
            return Err("cancelled".into());
        }

        let dest = base.join(&spec.filename);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // When retrying after some files failed, skip files that have already been completely downloaded
        // (if checksum specified, verify match; otherwise check existence — same criteria as check_model_files).
        // Otherwise, failure of a single final file would re-download large existing files from scratch.
        if dest.exists() {
            let existing_valid = match spec.sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(expected) => {
                    use sha2::{Digest, Sha256};
                    tokio::fs::read(&dest).await.ok().map(|bytes| {
                        let got = format!("{:x}", Sha256::digest(&bytes));
                        got.eq_ignore_ascii_case(expected)
                    }).unwrap_or(false)
                }
                None => true,
            };
            if existing_valid {
                let size = tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0);
                let _ = app.emit(
                    "model-download-progress",
                    DownloadProgressEvent {
                        model_id: model_id.clone(),
                        file_index: i,
                        file_count,
                        downloaded: size,
                        total: size,
                        done: false,
                        error: None,
                    },
                );
                continue;
            }
            // Corrupted/mismatch — remove and re-download properly.
            let _ = tokio::fs::remove_file(&dest).await;
        }

        let mut resp = client
            .get(&spec.url)
            .send()
            .await
            .map_err(|e| format!("요청 실패: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            dl_state.cancels.lock().unwrap().remove(&model_id);
            return Err(format!("HTTP {status}"));
        }

        let total = resp.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;

        use tokio::io::AsyncWriteExt;
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        let verify = spec.sha256.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let mut file = tokio::fs::File::create(&dest).await.map_err(|e| e.to_string())?;

        loop {
            if cancel.load(Ordering::Relaxed) {
                drop(file);
                let _ = tokio::fs::remove_file(&dest).await;
                dl_state.cancels.lock().unwrap().remove(&model_id);
                return Err("cancelled".into());
            }

            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                    if verify.is_some() { hasher.update(&chunk); }
                    downloaded += chunk.len() as u64;
                    let _ = app.emit(
                        "model-download-progress",
                        DownloadProgressEvent {
                            model_id: model_id.clone(),
                            file_index: i,
                            file_count,
                            downloaded,
                            total,
                            done: false,
                            error: None,
                        },
                    );
                }
                Ok(None) => {
                    file.flush().await.map_err(|e| e.to_string())?;
                    // Integrity check (only for files with sha256 specified)
                    if let Some(expected) = verify {
                        let got = format!("{:x}", hasher.finalize());
                        if !got.eq_ignore_ascii_case(expected) {
                            drop(file);
                            let _ = tokio::fs::remove_file(&dest).await;
                            dl_state.cancels.lock().unwrap().remove(&model_id);
                            return Err(format!(
                                "체크섬 불일치 ({}): 예상 {} / 실제 {}",
                                spec.filename, expected, got
                            ));
                        }
                    }
                    break;
                }
                Err(e) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&dest).await;
                    let _ = app.emit(
                        "model-download-progress",
                        DownloadProgressEvent {
                            model_id: model_id.clone(),
                            file_index: i,
                            file_count,
                            downloaded,
                            total,
                            done: true,
                            error: Some(e.to_string()),
                        },
                    );
                    dl_state.cancels.lock().unwrap().remove(&model_id);
                    return Err(e.to_string());
                }
            }
        }
    }

    let _ = app.emit(
        "model-download-progress",
        DownloadProgressEvent {
            model_id: model_id.clone(),
            file_index: file_count,
            file_count,
            downloaded: 0,
            total: 0,
            done: true,
            error: None,
        },
    );

    dl_state.cancels.lock().unwrap().remove(&model_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_model_download(dl_state: tauri::State<'_, DownloadState>, model_id: String) {
    if let Ok(cancels) = dl_state.cancels.lock() {
        if let Some(flag) = cancels.get(&model_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub async fn delete_model_files(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    filenames: Vec<String>,
) -> Result<(), String> {
    let base = models_dir(&app, &dir_state)?;
    for f in &filenames {
        let path = base.join(f);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

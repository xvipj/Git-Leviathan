use notify::RecommendedWatcher;
use portable_pty::{Child, MasterPty};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::error::AppResult;

pub struct OperationHandle {
    pub child: Mutex<Option<std::process::Child>>,
    pub cancelled: AtomicBool,
}

pub struct TerminalSession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub head: String,
    pub branch: Option<String>,
    pub label: String,
}

#[derive(Default)]
pub struct UndoStack {
    pub undo: Vec<Snapshot>,
    pub redo: Vec<Snapshot>,
}

#[derive(Default)]
pub struct Inner {
    pub operations: HashMap<String, Arc<OperationHandle>>,
    pub terminals: HashMap<String, TerminalSession>,
    pub undo: HashMap<String, UndoStack>,
    pub watcher: Option<RecommendedWatcher>,
    pub watched_path: Option<PathBuf>,
    pub recents: Vec<String>,
}

pub struct AppState {
    pub inner: Arc<Mutex<Inner>>,
}

impl AppState {
    pub fn new(recents: Vec<String>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                recents,
                ..Inner::default()
            })),
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedState {
    #[serde(default)]
    recents: Vec<String>,
}

fn state_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| {
        crate::error::AppError::new(format!("No se pudo acceder a la carpeta de datos: {e}"))
    })?;
    Ok(dir.join("leviathan-state.json"))
}

pub fn load_recents(app: &tauri::AppHandle) -> Vec<String> {
    let Ok(path) = state_path(app) else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let parsed: PersistedState = serde_json::from_str(&raw).unwrap_or_default();
    parsed
        .recents
        .into_iter()
        .filter(|p| !p.trim().is_empty())
        .take(20)
        .collect()
}

pub fn save_recents(app: &tauri::AppHandle, recents: &[String]) {
    let Ok(path) = state_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = PersistedState {
        recents: recents.to_vec(),
    };
    if let Ok(raw) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(path, raw);
    }
}

pub fn add_recent(app: &tauri::AppHandle, recents: &mut Vec<String>, path: &str) {
    recents.retain(|p| !p.eq_ignore_ascii_case(path));
    recents.insert(0, path.to_string());
    recents.truncate(20);
    save_recents(app, recents);
}

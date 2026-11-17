use crate::error::{AppError, AppResult};
use crate::state::Inner;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Vigila el árbol de trabajo y el directorio .git del repositorio activo.
/// Los eventos se agrupan para no saturar al frontend.
pub fn watch_repository(
    app: tauri::AppHandle,
    inner: Arc<Mutex<Inner>>,
    worktree: PathBuf,
    git_dir: PathBuf,
) -> AppResult<()> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = tx.send(event);
    })
    .map_err(|e| AppError::new(format!("No se pudo iniciar el vigilante de archivos: {e}")))?;

    watcher
        .watch(&worktree, RecursiveMode::Recursive)
        .map_err(|e| {
            AppError::new(format!(
                "No se pudo vigilar la carpeta del repositorio: {e}"
            ))
        })?;
    let same = match (
        std::fs::canonicalize(&worktree),
        std::fs::canonicalize(&git_dir),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => worktree == git_dir,
    };
    if !same && git_dir.exists() {
        let _ = watcher.watch(&git_dir, RecursiveMode::Recursive);
    }

    // Sustituye al vigilante anterior. Al soltarlo se cierra su canal y su hilo termina.
    if let Ok(mut guard) = inner.lock() {
        guard.watcher = Some(watcher);
        guard.watched_path = Some(worktree.clone());
    }

    let path_label = worktree.to_string_lossy().to_string();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut pending = false;
        let mut last_emit = Instant::now();
        loop {
            match rx.recv_timeout(Duration::from_millis(220)) {
                Ok(Ok(event)) => {
                    if matches!(event.kind, EventKind::Access(_)) {
                        continue;
                    }
                    if event.paths.iter().any(|p| is_relevant(p)) {
                        pending = true;
                    }
                }
                Ok(Err(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if pending && last_emit.elapsed() >= Duration::from_millis(500) {
                        let _ = app_handle
                            .emit("repo:changed", serde_json::json!({ "path": path_label }));
                        pending = false;
                        last_emit = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(())
}

fn is_relevant(path: &Path) -> bool {
    let mut components = path.components().peekable();
    let mut seen_git = false;
    while let Some(component) = components.next() {
        let part = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        if part.ends_with(".lock") {
            return false;
        }
        if part == ".git" {
            seen_git = true;
            if let Some(next) = components.peek() {
                let next = next.as_os_str().to_string_lossy().to_ascii_lowercase();
                if matches!(next.as_ref(), "objects" | "logs" | "hooks" | "lfs") {
                    return false;
                }
            }
            continue;
        }
        if matches!(
            part.as_ref(),
            "node_modules" | "target" | "dist" | ".venv" | "vendor" | ".next" | ".cache"
        ) {
            return false;
        }
        if seen_git {
            return true;
        }
    }
    true
}

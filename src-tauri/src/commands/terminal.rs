use crate::error::{AppError, AppResult};
use crate::state::{AppState, TerminalSession};
use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};

fn detect_shell() -> String {
    #[cfg(windows)]
    {
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let pwsh = PathBuf::from(pf)
                .join("PowerShell")
                .join("7")
                .join("pwsh.exe");
            if pwsh.is_file() {
                return pwsh.to_string_lossy().to_string();
            }
        }
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !comspec.trim().is_empty() {
                return comspec;
            }
        }
        "cmd.exe".to_string()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "/bin/sh".to_string())
    }
}

fn validate_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err(AppError::new("Identificador de terminal no válido."));
    }
    Ok(())
}

#[tauri::command]
pub async fn spawn_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_path: String,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<String, AppError> {
    validate_id(&id)?;
    let cwd = PathBuf::from(&repo_path);
    if !cwd.is_dir() {
        return Err(AppError::new("La carpeta del repositorio no existe."));
    }
    {
        let guard = state
            .inner
            .lock()
            .map_err(|_| AppError::new("Estado interno no disponible."))?;
        if guard.terminals.contains_key(&id) {
            return Err(AppError::new(
                "Ya existe una terminal con ese identificador.",
            ));
        }
    }

    let shell = detect_shell();
    let size = PtySize {
        rows: rows.max(5),
        cols: cols.max(20),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|e| AppError::new(format!("No se pudo crear la terminal: {e}")))?;

    let mut command = CommandBuilder::new(Path::new(&shell));
    #[cfg(windows)]
    {
        if shell.to_ascii_lowercase().ends_with("powershell.exe")
            || shell.to_ascii_lowercase().ends_with("pwsh.exe")
        {
            command.arg("-NoLogo");
        }
    }
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| AppError::new(format!("No se pudo iniciar la shell «{shell}»: {e}")))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::new(format!("No se pudo leer de la terminal: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::new(format!("No se pudo escribir en la terminal: {e}")))?;

    {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| AppError::new("Estado interno no disponible."))?;
        guard.terminals.insert(
            id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    let app_handle = app.clone();
    let terminal_id = id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer[..size]);
                    let _ = app_handle.emit(
                        "terminal:data",
                        serde_json::json!({ "id": terminal_id.clone(), "data": encoded }),
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit("terminal:exit", serde_json::json!({ "id": terminal_id }));
    });

    Ok(shell)
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), AppError> {
    validate_id(&id)?;
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| AppError::new("Estado interno no disponible."))?;
    let session = guard
        .terminals
        .get_mut(&id)
        .ok_or_else(|| AppError::new("La terminal ya no está abierta."))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| AppError::new(format!("No se pudo escribir en la terminal: {e}")))?;
    session
        .writer
        .flush()
        .map_err(|e| AppError::new(format!("No se pudo escribir en la terminal: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, AppState>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    validate_id(&id)?;
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| AppError::new("Estado interno no disponible."))?;
    let session = guard
        .terminals
        .get_mut(&id)
        .ok_or_else(|| AppError::new("La terminal ya no está abierta."))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(10),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::new(format!("No se pudo redimensionar la terminal: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_close(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    validate_id(&id)?;
    let session = {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| AppError::new("Estado interno no disponible."))?;
        guard.terminals.remove(&id)
    };
    if let Some(mut session) = session {
        let _ = session.child.kill();
    }
    Ok(())
}

pub fn close_all_terminals(state: &AppState) {
    if let Ok(mut guard) = state.inner.lock() {
        let sessions: Vec<TerminalSession> = guard.terminals.drain().map(|(_, s)| s).collect();
        for mut session in sessions {
            let _ = session.child.kill();
        }
    }
}

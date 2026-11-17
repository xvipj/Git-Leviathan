use crate::error::{AppError, AppResult};
use crate::git::new_git_command;
use crate::models::GitOpResult;
use crate::state::{Inner, OperationHandle};
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

/// Ejecuta una operación larga emitiendo progreso en tiempo real.
/// El proceso se registra para poder cancelarlo desde el frontend.
pub fn run_streaming(
    app: tauri::AppHandle,
    inner: Arc<Mutex<Inner>>,
    cwd: PathBuf,
    args: Vec<String>,
    operation_id: String,
) -> AppResult<GitOpResult> {
    if operation_id.trim().is_empty() {
        return Err(AppError::new("Falta el identificador de la operación."));
    }

    let mut child = new_git_command(Some(&cwd))
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            AppError::new(format!(
                "No se pudo ejecutar git. Comprueba que esté instalado y en el PATH. Detalle: {e}"
            ))
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::new("No se pudo leer la salida de git."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::new("No se pudo leer el progreso de git."))?;

    let handle = Arc::new(OperationHandle {
        child: Mutex::new(Some(child)),
        cancelled: AtomicBool::new(false),
    });
    if let Ok(mut guard) = inner.lock() {
        guard
            .operations
            .insert(operation_id.clone(), handle.clone());
    }

    let out_reader = spawn_reader(
        stdout,
        app.clone(),
        operation_id.clone(),
        "stdout".to_string(),
    );
    let err_reader = spawn_reader(
        stderr,
        app.clone(),
        operation_id.clone(),
        "stderr".to_string(),
    );

    let mut code = -1;
    loop {
        let status = {
            let mut guard = match handle.child.lock() {
                Ok(guard) => guard,
                Err(_) => break,
            };
            match guard.as_mut() {
                Some(child) => child.try_wait().ok().flatten(),
                None => None,
            }
        };
        if let Some(status) = status {
            code = status.code().unwrap_or(-1);
            break;
        }
        if handle.cancelled.load(Ordering::SeqCst) {
            if let Ok(mut guard) = handle.child.lock() {
                if let Some(child) = guard.as_mut() {
                    let _ = child.kill();
                }
            }
        }
        thread::sleep(Duration::from_millis(120));
    }

    let stdout_text = out_reader.join().unwrap_or_default();
    let stderr_text = err_reader.join().unwrap_or_default();
    let cancelled = handle.cancelled.load(Ordering::SeqCst);
    if let Ok(mut guard) = inner.lock() {
        guard.operations.remove(&operation_id);
    }

    if cancelled {
        return Err(AppError::with_stderr(
            "Operación cancelada por el usuario.",
            stderr_text,
            None,
        ));
    }
    if code != 0 {
        let mut detail = String::new();
        if !stderr_text.trim().is_empty() {
            detail.push_str(stderr_text.trim_end());
            detail.push('\n');
        }
        if !stdout_text.trim().is_empty() && stdout_text.trim() != stderr_text.trim() {
            detail.push_str(stdout_text.trim_end());
        }
        if detail.trim().is_empty() {
            detail = "Git no devolvió detalles adicionales.".into();
        }
        return Err(AppError::with_stderr(
            format!("Git terminó con código {code}."),
            detail,
            Some(code),
        ));
    }
    Ok(GitOpResult {
        stdout: stdout_text,
        stderr: stderr_text,
    })
}

fn spawn_reader(
    mut reader: impl Read + Send + 'static,
    app: tauri::AppHandle,
    operation_id: String,
    stream: String,
) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut collected = String::new();
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                    collected.push_str(&chunk);
                    let _ = app.emit(
                        "git:progress",
                        serde_json::json!({
                            "operationId": operation_id,
                            "stream": stream,
                            "chunk": chunk,
                        }),
                    );
                }
                Err(_) => break,
            }
        }
        collected
    })
}

pub fn cancel_operation(inner: &Arc<Mutex<Inner>>, operation_id: &str) -> bool {
    let handle = inner
        .lock()
        .ok()
        .and_then(|guard| guard.operations.get(operation_id).cloned());
    if let Some(handle) = handle {
        handle.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = handle.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        true
    } else {
        false
    }
}

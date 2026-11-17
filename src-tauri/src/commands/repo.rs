use crate::error::{AppError, AppResult};
use crate::git::{new_git_command, GitRepo};
use crate::gitops::{repo, stream, watcher};
use crate::models::{AppBootstrap, GitInfo, RepoState};
use crate::state::{self, AppState};
use std::path::{Path, PathBuf};
use tauri::State;

fn git_info() -> GitInfo {
    match new_git_command(None).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout)
                .trim()
                .trim_start_matches("git version ")
                .to_string();
            GitInfo {
                available: true,
                version,
                executable: "git".into(),
            }
        }
        _ => GitInfo {
            available: false,
            version: String::new(),
            executable: String::new(),
        },
    }
}

fn git_version() -> String {
    let info = git_info();
    if info.available {
        info.version
    } else {
        "desconocida".into()
    }
}

pub fn start_watcher(app: &tauri::AppHandle, state: &AppState, repo: &GitRepo) {
    let git_dir = repo.git_dir().unwrap_or_else(|_| repo.path.join(".git"));
    if let Err(error) =
        watcher::watch_repository(app.clone(), state.inner.clone(), repo.path.clone(), git_dir)
    {
        eprintln!("Aviso: no se pudo vigilar el repositorio: {error}");
    }
}

fn finish_open(app: &tauri::AppHandle, state: &AppState, repo: GitRepo) -> AppResult<RepoState> {
    let snapshot = repo::repo_state(&repo, &git_version())?;
    start_watcher(app, state, &repo);
    if let Ok(mut guard) = state.inner.lock() {
        let mut recents = guard.recents.clone();
        state::add_recent(app, &mut recents, &snapshot.info.path);
        guard.recents = recents;
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn bootstrap(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AppBootstrap, AppError> {
    let git = git_info();
    let recents = {
        let guard = state
            .inner
            .lock()
            .map_err(|_| AppError::new("Estado interno no disponible."))?;
        guard.recents.clone()
    };
    let recents = if recents.is_empty() {
        state::load_recents(&app)
    } else {
        recents
    };
    if let Ok(mut guard) = state.inner.lock() {
        guard.recents = recents.clone();
    }
    Ok(AppBootstrap { git, recents })
}

#[tauri::command]
pub async fn open_repository(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<RepoState, AppError> {
    let repo = GitRepo::discover(PathBuf::from(&path))?;
    finish_open(&app, &state, repo)
}

#[tauri::command]
pub async fn refresh_repo(path: String) -> Result<RepoState, AppError> {
    let repo = GitRepo::discover(PathBuf::from(&path))?;
    repo::repo_state(&repo, &git_version())
}

#[tauri::command]
pub async fn init_repository(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<RepoState, AppError> {
    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err(AppError::new(
            "Elige una carpeta para inicializar el repositorio.",
        ));
    }
    if target.exists() && !target.is_dir() {
        return Err(AppError::new("La ruta indicada no es una carpeta."));
    }
    std::fs::create_dir_all(&target)
        .map_err(|e| AppError::new(format!("No se pudo crear la carpeta: {e}")))?;
    let canonical = std::fs::canonicalize(&target)
        .map_err(|e| AppError::new(format!("No se pudo abrir la carpeta: {e}")))?;

    let mut command = new_git_command(Some(&canonical));
    let output = command
        .arg("init")
        .output()
        .map_err(|e| AppError::new(format!("No se pudo ejecutar git init: {e}")))?;
    if !output.status.success() {
        return Err(AppError::with_stderr(
            "git init falló.",
            String::from_utf8_lossy(&output.stderr).to_string(),
            output.status.code(),
        ));
    }
    let repo = GitRepo::discover(&canonical)?;
    finish_open(&app, &state, repo)
}

#[tauri::command]
pub async fn clone_repository(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    destination: String,
    operation_id: String,
) -> Result<RepoState, AppError> {
    let url = url.trim().to_string();
    if url.is_empty() || url.starts_with('-') || url.chars().any(|c| c.is_control()) {
        return Err(AppError::new("La URL del repositorio no es válida."));
    }
    let raw_dest = PathBuf::from(destination.trim());
    if raw_dest.as_os_str().is_empty() {
        return Err(AppError::new("Elige una carpeta de destino para el clon."));
    }
    let dest = if raw_dest.is_absolute() {
        raw_dest
    } else {
        std::env::current_dir()
            .map_err(|e| AppError::new(format!("No se pudo obtener la carpeta actual: {e}")))?
            .join(raw_dest)
    };
    let parent = dest
        .parent()
        .ok_or_else(|| AppError::new("La carpeta de destino no es válida."))?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "La carpeta contenedora del destino no existe.",
        ));
    }
    let name = dest
        .file_name()
        .ok_or_else(|| AppError::new("La carpeta de destino no es válida."))?
        .to_string_lossy()
        .to_string();

    stream::run_streaming(
        app.clone(),
        state.inner.clone(),
        parent.to_path_buf(),
        vec!["clone".into(), "--progress".into(), "--".into(), url, name],
        operation_id,
    )?;

    let repo = GitRepo::discover(&dest)?;
    finish_open(&app, &state, repo)
}

#[tauri::command]
pub async fn list_recents(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| AppError::new("Estado interno no disponible."))?;
    Ok(guard.recents.clone())
}

#[tauri::command]
pub async fn remove_recent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<String>, AppError> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| AppError::new("Estado interno no disponible."))?;
    guard.recents.retain(|p| p != &path);
    let recents = guard.recents.clone();
    state::save_recents(&app, &recents);
    Ok(recents)
}

#[allow(dead_code)]
pub fn validate_dir(path: &str) -> AppResult<PathBuf> {
    let path = Path::new(path);
    if !path.is_dir() {
        return Err(AppError::new("La carpeta no existe."));
    }
    Ok(path.to_path_buf())
}

use crate::error::{AppError, AppResult};
use crate::git::{validate_remote_name, GitRepo};
use crate::gitops::{stream, undo};
use crate::models::GitOpResult;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn repo(path: &str) -> AppResult<GitRepo> {
    GitRepo::discover(PathBuf::from(path))
}

fn checked_remote(repo: &GitRepo, remote: &Option<String>) -> AppResult<Option<String>> {
    let Some(name) = remote.as_deref().map(str::trim).filter(|n| !n.is_empty()) else {
        return Ok(None);
    };
    validate_remote_name(name)?;
    let out = repo.run(&["remote", "get-url", name])?;
    if !out.success {
        return Err(AppError::with_stderr(
            format!("El remoto «{name}» no existe en este repositorio."),
            out.stderr,
            Some(out.code),
        ));
    }
    Ok(Some(name.to_string()))
}

#[tauri::command]
pub async fn fetch_remote(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_path: String,
    remote: Option<String>,
    prune: bool,
    operation_id: String,
) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    let remote = checked_remote(&repo, &remote)?;
    let mut args: Vec<String> = vec!["fetch".into(), "--progress".into()];
    if prune {
        args.push("--prune".into());
    }
    match remote {
        Some(name) => args.push(name),
        None => args.push("--all".into()),
    }
    stream::run_streaming(
        app,
        state.inner.clone(),
        repo.path.clone(),
        args,
        operation_id,
    )
}

#[tauri::command]
pub async fn pull_remote(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_path: String,
    remote: Option<String>,
    mode: String,
    operation_id: String,
) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    let remote = checked_remote(&repo, &remote)?;
    let mut args: Vec<String> = vec!["pull".into(), "--progress".into()];
    match mode.as_str() {
        "merge" => args.push("--no-rebase".into()),
        "rebase" => args.push("--rebase".into()),
        "ff-only" => args.push("--ff-only".into()),
        "default" => {}
        _ => return Err(AppError::new("Modo de pull no válido.")),
    }
    if let Some(name) = remote {
        args.push(name);
    }
    let snapshot = undo::capture(&repo)?;
    let result = stream::run_streaming(
        app,
        state.inner.clone(),
        repo.path.clone(),
        args,
        operation_id,
    )?;
    undo::record(&state.inner, &repo, snapshot, "pull");
    Ok(result)
}

#[tauri::command]
pub async fn push_remote(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_path: String,
    remote: Option<String>,
    set_upstream: bool,
    force_with_lease: bool,
    confirmed: bool,
    operation_id: String,
) -> Result<GitOpResult, AppError> {
    if force_with_lease && !confirmed {
        return Err(AppError::new(
            "El force push requiere una confirmación explícita porque puede sobrescribir trabajo remoto.",
        ));
    }
    let repo = repo(&repo_path)?;
    let remote = checked_remote(&repo, &remote)?;
    let branch = repo
        .current_branch()?
        .ok_or_else(|| AppError::new("No se puede hacer push desde un HEAD desacoplado."))?;

    let mut args: Vec<String> = vec!["push".into(), "--progress".into()];
    if force_with_lease {
        args.push("--force-with-lease".into());
    }
    if set_upstream {
        let name = remote.ok_or_else(|| {
            AppError::new("Elige un remoto para configurar el upstream de la rama.")
        })?;
        args.push("--set-upstream".into());
        args.push(name);
        args.push(branch);
    } else if let Some(name) = remote {
        args.push(name);
        args.push(branch);
    }
    stream::run_streaming(
        app,
        state.inner.clone(),
        repo.path.clone(),
        args,
        operation_id,
    )
}

#[tauri::command]
pub async fn cancel_operation(
    state: State<'_, AppState>,
    operation_id: String,
) -> Result<bool, AppError> {
    Ok(stream::cancel_operation(&state.inner, &operation_id))
}

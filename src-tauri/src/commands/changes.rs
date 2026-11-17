use super::op_result;
use crate::error::{AppError, AppResult};
use crate::git::GitRepo;
use crate::gitops::{changes, undo};
use crate::models::GitOpResult;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn repo(path: &str) -> AppResult<GitRepo> {
    GitRepo::discover(PathBuf::from(path))
}

#[tauri::command]
pub async fn stage_paths(repo_path: String, paths: Vec<String>) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    Ok(op_result(changes::stage_paths(&repo, &paths)?))
}

#[tauri::command]
pub async fn stage_all(repo_path: String) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    Ok(op_result(changes::stage_all(&repo)?))
}

#[tauri::command]
pub async fn unstage_paths(repo_path: String, paths: Vec<String>) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    Ok(op_result(changes::unstage_paths(&repo, &paths)?))
}

#[tauri::command]
pub async fn unstage_all(repo_path: String) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    Ok(op_result(changes::unstage_all(&repo)?))
}

#[tauri::command]
pub async fn discard_paths(
    repo_path: String,
    paths: Vec<String>,
    confirmed: bool,
) -> Result<GitOpResult, AppError> {
    if !confirmed {
        return Err(AppError::new(
            "Descartar cambios requiere una confirmación explícita.",
        ));
    }
    let repo = repo(&repo_path)?;
    Ok(op_result(changes::discard_paths(&repo, &paths)?))
}

#[tauri::command]
pub async fn discard_all(repo_path: String, confirmed: bool) -> Result<GitOpResult, AppError> {
    if !confirmed {
        return Err(AppError::new(
            "Descartar todos los cambios requiere una confirmación explícita.",
        ));
    }
    let repo = repo(&repo_path)?;
    Ok(op_result(changes::discard_all(&repo)?))
}

#[tauri::command]
pub async fn apply_patch(
    repo_path: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    Ok(op_result(changes::apply_patch(
        &repo, &patch, cached, reverse,
    )?))
}

#[tauri::command]
pub async fn commit_changes(
    state: State<'_, AppState>,
    repo_path: String,
    message: String,
    amend: bool,
    sign: bool,
) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    let snapshot = undo::capture(&repo)?;
    let output = changes::commit(&repo, &message, amend, sign)?;
    undo::record(
        &state.inner,
        &repo,
        snapshot,
        if amend { "commit --amend" } else { "commit" },
    );
    Ok(op_result(output))
}

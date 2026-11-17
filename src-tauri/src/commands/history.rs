use crate::error::AppError;
use crate::git::GitRepo;
use crate::gitops::{changes, history};
use crate::models::{
    BlameLine, CommitDetails, CommitEntry, DiffResult, HistoryFilter, HistoryPage,
};
use std::path::PathBuf;

fn repo(path: &str) -> Result<GitRepo, AppError> {
    GitRepo::discover(PathBuf::from(path))
}

#[tauri::command]
pub async fn get_history(
    repo_path: String,
    skip: u32,
    limit: u32,
    filter: Option<HistoryFilter>,
) -> Result<HistoryPage, AppError> {
    let repo = repo(&repo_path)?;
    history::history_page(&repo, skip, limit, filter.as_ref())
}

#[tauri::command]
pub async fn get_commit_details(
    repo_path: String,
    hash: String,
) -> Result<CommitDetails, AppError> {
    let repo = repo(&repo_path)?;
    history::commit_details(&repo, &hash)
}

#[tauri::command]
pub async fn get_file_diff(
    repo_path: String,
    file_path: String,
    mode: String,
    commit: Option<String>,
    old_path: Option<String>,
    untracked: bool,
    context: Option<u32>,
) -> Result<DiffResult, AppError> {
    let repo = repo(&repo_path)?;
    changes::file_diff(
        &repo,
        &file_path,
        &mode,
        commit.as_deref(),
        old_path.as_deref(),
        untracked,
        context.unwrap_or(3),
    )
}

#[tauri::command]
pub async fn get_blame(repo_path: String, file_path: String) -> Result<Vec<BlameLine>, AppError> {
    let repo = repo(&repo_path)?;
    history::blame(&repo, &file_path)
}

#[tauri::command]
pub async fn get_file_history(
    repo_path: String,
    file_path: String,
    limit: Option<u32>,
) -> Result<Vec<CommitEntry>, AppError> {
    let repo = repo(&repo_path)?;
    history::file_history(&repo, &file_path, limit.unwrap_or(100))
}

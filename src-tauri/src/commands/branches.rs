use super::op_result;
use crate::error::{AppError, AppResult};
use crate::git::GitRepo;
use crate::gitops::{merge, refs, undo};
use crate::models::{
    ActionOutcome, Branch, ConflictSides, GitOpResult, Remote, Stash, Tag, UndoStatus, Worktree,
};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn repo(path: &str) -> AppResult<GitRepo> {
    GitRepo::discover(PathBuf::from(path))
}

#[tauri::command]
pub async fn list_branches(repo_path: String) -> Result<Vec<Branch>, AppError> {
    refs::list_branches(&repo(&repo_path)?)
}

#[tauri::command]
pub async fn list_tags(repo_path: String) -> Result<Vec<Tag>, AppError> {
    refs::list_tags(&repo(&repo_path)?)
}

#[tauri::command]
pub async fn list_stashes(repo_path: String) -> Result<Vec<Stash>, AppError> {
    refs::list_stashes(&repo(&repo_path)?)
}

#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>, AppError> {
    refs::list_worktrees(&repo(&repo_path)?)
}

#[tauri::command]
pub async fn list_remotes(repo_path: String) -> Result<Vec<Remote>, AppError> {
    refs::list_remotes(&repo(&repo_path)?)
}

#[tauri::command]
pub async fn checkout_branch(
    repo_path: String,
    branch: String,
    is_remote: bool,
) -> Result<GitOpResult, AppError> {
    Ok(op_result(refs::checkout_branch(
        &repo(&repo_path)?,
        &branch,
        is_remote,
    )?))
}

#[tauri::command]
pub async fn create_branch(
    repo_path: String,
    name: String,
    start_point: Option<String>,
    checkout: bool,
) -> Result<GitOpResult, AppError> {
    let repo = repo(&repo_path)?;
    Ok(op_result(refs::create_branch(
        &repo,
        &name,
        start_point.as_deref(),
        checkout,
    )?))
}

#[tauri::command]
pub async fn rename_branch(
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<GitOpResult, AppError> {
    Ok(op_result(refs::rename_branch(
        &repo(&repo_path)?,
        &old_name,
        &new_name,
    )?))
}

#[tauri::command]
pub async fn delete_branch(
    repo_path: String,
    name: String,
    force: bool,
    confirmed: bool,
) -> Result<GitOpResult, AppError> {
    if !confirmed {
        return Err(AppError::new(
            "Borrar una rama requiere una confirmación explícita.",
        ));
    }
    Ok(op_result(refs::delete_branch(
        &repo(&repo_path)?,
        &name,
        force,
    )?))
}

#[tauri::command]
pub async fn create_tag(
    repo_path: String,
    name: String,
    rev: String,
    message: Option<String>,
) -> Result<GitOpResult, AppError> {
    Ok(op_result(refs::create_tag(
        &repo(&repo_path)?,
        &name,
        &rev,
        message.as_deref(),
    )?))
}

#[tauri::command]
pub async fn delete_tag(repo_path: String, name: String) -> Result<GitOpResult, AppError> {
    Ok(op_result(refs::delete_tag(&repo(&repo_path)?, &name)?))
}

#[tauri::command]
pub async fn create_stash(
    repo_path: String,
    message: Option<String>,
    include_untracked: bool,
) -> Result<GitOpResult, AppError> {
    Ok(op_result(refs::create_stash(
        &repo(&repo_path)?,
        message.as_deref(),
        include_untracked,
    )?))
}

#[tauri::command]
pub async fn apply_stash(
    repo_path: String,
    selector: String,
    pop: bool,
) -> Result<GitOpResult, AppError> {
    Ok(op_result(refs::apply_stash(
        &repo(&repo_path)?,
        &selector,
        pop,
    )?))
}

#[tauri::command]
pub async fn drop_stash(
    repo_path: String,
    selector: String,
    confirmed: bool,
) -> Result<GitOpResult, AppError> {
    if !confirmed {
        return Err(AppError::new(
            "Borrar un stash requiere una confirmación explícita.",
        ));
    }
    Ok(op_result(refs::drop_stash(&repo(&repo_path)?, &selector)?))
}

#[tauri::command]
pub async fn add_remote(
    repo_path: String,
    name: String,
    url: String,
) -> Result<GitOpResult, AppError> {
    Ok(op_result(refs::add_remote(
        &repo(&repo_path)?,
        &name,
        &url,
    )?))
}

#[tauri::command]
pub async fn remove_remote(repo_path: String, name: String) -> Result<GitOpResult, AppError> {
    Ok(op_result(refs::remove_remote(&repo(&repo_path)?, &name)?))
}

#[tauri::command]
pub async fn merge_branch(
    state: State<'_, AppState>,
    repo_path: String,
    rev: String,
    no_ff: bool,
    squash: bool,
    message: Option<String>,
) -> Result<ActionOutcome, AppError> {
    let repo = repo(&repo_path)?;
    let snapshot = undo::capture(&repo)?;
    let outcome = merge::merge(&repo, &rev, no_ff, squash, message.as_deref())?;
    if outcome.success {
        undo::record(
            &state.inner,
            &repo,
            snapshot,
            if squash { "merge --squash" } else { "merge" },
        );
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn abort_merge(repo_path: String) -> Result<GitOpResult, AppError> {
    Ok(op_result(merge::abort_merge(&repo(&repo_path)?)?))
}

#[tauri::command]
pub async fn rebase_onto(
    state: State<'_, AppState>,
    repo_path: String,
    rev: String,
) -> Result<ActionOutcome, AppError> {
    let repo = repo(&repo_path)?;
    let snapshot = undo::capture(&repo)?;
    let outcome = merge::rebase(&repo, &rev)?;
    if outcome.success {
        undo::record(&state.inner, &repo, snapshot, "rebase");
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn abort_rebase(repo_path: String) -> Result<GitOpResult, AppError> {
    Ok(op_result(merge::abort_rebase(&repo(&repo_path)?)?))
}

#[tauri::command]
pub async fn cherry_pick_commit(
    state: State<'_, AppState>,
    repo_path: String,
    rev: String,
) -> Result<ActionOutcome, AppError> {
    let repo = repo(&repo_path)?;
    let snapshot = undo::capture(&repo)?;
    let outcome = merge::cherry_pick(&repo, &rev)?;
    if outcome.success {
        undo::record(&state.inner, &repo, snapshot, "cherry-pick");
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn abort_cherry_pick(repo_path: String) -> Result<GitOpResult, AppError> {
    Ok(op_result(merge::abort_cherry_pick(&repo(&repo_path)?)?))
}

#[tauri::command]
pub async fn revert_commit(
    state: State<'_, AppState>,
    repo_path: String,
    rev: String,
) -> Result<ActionOutcome, AppError> {
    let repo = repo(&repo_path)?;
    let snapshot = undo::capture(&repo)?;
    let outcome = merge::revert(&repo, &rev)?;
    if outcome.success {
        undo::record(&state.inner, &repo, snapshot, "revert");
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn abort_revert(repo_path: String) -> Result<GitOpResult, AppError> {
    Ok(op_result(merge::abort_revert(&repo(&repo_path)?)?))
}

#[tauri::command]
pub async fn reset_to_commit(
    state: State<'_, AppState>,
    repo_path: String,
    rev: String,
    mode: String,
    confirmed: bool,
) -> Result<GitOpResult, AppError> {
    if mode == "hard" && !confirmed {
        return Err(AppError::new(
            "Un reset --hard requiere una confirmación explícita.",
        ));
    }
    let repo = repo(&repo_path)?;
    let snapshot = undo::capture(&repo)?;
    let output = merge::reset(&repo, &rev, &mode)?;
    undo::record(&state.inner, &repo, snapshot, &format!("reset --{mode}"));
    Ok(op_result(output))
}

#[tauri::command]
pub async fn get_conflict_sides(
    repo_path: String,
    file_path: String,
) -> Result<ConflictSides, AppError> {
    merge::conflict_sides(&repo(&repo_path)?, &file_path)
}

#[tauri::command]
pub async fn resolve_with_side(
    repo_path: String,
    file_path: String,
    side: String,
) -> Result<GitOpResult, AppError> {
    Ok(op_result(merge::resolve_with_side(
        &repo(&repo_path)?,
        &file_path,
        &side,
    )?))
}

#[tauri::command]
pub async fn mark_resolved(repo_path: String, file_path: String) -> Result<GitOpResult, AppError> {
    Ok(op_result(merge::mark_resolved(
        &repo(&repo_path)?,
        &file_path,
    )?))
}

#[tauri::command]
pub async fn get_undo_status(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<UndoStatus, AppError> {
    undo::status(&state.inner, &repo(&repo_path)?)
}

#[tauri::command]
pub async fn undo_last(state: State<'_, AppState>, repo_path: String) -> Result<String, AppError> {
    undo::undo(&state.inner, &repo(&repo_path)?)
}

#[tauri::command]
pub async fn redo_last(state: State<'_, AppState>, repo_path: String) -> Result<String, AppError> {
    undo::redo(&state.inner, &repo(&repo_path)?)
}

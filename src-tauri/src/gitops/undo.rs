use crate::error::{AppError, AppResult};
use crate::git::GitRepo;
use crate::models::UndoStatus;
use crate::state::{Inner, Snapshot};
use std::sync::{Arc, Mutex};

pub fn capture(repo: &GitRepo) -> AppResult<Option<Snapshot>> {
    let Some(head) = repo.head()? else {
        return Ok(None);
    };
    Ok(Some(Snapshot {
        head,
        branch: repo.current_branch()?,
        label: String::new(),
    }))
}

pub fn record(inner: &Arc<Mutex<Inner>>, repo: &GitRepo, snapshot: Option<Snapshot>, label: &str) {
    let Some(mut snapshot) = snapshot else {
        return;
    };
    snapshot.label = label.to_string();
    if let Ok(mut guard) = inner.lock() {
        let stack = guard
            .undo
            .entry(repo.path.display().to_string())
            .or_default();
        stack.undo.push(snapshot);
        if stack.undo.len() > 50 {
            stack.undo.remove(0);
        }
        stack.redo.clear();
    }
}

fn reflog_entry_is_safe(subject: &str) -> bool {
    let latest = subject.to_ascii_lowercase();
    [
        "commit",
        "merge",
        "reset",
        "rebase",
        "cherry-pick",
        "revert",
        "pull",
    ]
    .iter()
    .any(|prefix| latest.starts_with(*prefix))
}

fn reflog_entries(repo: &GitRepo) -> AppResult<Vec<(String, String)>> {
    let out = repo.run(&[
        "reflog",
        "show",
        "--no-color",
        "--format=%H%x1f%gs",
        "-n",
        "8",
        "HEAD",
    ])?;
    if !out.success {
        return Ok(Vec::new());
    }
    Ok(out
        .stdout
        .lines()
        .filter_map(|line| {
            let (hash, subject) = line.split_once('\u{1f}')?;
            let hash = hash.trim();
            if hash.is_empty() {
                None
            } else {
                Some((hash.to_string(), subject.trim().to_string()))
            }
        })
        .collect())
}

pub fn status(inner: &Arc<Mutex<Inner>>, repo: &GitRepo) -> AppResult<UndoStatus> {
    let (undo_label, can_undo_app) = {
        let guard = inner
            .lock()
            .map_err(|_| AppError::new("Estado interno no disponible."))?;
        match guard.undo.get(&repo.path.display().to_string()) {
            Some(stack) => (
                stack.undo.last().map(|s| format!("Deshacer {}", s.label)),
                !stack.undo.is_empty(),
            ),
            None => (None, false),
        }
    };
    let (redo_label, can_redo) = {
        let guard = inner
            .lock()
            .map_err(|_| AppError::new("Estado interno no disponible."))?;
        match guard.undo.get(&repo.path.display().to_string()) {
            Some(stack) => (
                stack.redo.last().map(|s| format!("Rehacer {}", s.label)),
                !stack.redo.is_empty(),
            ),
            None => (None, false),
        }
    };

    let mut warning = None;
    let mut can_undo = can_undo_app;
    let mut label = undo_label;
    if !can_undo {
        let entries = reflog_entries(repo).unwrap_or_default();
        if entries.len() >= 2 && reflog_entry_is_safe(&entries[0].1) {
            can_undo = true;
            label = Some("Deshacer último cambio de HEAD (reflog)".into());
            warning = Some(
                "No hay historial de esta sesión. Se usará el reflog de Git; se exige un árbol de trabajo limpio y no se puede garantizar que la operación anterior sea segura."
                    .into(),
            );
        }
    }
    Ok(UndoStatus {
        can_undo,
        can_redo,
        warning,
        undo_label: label,
        redo_label,
    })
}

pub fn undo(inner: &Arc<Mutex<Inner>>, repo: &GitRepo) -> AppResult<String> {
    repo.ensure_clean_worktree()?;
    let current_head = repo
        .head()?
        .ok_or_else(|| AppError::new("No hay commits para deshacer."))?;
    let current_branch = repo.current_branch()?;
    let key = repo.path.display().to_string();

    let snapshot = {
        let mut guard = inner
            .lock()
            .map_err(|_| AppError::new("Estado interno no disponible."))?;
        guard.undo.get_mut(&key).and_then(|stack| stack.undo.pop())
    };

    let (snapshot, from_reflog) = if let Some(snapshot) = snapshot {
        (snapshot, false)
    } else {
        let entries = reflog_entries(repo)?;
        if entries.len() < 2 {
            return Err(AppError::new("No hay ninguna operación para deshacer."));
        }
        if entries[0].0 != current_head {
            return Err(AppError::new(
                "El reflog de Git no coincide con HEAD. Refresca el repositorio e inténtalo de nuevo.",
            ));
        }
        if !reflog_entry_is_safe(&entries[0].1) {
            return Err(AppError::new(
                "La última entrada del reflog no parece una operación que se pueda deshacer con seguridad (por ejemplo, un cambio de rama). Hazlo manualmente desde la terminal para no perder trabajo.",
            ));
        }
        (
            Snapshot {
                head: entries[1].0.clone(),
                branch: current_branch.clone(),
                label: entries[1].1.clone(),
            },
            true,
        )
    };

    if snapshot.head == current_head {
        return Err(AppError::new("No hay cambios que deshacer."));
    }
    if snapshot.branch != current_branch {
        return Err(AppError::new(
            "No se puede deshacer porque se cambió de rama después de la operación. Haz el cambio manualmente para no perder trabajo.",
        ));
    }

    repo.checked(
        &["reset", "--hard", snapshot.head.as_str()],
        "git reset --hard",
    )?;
    if let Ok(mut guard) = inner.lock() {
        let stack = guard.undo.entry(key).or_default();
        stack.redo.push(Snapshot {
            head: current_head,
            branch: current_branch,
            label: snapshot.label.clone(),
        });
    }
    Ok(if from_reflog {
        "Operación deshecha usando el reflog de Git. Revisa el historial antes de continuar.".into()
    } else {
        "Última operación deshecha.".into()
    })
}

pub fn redo(inner: &Arc<Mutex<Inner>>, repo: &GitRepo) -> AppResult<String> {
    repo.ensure_clean_worktree()?;
    let current_head = repo
        .head()?
        .ok_or_else(|| AppError::new("No hay commits para rehacer."))?;
    let current_branch = repo.current_branch()?;
    let key = repo.path.display().to_string();

    let snapshot = {
        let mut guard = inner
            .lock()
            .map_err(|_| AppError::new("Estado interno no disponible."))?;
        guard.undo.get_mut(&key).and_then(|stack| stack.redo.pop())
    }
    .ok_or_else(|| AppError::new("No hay ninguna operación para rehacer."))?;

    if snapshot.branch != current_branch {
        return Err(AppError::new(
            "No se puede rehacer porque se cambió de rama. Haz el cambio manualmente para no perder trabajo.",
        ));
    }
    repo.checked(
        &["reset", "--hard", snapshot.head.as_str()],
        "git reset --hard",
    )?;
    if let Ok(mut guard) = inner.lock() {
        let stack = guard.undo.entry(key).or_default();
        stack.undo.push(Snapshot {
            head: current_head,
            branch: current_branch,
            label: snapshot.label.clone(),
        });
    }
    Ok("Última operación rehecha.".into())
}

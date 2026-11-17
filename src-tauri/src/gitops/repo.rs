use crate::error::{AppError, AppResult};
use crate::git::{short_hash, GitRepo};
use crate::models::{FileStatus, RepoInfo, RepoState, StatusInfo};

pub fn repo_state(repo: &GitRepo, git_version: &str) -> AppResult<RepoState> {
    let status = status_info(repo)?;
    let info = repo_info(repo, git_version, &status)?;
    Ok(RepoState { info, status })
}

pub fn repo_info(repo: &GitRepo, git_version: &str, status: &StatusInfo) -> AppResult<RepoInfo> {
    let head = repo.head()?;
    let git_dir = repo.git_dir()?;
    let (identity_name, identity_name_origin) = config_show_origin(repo, "user.name")?;
    let (identity_email, identity_email_origin) = config_show_origin(repo, "user.email")?;
    let sign_configured = repo
        .run(&["config", "--bool", "--get", "commit.gpgsign"])
        .map(|o| o.success && o.stdout.trim() == "true")
        .unwrap_or(false);

    let name = repo
        .path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| repo.path.display().to_string());

    Ok(RepoInfo {
        path: repo.path.display().to_string(),
        name,
        git_version: git_version.to_string(),
        git_dir: git_dir.display().to_string(),
        head: head.clone(),
        short_head: head.as_deref().map(short_hash),
        branch: status.branch.clone(),
        detached: status.detached,
        unborn: status.unborn,
        identity_name,
        identity_email,
        identity_name_origin,
        identity_email_origin,
        upstream: status.upstream.clone(),
        ahead: status.ahead,
        behind: status.behind,
        merge_in_progress: git_dir.join("MERGE_HEAD").is_file(),
        rebase_in_progress: git_dir.join("rebase-merge").is_dir()
            || git_dir.join("rebase-apply").is_dir(),
        cherry_pick_in_progress: git_dir.join("CHERRY_PICK_HEAD").is_file(),
        revert_in_progress: git_dir.join("REVERT_HEAD").is_file(),
        sign_configured,
        has_commits: head.is_some(),
    })
}

fn config_show_origin(repo: &GitRepo, key: &str) -> AppResult<(Option<String>, Option<String>)> {
    let out = repo.run(&["config", "--show-origin", "--get", key])?;
    if !out.success {
        return Ok((None, None));
    }
    let raw = out.stdout.trim_end_matches(['\r', '\n']).to_string();
    if raw.is_empty() {
        return Ok((None, None));
    }
    let (origin, value) = match raw.split_once('\t') {
        Some((origin, value)) => (Some(origin.to_string()), value.to_string()),
        None => (None, raw),
    };
    let value = value.trim().to_string();
    if value.is_empty() {
        Ok((None, origin))
    } else {
        Ok((Some(value), origin))
    }
}

pub fn status_info(repo: &GitRepo) -> AppResult<StatusInfo> {
    let out = repo.checked(
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
            "-z",
        ],
        "git status",
    )?;
    if out.stdout.is_empty() {
        return Ok(StatusInfo::default());
    }

    let mut status = StatusInfo::default();
    let mut tokens = out.stdout.split('\0').peekable();

    while let Some(record) = tokens.next() {
        if record.is_empty() {
            continue;
        }
        if let Some(rest) = record.strip_prefix("# branch.oid ") {
            if rest == "(initial)" {
                status.unborn = true;
            }
            continue;
        }
        if let Some(rest) = record.strip_prefix("# branch.head ") {
            if rest == "(detached)" {
                status.detached = true;
                status.branch = None;
            } else {
                status.branch = Some(rest.to_string());
            }
            continue;
        }
        if let Some(rest) = record.strip_prefix("# branch.upstream ") {
            status.upstream = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = record.strip_prefix("# branch.ab ") {
            let mut parts = rest.split_whitespace();
            if let Some(ahead) = parts.next() {
                status.ahead = ahead.trim_start_matches('+').parse().unwrap_or(0);
            }
            if let Some(behind) = parts.next() {
                status.behind = behind.trim_start_matches('-').parse().unwrap_or(0);
            }
            continue;
        }
        if record.starts_with('#') {
            continue;
        }

        let kind = record.chars().next().unwrap_or(' ');
        match kind {
            '1' => {
                let fields: Vec<&str> = record.splitn(9, ' ').collect();
                if fields.len() == 9 {
                    add_pair(&mut status, fields[1], fields[8], None);
                }
            }
            '2' => {
                let fields: Vec<&str> = record.splitn(10, ' ').collect();
                if fields.len() == 10 {
                    // En modo -z la ruta original viene en el siguiente registro.
                    let original = tokens.next().unwrap_or("").to_string();
                    add_pair(&mut status, fields[1], fields[9], Some(original));
                }
            }
            'u' => {
                let fields: Vec<&str> = record.splitn(11, ' ').collect();
                if fields.len() == 11 {
                    status.conflicted.push(FileStatus {
                        path: fields[10].to_string(),
                        orig_path: None,
                        status: "U".to_string(),
                        untracked: false,
                        conflicted: true,
                    });
                }
            }
            '?' => {
                if let Some((_, path)) = record.split_once(' ') {
                    status.unstaged.push(FileStatus {
                        path: path.to_string(),
                        orig_path: None,
                        status: "?".to_string(),
                        untracked: true,
                        conflicted: false,
                    });
                }
            }
            _ => {}
        }
    }

    Ok(status)
}

fn add_pair(status: &mut StatusInfo, xy: &str, path: &str, orig: Option<String>) {
    let mut chars = xy.chars();
    let x = chars.next().unwrap_or('.');
    let y = chars.next().unwrap_or('.');

    if x != '.' && x != '?' {
        status.staged.push(FileStatus {
            path: path.to_string(),
            orig_path: orig.clone(),
            status: x.to_string(),
            untracked: false,
            conflicted: false,
        });
    }
    if y != '.' && y != '?' {
        status.unstaged.push(FileStatus {
            path: path.to_string(),
            orig_path: orig,
            status: y.to_string(),
            untracked: false,
            conflicted: false,
        });
    }
}

/// Comprueba que un archivo pertenece al repositorio antes de tocarlo.
pub fn ensure_inside_repo(repo: &GitRepo, relative: &str) -> AppResult<()> {
    crate::git::validate_relative_path(relative)?;
    let full = repo.path.join(relative);
    let canonical_repo = std::fs::canonicalize(&repo.path)
        .map_err(|e| AppError::new(format!("No se pudo leer el repositorio: {e}")))?;
    if full.exists() {
        let canonical = std::fs::canonicalize(&full)
            .map_err(|e| AppError::new(format!("No se pudo leer el archivo: {e}")))?;
        if !canonical.starts_with(&canonical_repo) {
            return Err(AppError::new(
                "La ruta apunta fuera del repositorio y se ha rechazado.",
            ));
        }
    } else {
        let normalized = full
            .components()
            .fold(std::path::PathBuf::new(), |mut acc, part| {
                match part {
                    std::path::Component::ParentDir => {
                        acc.pop();
                    }
                    std::path::Component::CurDir => {}
                    other => acc.push(other.as_os_str()),
                }
                acc
            });
        if !normalized.starts_with(&canonical_repo) {
            return Err(AppError::new(
                "La ruta apunta fuera del repositorio y se ha rechazado.",
            ));
        }
    }
    Ok(())
}

use crate::error::{AppError, AppResult};
use crate::git::{validate_relative_path, GitOutput, GitRepo};
use crate::gitops::repo::status_info;
use crate::models::{ActionOutcome, ConflictSides};

fn safe_rev(repo: &GitRepo, rev: &str) -> AppResult<String> {
    let trimmed = rev.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("Falta la referencia de Git."));
    }
    repo.resolve_commit(trimmed)?;
    Ok(trimmed.to_string())
}

fn outcome(repo: &GitRepo, output: GitOutput) -> AppResult<ActionOutcome> {
    let conflicts = !status_info(repo)?.conflicted.is_empty();
    if !output.success && !conflicts {
        let detail = if output.stderr.trim().is_empty() {
            output.stdout
        } else {
            output.stderr
        };
        return Err(AppError::with_stderr(
            format!("La operación de Git falló (código {}).", output.code),
            detail,
            Some(output.code),
        ));
    }
    Ok(ActionOutcome {
        success: output.success,
        conflicts,
        stdout: output.stdout,
        stderr: output.stderr,
        code: output.code,
    })
}

pub fn merge(
    repo: &GitRepo,
    rev: &str,
    no_ff: bool,
    squash: bool,
    message: Option<&str>,
) -> AppResult<ActionOutcome> {
    let rev = safe_rev(repo, rev)?;
    let mut args: Vec<String> = vec!["merge".into(), "--no-edit".into()];
    if no_ff {
        args.push("--no-ff".into());
    }
    if squash {
        args.push("--squash".into());
    }
    if let Some(message) = message.filter(|m| !m.trim().is_empty()) {
        args.push("-m".into());
        args.push(message.to_string());
    }
    args.push(rev);
    let output = repo.run(&args)?;
    outcome(repo, output)
}

pub fn abort_merge(repo: &GitRepo) -> AppResult<GitOutput> {
    repo.checked(&["merge", "--abort"], "git merge --abort")
}

pub fn rebase(repo: &GitRepo, rev: &str) -> AppResult<ActionOutcome> {
    let rev = safe_rev(repo, rev)?;
    let output = repo.run(&["rebase", rev.as_str()])?;
    outcome(repo, output)
}

pub fn abort_rebase(repo: &GitRepo) -> AppResult<GitOutput> {
    repo.checked(&["rebase", "--abort"], "git rebase --abort")
}

pub fn cherry_pick(repo: &GitRepo, rev: &str) -> AppResult<ActionOutcome> {
    let sha = repo.resolve_commit(rev)?;
    let output = repo.run(&["cherry-pick", sha.as_str()])?;
    outcome(repo, output)
}

pub fn abort_cherry_pick(repo: &GitRepo) -> AppResult<GitOutput> {
    repo.checked(&["cherry-pick", "--abort"], "git cherry-pick --abort")
}

pub fn revert(repo: &GitRepo, rev: &str) -> AppResult<ActionOutcome> {
    let sha = repo.resolve_commit(rev)?;
    let output = repo.run(&["revert", "--no-edit", sha.as_str()])?;
    outcome(repo, output)
}

pub fn abort_revert(repo: &GitRepo) -> AppResult<GitOutput> {
    repo.checked(&["revert", "--abort"], "git revert --abort")
}

pub fn reset(repo: &GitRepo, rev: &str, mode: &str) -> AppResult<GitOutput> {
    let sha = repo.resolve_commit(rev)?;
    let flag = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(AppError::new("Modo de reset no válido.")),
    };
    repo.checked(&["reset", flag, sha.as_str()], "git reset")
}

pub fn conflict_sides(repo: &GitRepo, file_path: &str) -> AppResult<ConflictSides> {
    validate_relative_path(file_path)?;
    let ours = read_stage(repo, 2, file_path)?;
    let theirs = read_stage(repo, 3, file_path)?;
    let binary = is_binary(&ours) || is_binary(&theirs);
    Ok(ConflictSides {
        ours: String::from_utf8_lossy(&ours).to_string(),
        theirs: String::from_utf8_lossy(&theirs).to_string(),
        ours_label: "Nuestro lado (ours)".into(),
        theirs_label: "Su lado (theirs)".into(),
        binary,
    })
}

fn read_stage(repo: &GitRepo, stage: u8, file_path: &str) -> AppResult<Vec<u8>> {
    let out = repo.run(&["show", &format!(":{stage}:{file_path}")])?;
    if out.success {
        Ok(out.stdout.into_bytes())
    } else {
        Ok(Vec::new())
    }
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|b| *b == 0) || std::str::from_utf8(bytes).is_err()
}

pub fn resolve_with_side(repo: &GitRepo, file_path: &str, side: &str) -> AppResult<GitOutput> {
    validate_relative_path(file_path)?;
    let flag = match side {
        "ours" => "--ours",
        "theirs" => "--theirs",
        _ => return Err(AppError::new("Lado de conflicto no válido.")),
    };
    repo.checked(&["checkout", flag, "--", file_path], "git checkout")?;
    repo.checked(&["add", "--", file_path], "git add")
}

pub fn mark_resolved(repo: &GitRepo, file_path: &str) -> AppResult<GitOutput> {
    validate_relative_path(file_path)?;
    let full = repo.path.join(file_path);
    if full.exists() {
        repo.checked(&["add", "--", file_path], "git add")
    } else {
        repo.checked(&["rm", "--ignore-unmatch", "--", file_path], "git rm")
    }
}

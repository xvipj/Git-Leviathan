use crate::error::{AppError, AppResult};
use crate::git::{validate_ref_name, validate_remote_name, GitOutput, GitRepo, RefKind};
use crate::models::{Branch, Remote, Stash, Tag, Worktree};

pub fn list_branches(repo: &GitRepo) -> AppResult<Vec<Branch>> {
    // `for-each-ref` interpreta escapes hexadecimales como `%xx`, no `%xXX`.
    let format = "%(refname)\u{1f}%(objectname)\u{1f}%(HEAD)\u{1f}%(upstream:short)\u{1f}%(committerdate:iso-strict)\u{1f}%(contents:subject)";
    let out = repo.checked(
        &[
            "for-each-ref",
            "--sort=-committerdate",
            &format!("--format={format}"),
            "refs/heads",
            "refs/remotes",
        ],
        "git for-each-ref",
    )?;
    let mut branches = Vec::new();
    for line in out.stdout.lines() {
        let fields: Vec<&str> = line.splitn(6, '\u{1f}').collect();
        if fields.len() < 6 {
            continue;
        }
        let full_name = fields[0].to_string();
        let (is_remote, remote, name) = if let Some(rest) = full_name.strip_prefix("refs/heads/") {
            (false, None, rest.to_string())
        } else if let Some(rest) = full_name.strip_prefix("refs/remotes/") {
            let mut parts = rest.splitn(2, '/');
            let remote = parts.next().unwrap_or("").to_string();
            let name = parts.next().unwrap_or("").to_string();
            (true, Some(remote), name)
        } else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let upstream = fields[3].trim();
        branches.push(Branch {
            name,
            full_name,
            is_remote,
            is_current: fields[2].trim() == "*",
            upstream: if upstream.is_empty() {
                None
            } else {
                Some(upstream.to_string())
            },
            head: fields[1].to_string(),
            subject: fields[5].trim_end_matches(['\r', '\n']).to_string(),
            date: fields[4].to_string(),
            remote,
        });
    }
    Ok(branches)
}

pub fn checkout_branch(repo: &GitRepo, branch: &str, is_remote: bool) -> AppResult<GitOutput> {
    if is_remote {
        let full = format!("refs/remotes/{branch}");
        let verified = repo.run(&["rev-parse", "--verify", full.as_str()])?;
        if !verified.success {
            return Err(AppError::with_stderr(
                format!("La rama remota «{branch}» no existe."),
                verified.stderr,
                Some(verified.code),
            ));
        }
        let local = branch
            .split_once('/')
            .map(|(_, rest)| rest)
            .unwrap_or(branch);
        validate_ref_name(repo, local, RefKind::Branch)?;
        let local_ref = format!("refs/heads/{local}");
        let exists = repo.run(&["show-ref", "--verify", "--quiet", local_ref.as_str()])?;
        if exists.success {
            repo.checked(&["checkout", local], "git checkout")
        } else {
            repo.checked(
                &["checkout", "-b", local, "--track", full.as_str()],
                "git checkout",
            )
        }
    } else {
        validate_ref_name(repo, branch, RefKind::Branch)?;
        repo.checked(&["checkout", branch], "git checkout")
    }
}

pub fn create_branch(
    repo: &GitRepo,
    name: &str,
    start_point: Option<&str>,
    checkout: bool,
) -> AppResult<GitOutput> {
    validate_ref_name(repo, name, RefKind::Branch)?;
    let start = match start_point {
        Some(rev) if !rev.trim().is_empty() => repo.resolve_commit(rev)?,
        _ => repo
            .head()?
            .ok_or_else(|| AppError::new("Todavía no hay ningún commit para crear la rama."))?,
    };
    if checkout {
        repo.checked(&["checkout", "-b", name, start.as_str()], "git checkout -b")
    } else {
        repo.checked(&["branch", name, start.as_str()], "git branch")
    }
}

pub fn rename_branch(repo: &GitRepo, old: &str, new: &str) -> AppResult<GitOutput> {
    validate_ref_name(repo, old, RefKind::Branch)?;
    validate_ref_name(repo, new, RefKind::Branch)?;
    repo.checked(&["branch", "-m", old, new], "git branch -m")
}

pub fn delete_branch(repo: &GitRepo, name: &str, force: bool) -> AppResult<GitOutput> {
    validate_ref_name(repo, name, RefKind::Branch)?;
    let flag = if force { "-D" } else { "-d" };
    repo.checked(&["branch", flag, name], "git branch")
}

pub fn list_tags(repo: &GitRepo) -> AppResult<Vec<Tag>> {
    let format = "%(refname:short)\u{1f}%(refname)\u{1f}%(objectname)\u{1f}%(objecttype)\u{1f}%(taggername)\u{1f}%(creatordate:iso-strict)\u{1f}%(contents:subject)";
    let out = repo.checked(
        &[
            "for-each-ref",
            "--sort=-creatordate",
            &format!("--format={format}"),
            "refs/tags",
        ],
        "git for-each-ref",
    )?;
    let mut tags = Vec::new();
    for line in out.stdout.lines() {
        let fields: Vec<&str> = line.splitn(7, '\u{1f}').collect();
        if fields.len() < 7 {
            continue;
        }
        let object_type = fields[3].to_string();
        tags.push(Tag {
            name: fields[0].to_string(),
            full_name: fields[1].to_string(),
            target: fields[2].to_string(),
            annotated: object_type == "tag",
            object_type,
            tagger: if fields[4].trim().is_empty() {
                None
            } else {
                Some(fields[4].to_string())
            },
            date: fields[5].to_string(),
            subject: fields[6].trim_end_matches(['\r', '\n']).to_string(),
        });
    }
    Ok(tags)
}

pub fn create_tag(
    repo: &GitRepo,
    name: &str,
    rev: &str,
    message: Option<&str>,
) -> AppResult<GitOutput> {
    validate_ref_name(repo, name, RefKind::Tag)?;
    let sha = repo.resolve_commit(rev)?;
    if let Some(message) = message.filter(|m| !m.trim().is_empty()) {
        repo.checked(&["tag", "-a", name, "-m", message, sha.as_str()], "git tag")
    } else {
        repo.checked(&["tag", name, sha.as_str()], "git tag")
    }
}

pub fn delete_tag(repo: &GitRepo, name: &str) -> AppResult<GitOutput> {
    validate_ref_name(repo, name, RefKind::Tag)?;
    repo.checked(&["tag", "-d", name], "git tag -d")
}

pub fn list_stashes(repo: &GitRepo) -> AppResult<Vec<Stash>> {
    let out = repo.checked(
        &["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%ci"],
        "git stash list",
    )?;
    let mut stashes = Vec::new();
    for (index, line) in out.stdout.lines().enumerate() {
        let fields: Vec<&str> = line.splitn(4, '\u{1f}').collect();
        if fields.len() < 4 {
            continue;
        }
        stashes.push(Stash {
            index: index as u32,
            selector: fields[0].to_string(),
            hash: fields[1].to_string(),
            subject: fields[2]
                .trim_start_matches("On ")
                .trim_end_matches(['\r', '\n'])
                .to_string(),
            date: fields[3].to_string(),
        });
    }
    Ok(stashes)
}

pub fn create_stash(
    repo: &GitRepo,
    message: Option<&str>,
    include_untracked: bool,
) -> AppResult<GitOutput> {
    let mut args: Vec<String> = vec!["stash".into(), "push".into()];
    if include_untracked {
        args.push("--include-untracked".into());
    }
    if let Some(message) = message.filter(|m| !m.trim().is_empty()) {
        args.push("-m".into());
        args.push(message.to_string());
    }
    repo.checked(&args, "git stash push")
}

fn validate_stash_selector(selector: &str) -> AppResult<()> {
    let valid = selector.starts_with("stash@{")
        && selector.ends_with('}')
        && selector[7..selector.len() - 1]
            .chars()
            .all(|c| c.is_ascii_digit());
    if !valid {
        return Err(AppError::new("Selector de stash no válido."));
    }
    Ok(())
}

pub fn apply_stash(repo: &GitRepo, selector: &str, pop: bool) -> AppResult<GitOutput> {
    validate_stash_selector(selector)?;
    let verb = if pop { "pop" } else { "apply" };
    repo.checked(&["stash", verb, selector], "git stash")
}

pub fn drop_stash(repo: &GitRepo, selector: &str) -> AppResult<GitOutput> {
    validate_stash_selector(selector)?;
    repo.checked(&["stash", "drop", selector], "git stash drop")
}

pub fn list_worktrees(repo: &GitRepo) -> AppResult<Vec<Worktree>> {
    let out = repo.checked(&["worktree", "list", "--porcelain"], "git worktree list")?;
    let mut worktrees = Vec::new();
    let mut current: Option<Worktree> = None;
    for line in out.stdout.lines() {
        if line.is_empty() {
            if let Some(wt) = current.take() {
                worktrees.push(wt);
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(wt) = current.take() {
                worktrees.push(wt);
            }
            current = Some(Worktree {
                path: path.to_string(),
                head: None,
                branch: None,
                bare: false,
                detached: false,
                locked: false,
                prunable: false,
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(wt) = current.as_mut() {
                wt.head = Some(head.to_string());
            }
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(wt) = current.as_mut() {
                wt.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
            }
        } else if line == "bare" {
            if let Some(wt) = current.as_mut() {
                wt.bare = true;
            }
        } else if line == "detached" {
            if let Some(wt) = current.as_mut() {
                wt.detached = true;
            }
        } else if line.starts_with("locked") {
            if let Some(wt) = current.as_mut() {
                wt.locked = true;
            }
        } else if line.starts_with("prunable") {
            if let Some(wt) = current.as_mut() {
                wt.prunable = true;
            }
        }
    }
    if let Some(wt) = current.take() {
        worktrees.push(wt);
    }
    Ok(worktrees)
}

pub fn list_remotes(repo: &GitRepo) -> AppResult<Vec<Remote>> {
    let out = repo.checked(&["remote", "-v"], "git remote -v")?;
    let mut remotes: Vec<Remote> = Vec::new();
    for line in out.stdout.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 3 {
            continue;
        }
        let name = fields[0];
        let url = fields[1];
        if fields[2] == "(fetch)" {
            if let Some(existing) = remotes.iter_mut().find(|r| r.name == name) {
                existing.fetch_url = url.to_string();
            } else {
                remotes.push(Remote {
                    name: name.to_string(),
                    fetch_url: url.to_string(),
                    push_url: url.to_string(),
                });
            }
        } else if fields[2] == "(push)" {
            if let Some(existing) = remotes.iter_mut().find(|r| r.name == name) {
                existing.push_url = url.to_string();
            } else {
                remotes.push(Remote {
                    name: name.to_string(),
                    fetch_url: String::new(),
                    push_url: url.to_string(),
                });
            }
        }
    }
    Ok(remotes)
}

pub fn add_remote(repo: &GitRepo, name: &str, url: &str) -> AppResult<GitOutput> {
    validate_remote_name(name)?;
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') || url.chars().any(|c| c.is_control()) {
        return Err(AppError::new("La URL del remoto no es válida."));
    }
    repo.checked(&["remote", "add", name, url], "git remote add")
}

pub fn remove_remote(repo: &GitRepo, name: &str) -> AppResult<GitOutput> {
    validate_remote_name(name)?;
    repo.checked(&["remote", "remove", name], "git remote remove")
}

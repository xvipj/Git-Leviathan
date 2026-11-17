use crate::error::{AppError, AppResult};
use crate::git::{validate_relative_path, GitOutput, GitRepo};
use crate::gitops::repo::{ensure_inside_repo, status_info};
use crate::models::DiffResult;
use std::collections::HashSet;
use std::path::PathBuf;

pub fn missing_identity_error(repo: &GitRepo) -> AppResult<Option<String>> {
    let name = repo.run(&["config", "--get", "user.name"])?;
    let email = repo.run(&["config", "--get", "user.email"])?;
    let has_name = name.success && !name.stdout.trim().is_empty();
    let has_email = email.success && !email.stdout.trim().is_empty();
    if has_name && has_email {
        return Ok(None);
    }
    let missing = match (has_name, has_email) {
        (false, false) => "user.name y user.email",
        (false, true) => "user.name",
        _ => "user.email",
    };
    Ok(Some(format!(
        "Git no tiene configurado {missing} en este repositorio. Git Leviathan no define identidades por ti.\n\n\
         Configúralo en tu terminal (por ejemplo, para tu usuario global):\n\
         git config --global user.name \"Tu Nombre\"\n\
         git config --global user.email \"tu@correo.com\"\n\n\
         El próximo commit usará exactamente la identidad que Git tenga configurada."
    )))
}

pub fn file_diff(
    repo: &GitRepo,
    file_path: &str,
    mode: &str,
    commit: Option<&str>,
    old_path: Option<&str>,
    untracked: bool,
    context: u32,
) -> AppResult<DiffResult> {
    validate_relative_path(file_path)?;
    if let Some(old) = old_path {
        validate_relative_path(old)?;
    }
    if untracked {
        return untracked_diff(repo, file_path);
    }

    let context = context.clamp(0, 100);
    let mut args: Vec<String> = Vec::new();
    match mode {
        "staged" => {
            args.extend(
                [
                    "diff",
                    "--cached",
                    "--no-color",
                    "--no-ext-diff",
                    "--find-renames",
                ]
                .iter()
                .map(|s| s.to_string()),
            );
        }
        "commit" => {
            let hash = commit.ok_or_else(|| AppError::new("Falta el commit para el diff."))?;
            let sha = repo.resolve_commit(hash)?;
            let parents = commit_parents(repo, &sha)?;
            if let Some(parent) = parents.first() {
                args.extend(
                    [
                        "diff",
                        "--no-color",
                        "--no-ext-diff",
                        "--find-renames",
                        parent.as_str(),
                        sha.as_str(),
                    ]
                    .iter()
                    .map(|s| s.to_string()),
                );
            } else {
                args.extend(
                    ["show", "--format=", "--no-color", "--no-ext-diff"]
                        .iter()
                        .map(|s| s.to_string()),
                );
                args.push(sha);
            }
        }
        _ => {
            args.extend(
                ["diff", "--no-color", "--no-ext-diff", "--find-renames"]
                    .iter()
                    .map(|s| s.to_string()),
            );
        }
    }
    args.push(format!("--unified={context}"));
    args.push("--".into());
    if let Some(old) = old_path {
        args.push(old.to_string());
    }
    args.push(file_path.to_string());

    let out = repo.checked(&args, "git diff")?;
    let content = out.stdout;
    let binary = content
        .lines()
        .any(|line| line.starts_with("Binary files ") || line.starts_with("Binary file "));
    Ok(DiffResult {
        content,
        binary,
        untracked: false,
    })
}

fn commit_parents(repo: &GitRepo, sha: &str) -> AppResult<Vec<String>> {
    let out = repo.checked(&["rev-list", "--parents", "-n", "1", sha], "git rev-list")?;
    let mut parts = out.stdout.split_whitespace();
    let _commit = parts.next();
    Ok(parts.map(|s| s.to_string()).collect())
}

fn untracked_diff(repo: &GitRepo, file_path: &str) -> AppResult<DiffResult> {
    let full = repo.path.join(file_path);
    let bytes = std::fs::read(&full)
        .map_err(|e| AppError::new(format!("No se pudo leer el archivo {file_path}: {e}")))?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Ok(DiffResult {
            content: String::new(),
            binary: true,
            untracked: true,
        });
    }
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => {
            return Ok(DiffResult {
                content: String::new(),
                binary: true,
                untracked: true,
            })
        }
    };
    if text.contains('\0') {
        return Ok(DiffResult {
            content: String::new(),
            binary: true,
            untracked: true,
        });
    }

    let mut lines: Vec<&str> = text.split('\n').collect();
    let ends_with_newline = text.ends_with('\n');
    if ends_with_newline {
        lines.pop();
    }
    if text.is_empty() {
        lines.clear();
    }
    let mut content = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{count} @@\n",
        path = file_path,
        count = lines.len()
    );
    for line in &lines {
        content.push('+');
        content.push_str(line.trim_end_matches('\r'));
        content.push('\n');
    }
    if !text.is_empty() && !ends_with_newline {
        content.push_str("\\ No newline at end of file\n");
    }
    Ok(DiffResult {
        content,
        binary: false,
        untracked: true,
    })
}

pub fn stage_paths(repo: &GitRepo, paths: &[String]) -> AppResult<GitOutput> {
    if paths.is_empty() {
        return Err(AppError::new("No hay archivos que preparar."));
    }
    for path in paths {
        validate_relative_path(path)?;
    }
    let mut args: Vec<String> = vec!["add".into(), "--".into()];
    args.extend(paths.iter().cloned());
    repo.checked(&args, "git add")
}

pub fn stage_all(repo: &GitRepo) -> AppResult<GitOutput> {
    repo.checked(&["add", "-A", "--", "."], "git add")
}

pub fn unstage_paths(repo: &GitRepo, paths: &[String]) -> AppResult<GitOutput> {
    if paths.is_empty() {
        return Err(AppError::new(
            "No hay archivos que quitar del área de preparación.",
        ));
    }
    for path in paths {
        validate_relative_path(path)?;
    }
    if repo.head()?.is_none() {
        let mut args: Vec<String> = vec![
            "rm".into(),
            "--cached".into(),
            "-r".into(),
            "-f".into(),
            "--".into(),
        ];
        args.extend(paths.iter().cloned());
        return repo.checked(&args, "git rm --cached");
    }
    let mut args: Vec<String> = vec!["restore".into(), "--staged".into(), "--".into()];
    args.extend(paths.iter().cloned());
    repo.checked(&args, "git restore --staged")
}

pub fn unstage_all(repo: &GitRepo) -> AppResult<GitOutput> {
    if repo.head()?.is_none() {
        return repo.checked(
            &["rm", "--cached", "-r", "-f", "--", "."],
            "git rm --cached",
        );
    }
    repo.checked(&["restore", "--staged", "--", "."], "git restore --staged")
}

pub fn discard_paths(repo: &GitRepo, paths: &[String]) -> AppResult<GitOutput> {
    if paths.is_empty() {
        return Err(AppError::new("No hay archivos que descartar."));
    }
    for path in paths {
        validate_relative_path(path)?;
    }
    let status = status_info(repo)?;
    let untracked: HashSet<String> = status
        .unstaged
        .iter()
        .filter(|f| f.untracked)
        .map(|f| f.path.clone())
        .collect();

    let mut tracked = Vec::new();
    for path in paths {
        if untracked.contains(path) {
            ensure_inside_repo(repo, path)?;
            let full: PathBuf = repo.path.join(path);
            if full.exists() {
                if full.is_dir() {
                    std::fs::remove_dir_all(&full).map_err(|e| {
                        AppError::new(format!("No se pudo borrar la carpeta {path}: {e}"))
                    })?;
                } else {
                    std::fs::remove_file(&full).map_err(|e| {
                        AppError::new(format!("No se pudo borrar el archivo {path}: {e}"))
                    })?;
                }
            }
        } else {
            tracked.push(path.clone());
        }
    }

    if tracked.is_empty() {
        return Ok(GitOutput {
            stdout: String::new(),
            stderr: String::new(),
            code: 0,
            success: true,
        });
    }
    let mut args: Vec<String> = vec!["restore".into(), "--worktree".into(), "--".into()];
    args.extend(tracked);
    repo.checked(&args, "git restore")
}

pub fn discard_all(repo: &GitRepo) -> AppResult<GitOutput> {
    let status = status_info(repo)?;
    let paths: Vec<String> = status.unstaged.iter().map(|f| f.path.clone()).collect();
    if paths.is_empty() {
        return Err(AppError::new("No hay cambios sin preparar para descartar."));
    }
    discard_paths(repo, &paths)
}

pub fn apply_patch(
    repo: &GitRepo,
    patch: &str,
    cached: bool,
    reverse: bool,
) -> AppResult<GitOutput> {
    if patch.trim().is_empty() {
        return Err(AppError::new("El parche está vacío."));
    }
    let mut args: Vec<String> = vec![
        "apply".into(),
        "--recount".into(),
        "--whitespace=nowarn".into(),
    ];
    if cached {
        args.push("--cached".into());
    }
    if reverse {
        args.push("--reverse".into());
    }
    args.push("-".into());
    repo.checked_with_input(&args, patch.as_bytes(), "git apply")
}

pub fn commit(repo: &GitRepo, message: &str, amend: bool, sign: bool) -> AppResult<GitOutput> {
    if message.trim().is_empty() {
        return Err(AppError::new("El mensaje del commit no puede estar vacío."));
    }
    if amend && repo.head()?.is_none() {
        return Err(AppError::new("Todavía no hay un commit que enmendar."));
    }
    if let Some(message) = missing_identity_error(repo)? {
        return Err(AppError::new(message));
    }

    let mut args: Vec<String> = vec!["commit".into(), "-F".into(), "-".into()];
    if amend {
        args.push("--amend".into());
    }
    if sign {
        args.push("-S".into());
    }
    repo.checked_with_input(&args, message.as_bytes(), "git commit")
}

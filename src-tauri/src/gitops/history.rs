use crate::error::{AppError, AppResult};
use crate::git::{short_hash, validate_relative_path, GitRepo};
use crate::models::{
    BlameLine, ChangedFile, CommitDetails, CommitEntry, HistoryFilter, HistoryPage, RefDecoration,
};

const LOG_FORMAT: &str = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%aI%x1f%D%x1f%s%x1e";

pub fn history_page(
    repo: &GitRepo,
    skip: u32,
    limit: u32,
    filter: Option<&HistoryFilter>,
) -> AppResult<HistoryPage> {
    let skip = skip as usize;
    let limit = limit.clamp(1, 1000) as usize;
    if repo.head()?.is_none() {
        return Ok(HistoryPage {
            commits: Vec::new(),
            has_more: false,
        });
    }

    let mut args: Vec<String> = vec![
        "log".into(),
        format!("--format={LOG_FORMAT}"),
        "--no-color".into(),
        "--no-show-signature".into(),
        "--topo-order".into(),
    ];
    let mut append_pagination = true;

    if let Some(filter) = filter {
        let query = filter.query.trim();
        if !query.is_empty() {
            match filter.kind.as_str() {
                "message" => {
                    args.push("--all".into());
                    args.push("--fixed-strings".into());
                    args.push("-i".into());
                    args.push(format!("--grep={query}"));
                }
                "author" => {
                    args.push("--all".into());
                    args.push("--fixed-strings".into());
                    args.push("-i".into());
                    args.push(format!("--author={query}"));
                }
                "file" => {
                    validate_relative_path(query)?;
                    args.push("--all".into());
                    args.push("--".into());
                    args.push(query.to_string());
                }
                "hash" => {
                    let sha = repo.resolve_commit(query)?;
                    args.push("-n".into());
                    args.push("1".into());
                    args.push(sha);
                    append_pagination = false;
                }
                _ => {
                    args.push("--all".into());
                }
            }
        } else {
            args.push("--all".into());
        }
    } else {
        args.push("--all".into());
    }

    if append_pagination {
        args.push(format!("--skip={skip}"));
        args.push("-n".into());
        args.push((limit + 1).to_string());
    }

    let out = repo.checked(&args, "git log")?;
    let mut commits = parse_log(&out.stdout);
    let has_more = commits.len() > limit;
    if has_more {
        commits.truncate(limit);
    }
    Ok(HistoryPage { commits, has_more })
}

pub fn file_history(repo: &GitRepo, file_path: &str, limit: u32) -> AppResult<Vec<CommitEntry>> {
    validate_relative_path(file_path)?;
    let limit = limit.clamp(1, 500);
    if repo.head()?.is_none() {
        return Ok(Vec::new());
    }
    let format_arg = format!("--format={LOG_FORMAT}");
    let out = repo.checked(
        &[
            "log".to_string(),
            "--follow".into(),
            "--no-color".into(),
            format_arg,
            "-n".into(),
            limit.to_string(),
            "--".into(),
            file_path.to_string(),
        ],
        "git log del archivo",
    )?;
    Ok(parse_log(&out.stdout))
}

fn parse_log(raw: &str) -> Vec<CommitEntry> {
    let mut commits = Vec::new();
    for record in raw.split('\u{1e}') {
        let record = record.trim_start_matches(['\r', '\n']);
        if record.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.splitn(8, '\u{1f}').collect();
        if fields.len() < 8 {
            continue;
        }
        let hash = fields[0].trim().to_string();
        if hash.is_empty() {
            continue;
        }
        let parents = fields[1]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
        commits.push(CommitEntry {
            short_hash: short_hash(&hash),
            hash,
            parents,
            author_name: fields[2].to_string(),
            author_email: fields[3].to_string(),
            time: fields[4].parse().unwrap_or(0),
            author_date: fields[5].to_string(),
            refs: parse_refs(fields[6]),
            subject: fields[7].trim_end_matches(['\r', '\n']).to_string(),
        });
    }
    commits
}

pub fn parse_refs(raw: &str) -> Vec<RefDecoration> {
    let mut result = Vec::new();
    if raw.trim().is_empty() {
        return result;
    }
    for part in raw.split(',') {
        let mut value = part.trim();
        if value.is_empty() {
            continue;
        }
        if let Some(rest) = value.strip_prefix("HEAD -> ") {
            value = rest.trim();
        } else if value == "HEAD" {
            result.push(RefDecoration {
                name: "HEAD".into(),
                kind: "head".into(),
            });
            continue;
        } else if let Some(rest) = value.strip_prefix("tag: ") {
            let name = rest.trim().trim_start_matches("refs/tags/");
            result.push(RefDecoration {
                name: name.to_string(),
                kind: "tag".into(),
            });
            continue;
        }

        let (kind, name) = if let Some(rest) = value.strip_prefix("refs/heads/") {
            ("branch", rest)
        } else if let Some(rest) = value.strip_prefix("refs/remotes/") {
            ("remote", rest)
        } else if let Some(rest) = value.strip_prefix("refs/tags/") {
            ("tag", rest)
        } else if let Some(rest) = value.strip_prefix("refs/") {
            ("other", rest)
        } else {
            ("other", value)
        };
        let name = name.trim();
        if !name.is_empty()
            && !result
                .iter()
                .any(|r: &RefDecoration| r.name == name && r.kind == kind)
        {
            result.push(RefDecoration {
                name: name.to_string(),
                kind: kind.to_string(),
            });
        }
    }
    result
}

pub fn commit_details(repo: &GitRepo, hash: &str) -> AppResult<CommitDetails> {
    let sha = repo.resolve_commit(hash)?;
    let format = "%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1f%D%x1f%b";
    let out = repo.checked(
        &[
            "show",
            "-s",
            "--no-color",
            &format!("--format={format}"),
            &sha,
        ],
        "git show",
    )?;
    let fields: Vec<&str> = out.stdout.splitn(11, '\u{1f}').collect();
    if fields.len() < 10 {
        return Err(AppError::new(
            "No se pudo interpretar la información del commit.",
        ));
    }
    let parents: Vec<String> = fields[1].split_whitespace().map(str::to_string).collect();
    let files = changed_files(repo, &sha, &parents)?;
    Ok(CommitDetails {
        hash: sha.clone(),
        short_hash: short_hash(&sha),
        parents,
        author_name: fields[2].to_string(),
        author_email: fields[3].to_string(),
        author_date: fields[4].to_string(),
        committer_name: fields[5].to_string(),
        committer_email: fields[6].to_string(),
        committer_date: fields[7].to_string(),
        subject: fields[8].to_string(),
        refs: parse_refs(fields[9]),
        body: fields.get(10).copied().unwrap_or("").trim_end().to_string(),
        files,
    })
}

fn changed_files(repo: &GitRepo, sha: &str, parents: &[String]) -> AppResult<Vec<ChangedFile>> {
    let mut args: Vec<String> = if let Some(parent) = parents.first() {
        vec![
            "diff".into(),
            "--name-status".into(),
            "-z".into(),
            "--find-renames".into(),
            "--no-color".into(),
            parent.clone(),
            sha.to_string(),
        ]
    } else {
        vec![
            "diff-tree".into(),
            "--root".into(),
            "--no-commit-id".into(),
            "--name-status".into(),
            "-r".into(),
            "-z".into(),
            "--find-renames".into(),
            "--no-color".into(),
            sha.to_string(),
        ]
    };
    args.push("--".into());
    let out = repo.checked(&args, "git diff --name-status")?;
    Ok(parse_name_status(&out.stdout))
}

pub fn parse_name_status(raw: &str) -> Vec<ChangedFile> {
    let tokens: Vec<&str> = raw.split('\0').collect();
    let mut files = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i].trim_start_matches(['\r', '\n']);
        if token.is_empty() {
            i += 1;
            continue;
        }
        let code = token.chars().next().unwrap_or('M');
        if code == 'R' || code == 'C' {
            if i + 2 < tokens.len() {
                let old = tokens[i + 1].to_string();
                let new = tokens[i + 2].to_string();
                if !new.is_empty() {
                    files.push(ChangedFile {
                        path: new,
                        old_path: Some(old),
                        status: code.to_string(),
                    });
                }
                i += 3;
            } else {
                break;
            }
        } else {
            if i + 1 < tokens.len() {
                let path = tokens[i + 1].to_string();
                if !path.is_empty() {
                    files.push(ChangedFile {
                        path,
                        old_path: None,
                        status: code.to_string(),
                    });
                }
                i += 2;
            } else {
                break;
            }
        }
    }
    files
}

pub fn blame(repo: &GitRepo, file_path: &str) -> AppResult<Vec<BlameLine>> {
    validate_relative_path(file_path)?;
    let out = repo.checked(&["blame", "--line-porcelain", "--", file_path], "git blame")?;
    let mut lines = Vec::new();
    let mut current: Option<BlameLine> = None;

    for raw_line in out.stdout.split('\n') {
        if let Some(content) = raw_line.strip_prefix('\t') {
            if let Some(mut line) = current.take() {
                line.content = content.trim_end_matches('\r').to_string();
                lines.push(line);
            }
            continue;
        }
        if raw_line.is_empty() {
            continue;
        }
        if raw_line.starts_with("author ") {
            if let Some(line) = current.as_mut() {
                line.author = raw_line[7..].to_string();
            }
            continue;
        }
        if raw_line.starts_with("author-mail ") {
            if let Some(line) = current.as_mut() {
                line.email = raw_line[12..]
                    .trim()
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .to_string();
            }
            continue;
        }
        if raw_line.starts_with("author-time ") {
            if let Some(line) = current.as_mut() {
                line.time = raw_line[12..].trim().parse().unwrap_or(0);
            }
            continue;
        }
        if raw_line.starts_with("summary ") {
            if let Some(line) = current.as_mut() {
                line.summary = raw_line[8..].to_string();
            }
            continue;
        }
        if raw_line.starts_with("filename ") {
            continue;
        }

        let parts: Vec<&str> = raw_line.split_whitespace().collect();
        if parts.len() >= 3
            && parts[0].len() >= 7
            && parts[0].chars().all(|c| c.is_ascii_hexdigit())
        {
            let line_no: u32 = parts[2].parse().unwrap_or(0);
            let uncommitted = parts[0].chars().all(|c| c == '0');
            let hash = parts[0].to_string();
            current = Some(BlameLine {
                line: line_no,
                short_hash: short_hash(&hash),
                hash,
                author: String::new(),
                email: String::new(),
                time: 0,
                summary: String::new(),
                content: String::new(),
                uncommitted,
            });
        }
    }
    if lines.is_empty() {
        return Err(AppError::new(
            "Git blame no devolvió contenido para este archivo.",
        ));
    }
    Ok(lines)
}

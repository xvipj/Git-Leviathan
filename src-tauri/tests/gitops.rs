use git_leviathan_lib::git::GitRepo;
use git_leviathan_lib::gitops::{changes, history, merge, refs, repo as repoop};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

struct TestRepo {
    _dir: TempDir,
    path: PathBuf,
    repo: GitRepo,
}

impl TestRepo {
    fn root(&self) -> &Path {
        &self.path
    }

    fn git(&self, args: &[&str]) -> String {
        git(&self.path, args)
    }

    fn write(&self, file: &str, content: &str) {
        let full = self.path.join(file);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, content).unwrap();
    }

    fn commit_file(&self, file: &str, content: &str, message: &str) -> String {
        self.write(file, content);
        changes::stage_paths(&self.repo, &[file.to_string()]).unwrap();
        changes::commit(&self.repo, message, false, false).unwrap();
        self.repo.head().unwrap().unwrap()
    }

    fn head_parents(&self) -> Vec<String> {
        self.git(&["rev-list", "--parents", "-n", "1", "HEAD"])
            .split_whitespace()
            .skip(1)
            .map(str::to_string)
            .collect()
    }
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .output()
        .expect("no se pudo ejecutar el git del sistema");
    assert!(
        output.status.success(),
        "git {:?} falló:\nstdout: {}\nstderr: {}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn init_repo() -> TestRepo {
    let dir = tempfile::tempdir().expect("no se pudo crear el directorio temporal");
    let path = std::fs::canonicalize(dir.path()).unwrap();
    git(&path, &["init", "--initial-branch=main"]);
    git(&path, &["config", "user.name", "Leviathan Test"]);
    git(&path, &["config", "user.email", "leviathan@example.com"]);
    git(&path, &["config", "commit.gpgsign", "false"]);
    // Evita que core.autocrlf del sistema altere los bytes esperados en los tests.
    git(&path, &["config", "core.autocrlf", "false"]);
    let repo = GitRepo::discover(&path).unwrap();
    TestRepo {
        _dir: dir,
        path,
        repo,
    }
}

#[test]
fn commit_author_matches_git_config_and_origin_is_reported() {
    let test = init_repo();
    let head = test.commit_file("README.md", "hola\n", "Primer commit\n");

    let author = test.git(&["log", "-1", "--format=%an%x1f%ae"]);
    assert_eq!(author, "Leviathan Test\u{1f}leviathan@example.com");

    let status = repoop::status_info(&test.repo).unwrap();
    let info = repoop::repo_info(&test.repo, "test-version", &status).unwrap();
    assert_eq!(info.identity_name.as_deref(), Some("Leviathan Test"));
    assert_eq!(
        info.identity_email.as_deref(),
        Some("leviathan@example.com")
    );
    assert!(info
        .identity_name_origin
        .as_deref()
        .unwrap_or_default()
        .contains("config"));
    assert_eq!(info.head.as_deref(), Some(head.as_str()));
    assert_eq!(info.branch.as_deref(), Some("main"));
    assert!(info.has_commits);
}

#[test]
fn stage_unstage_discard_and_untracked_cleanup() {
    let test = init_repo();
    test.commit_file("archivo.txt", "uno\n", "inicial");

    test.write("archivo.txt", "dos\n");
    changes::stage_paths(&test.repo, &["archivo.txt".to_string()]).unwrap();
    let status = repoop::status_info(&test.repo).unwrap();
    assert!(status.staged.iter().any(|file| file.path == "archivo.txt"));

    changes::unstage_paths(&test.repo, &["archivo.txt".to_string()]).unwrap();
    let status = repoop::status_info(&test.repo).unwrap();
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "archivo.txt"));

    changes::discard_paths(&test.repo, &["archivo.txt".to_string()]).unwrap();
    assert_eq!(
        fs::read_to_string(test.root().join("archivo.txt")).unwrap(),
        "uno\n"
    );

    test.write("nuevo.txt", "sin rastrear\n");
    let status = repoop::status_info(&test.repo).unwrap();
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "nuevo.txt" && file.untracked));
    changes::discard_paths(&test.repo, &["nuevo.txt".to_string()]).unwrap();
    assert!(!test.root().join("nuevo.txt").exists());

    let invalid = changes::stage_paths(&test.repo, &["../fuera.txt".to_string()]);
    assert!(
        invalid.is_err(),
        "las rutas que salen del repositorio deben rechazarse"
    );
}

#[test]
fn diff_reports_untracked_and_staged_content() {
    let test = init_repo();
    test.commit_file("main.rs", "fn main() {}\n", "inicial");
    test.write("main.rs", "fn main() {\n    println!(\"hola\");\n}\n");

    let unstaged =
        changes::file_diff(&test.repo, "main.rs", "unstaged", None, None, false, 3).unwrap();
    assert!(unstaged.content.contains("println!"));
    assert!(!unstaged.binary);

    changes::stage_paths(&test.repo, &["main.rs".to_string()]).unwrap();
    let staged = changes::file_diff(&test.repo, "main.rs", "staged", None, None, false, 3).unwrap();
    assert!(staged.content.contains("println!"));

    test.write("nuevo.txt", "linea uno\nlinea dos\n");
    let untracked =
        changes::file_diff(&test.repo, "nuevo.txt", "unstaged", None, None, true, 3).unwrap();
    assert!(untracked.untracked);
    assert!(untracked.content.contains("+linea uno"));
}

#[test]
fn branch_create_checkout_and_list() {
    let test = init_repo();
    test.commit_file("base.txt", "base\n", "base");

    refs::create_branch(&test.repo, "feature", None, true).unwrap();
    assert_eq!(
        test.repo.current_branch().unwrap().as_deref(),
        Some("feature")
    );
    test.commit_file("feature.txt", "feature\n", "trabajo en feature");

    refs::checkout_branch(&test.repo, "main", false).unwrap();
    let branches = refs::list_branches(&test.repo).unwrap();
    let names: Vec<_> = branches.iter().map(|branch| branch.name.as_str()).collect();
    assert!(names.contains(&"main"));
    assert!(names.contains(&"feature"));
    let main = branches
        .iter()
        .find(|branch| branch.name == "main")
        .unwrap();
    let feature = branches
        .iter()
        .find(|branch| branch.name == "feature")
        .unwrap();
    assert!(main.is_current);
    assert!(!feature.is_current);
    assert_eq!(feature.subject, "trabajo en feature");
}

#[test]
fn clean_merge_creates_merge_commit() {
    let test = init_repo();
    test.commit_file("base.txt", "base\n", "base");

    refs::create_branch(&test.repo, "feature", None, true).unwrap();
    test.commit_file("feature.txt", "feature\n", "aporte de feature");
    refs::checkout_branch(&test.repo, "main", false).unwrap();
    test.commit_file("main.txt", "main\n", "avance de main");

    let outcome = merge::merge(
        &test.repo,
        "refs/heads/feature",
        true,
        false,
        Some("merge feature"),
    )
    .unwrap();
    assert!(outcome.success);
    assert!(!outcome.conflicts);
    assert_eq!(test.head_parents().len(), 2);
    assert!(test.root().join("feature.txt").exists());
    assert!(test.root().join("main.txt").exists());
}

#[test]
fn conflicting_merge_can_be_inspected_and_resolved() {
    let test = init_repo();
    test.commit_file("compartido.txt", "base\n", "base");

    refs::create_branch(&test.repo, "feature", None, true).unwrap();
    test.commit_file("compartido.txt", "version feature\n", "cambio feature");
    refs::checkout_branch(&test.repo, "main", false).unwrap();
    test.commit_file("compartido.txt", "version main\n", "cambio main");

    let outcome = merge::merge(&test.repo, "refs/heads/feature", false, false, None).unwrap();
    assert!(outcome.conflicts);

    let status = repoop::status_info(&test.repo).unwrap();
    assert_eq!(status.conflicted.len(), 1);
    assert_eq!(status.conflicted[0].path, "compartido.txt");

    let sides = merge::conflict_sides(&test.repo, "compartido.txt").unwrap();
    assert!(sides.ours.contains("version main"));
    assert!(sides.theirs.contains("version feature"));

    merge::resolve_with_side(&test.repo, "compartido.txt", "theirs").unwrap();
    let status = repoop::status_info(&test.repo).unwrap();
    assert!(status.conflicted.is_empty());
    assert!(status
        .staged
        .iter()
        .any(|file| file.path == "compartido.txt"));
    assert_eq!(
        fs::read_to_string(test.root().join("compartido.txt")).unwrap(),
        "version feature\n"
    );

    changes::commit(&test.repo, "merge resuelto", false, false).unwrap();
    assert_eq!(test.head_parents().len(), 2);
}

#[test]
fn history_pages_and_commit_details_match_commits() {
    let test = init_repo();
    for index in 0..5 {
        test.commit_file(
            "historial.txt",
            &format!("version {index}\n"),
            &format!("commit {index}"),
        );
    }

    let first = history::history_page(&test.repo, 0, 2, None).unwrap();
    assert_eq!(first.commits.len(), 2);
    assert!(first.has_more);
    assert_eq!(first.commits[0].subject, "commit 4");

    let second = history::history_page(&test.repo, 2, 2, None).unwrap();
    assert_eq!(second.commits.len(), 2);
    assert_eq!(second.commits[0].subject, "commit 2");

    let filter = git_leviathan_lib::models::HistoryFilter {
        query: "commit 1".into(),
        kind: "message".into(),
    };
    let filtered = history::history_page(&test.repo, 0, 10, Some(&filter)).unwrap();
    assert_eq!(filtered.commits.len(), 1);
    assert_eq!(filtered.commits[0].subject, "commit 1");

    let hash = history::history_page(&test.repo, 0, 1, None)
        .unwrap()
        .commits[0]
        .hash
        .clone();
    let details = history::commit_details(&test.repo, &hash).unwrap();
    assert_eq!(details.subject, "commit 4");
    assert!(details
        .files
        .iter()
        .any(|file| file.path == "historial.txt"));

    let file_commits = history::file_history(&test.repo, "historial.txt", 10).unwrap();
    assert_eq!(file_commits.len(), 5);

    let blame = history::blame(&test.repo, "historial.txt").unwrap();
    assert_eq!(blame.len(), 1);
    assert_eq!(blame[0].author, "Leviathan Test");
    assert!(blame[0].content.contains("version 4"));
}

#[test]
fn reset_and_tags_are_applied_through_git() {
    let test = init_repo();
    let first = test.commit_file("historial.txt", "uno\n", "uno");
    test.commit_file("historial.txt", "dos\n", "dos");

    refs::create_tag(&test.repo, "v1.0.0", &first, Some("primera version")).unwrap();
    let tags = refs::list_tags(&test.repo).unwrap();
    assert!(tags.iter().any(|tag| tag.name == "v1.0.0" && tag.annotated));

    merge::reset(&test.repo, &first, "hard").unwrap();
    assert_eq!(test.repo.head().unwrap().as_deref(), Some(first.as_str()));
    assert_eq!(
        fs::read_to_string(test.root().join("historial.txt")).unwrap(),
        "uno\n"
    );
}

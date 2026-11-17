use crate::error::{AppError, AppResult};
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};

/// Envoltorio mínimo sobre el binario `git` del sistema.
///
/// Nunca escribe configuración ni usa libgit2: todas las operaciones son
/// exactamente las que haría el usuario en su terminal, dentro del repositorio.
#[derive(Debug, Clone)]
pub struct GitRepo {
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub success: bool,
}

impl GitRepo {
    pub fn discover(path: impl AsRef<Path>) -> AppResult<Self> {
        let input = path.as_ref();
        if !input.exists() {
            return Err(AppError::new(format!(
                "La ruta no existe: {}",
                input.display()
            )));
        }
        if !input.is_dir() {
            return Err(AppError::new(format!(
                "La ruta no es una carpeta: {}",
                input.display()
            )));
        }
        let canonical = std::fs::canonicalize(input).map_err(|e| {
            AppError::new(format!(
                "No se pudo abrir la carpeta {}: {e}",
                input.display()
            ))
        })?;

        let mut probe = new_git_command(Some(&canonical));
        let output = probe
            .args(["rev-parse", "--show-toplevel"])
            .output()
            .map_err(|e| {
                AppError::new(format!(
                    "No se pudo ejecutar git. Comprueba que esté instalado y en el PATH. Detalle: {e}"
                ))
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(AppError::with_stderr(
                "Esa carpeta no es un repositorio Git. Puedes abrir uno existente o inicializar uno nuevo.",
                stderr,
                output.status.code(),
            ));
        }
        let top = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if top.is_empty() {
            return Err(AppError::new(
                "Git no pudo determinar la raíz del repositorio.",
            ));
        }
        Ok(Self {
            path: PathBuf::from(top),
        })
    }

    pub fn run<S: AsRef<OsStr>>(&self, args: &[S]) -> AppResult<GitOutput> {
        let output = new_git_command(Some(&self.path))
            .args(args)
            .output()
            .map_err(|e| {
                AppError::new(format!(
                    "No se pudo ejecutar git. Comprueba que esté instalado y en el PATH. Detalle: {e}"
                ))
            })?;
        Ok(to_git_output(output))
    }

    /// Ejecuta y falla si Git devuelve un código distinto de cero.
    pub fn checked<S: AsRef<OsStr>>(&self, args: &[S], context: &str) -> AppResult<GitOutput> {
        let output = self.run(args)?;
        if output.success {
            Ok(output)
        } else {
            let command = std::iter::once("git".to_string())
                .chain(
                    args.iter()
                        .map(|a| a.as_ref().to_string_lossy().to_string()),
                )
                .collect::<Vec<_>>()
                .join(" ");
            Err(AppError::with_stderr(
                format!(
                    "{context} falló (código {}). Comando: {command}",
                    output.code
                ),
                output.stderr,
                Some(output.code),
            ))
        }
    }

    pub fn run_with_input<S: AsRef<OsStr>>(
        &self,
        args: &[S],
        input: &[u8],
    ) -> AppResult<GitOutput> {
        use std::io::Write;
        let mut child = new_git_command(Some(&self.path))
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::new(format!("No se pudo ejecutar git: {e}")))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input)
                .map_err(|e| AppError::new(format!("No se pudo enviar el parche a git: {e}")))?;
        }
        let output = child
            .wait_with_output()
            .map_err(|e| AppError::new(format!("git no terminó correctamente: {e}")))?;
        Ok(to_git_output(output))
    }

    pub fn checked_with_input<S: AsRef<OsStr>>(
        &self,
        args: &[S],
        input: &[u8],
        context: &str,
    ) -> AppResult<GitOutput> {
        let output = self.run_with_input(args, input)?;
        if output.success {
            Ok(output)
        } else {
            Err(AppError::with_stderr(
                format!("{context} falló (código {}).", output.code),
                output.stderr,
                Some(output.code),
            ))
        }
    }

    pub fn head(&self) -> AppResult<Option<String>> {
        let out = self.run(&["rev-parse", "--verify", "HEAD"])?;
        if out.success {
            let sha = out.stdout.trim().to_string();
            if sha.is_empty() {
                Ok(None)
            } else {
                Ok(Some(sha))
            }
        } else {
            Ok(None)
        }
    }

    pub fn git_dir(&self) -> AppResult<PathBuf> {
        let out = self.checked(&["rev-parse", "--absolute-git-dir"], "git rev-parse")?;
        Ok(PathBuf::from(out.stdout.trim()))
    }

    pub fn current_branch(&self) -> AppResult<Option<String>> {
        let out = self.run(&["symbolic-ref", "--short", "-q", "HEAD"])?;
        if out.success {
            let branch = out.stdout.trim().to_string();
            if branch.is_empty() {
                Ok(None)
            } else {
                Ok(Some(branch))
            }
        } else {
            Ok(None)
        }
    }

    /// Resuelve cualquier revisión (rama, tag, hash) a un commit completo.
    /// Se rechazan revisiones que parezcan opciones de línea de comandos.
    pub fn resolve_commit(&self, rev: &str) -> AppResult<String> {
        let rev = rev.trim();
        if rev.is_empty() || rev.starts_with('-') {
            return Err(AppError::new("Revisión de Git no válida."));
        }
        if rev.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(AppError::new("La revisión contiene caracteres no válidos."));
        }
        let expression = format!("{rev}^{{commit}}");
        let out = self.run(&["rev-parse", "--verify", expression.as_str()])?;
        if !out.success {
            return Err(AppError::with_stderr(
                format!("No existe el commit o la referencia «{rev}»."),
                out.stderr,
                Some(out.code),
            ));
        }
        let sha = out.stdout.trim().to_string();
        if sha.len() < 7 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(AppError::new(format!(
                "Git devolvió una revisión inesperada para «{rev}»."
            )));
        }
        Ok(sha)
    }

    pub fn ensure_clean_worktree(&self) -> AppResult<()> {
        let out = self.checked(
            &[
                "status",
                "--porcelain=v1",
                "--untracked-files=normal",
                "--ignore-submodules=none",
            ],
            "git status",
        )?;
        if out.stdout.trim().is_empty() {
            Ok(())
        } else {
            Err(AppError::new(
                "Hay cambios sin confirmar. Confirma o guarda esos cambios antes de usar Undo/Redo para no perder trabajo.",
            ))
        }
    }
}

pub fn new_git_command(cwd: Option<&Path>) -> Command {
    let mut command = Command::new("git");
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GIT_PAGER", "cat");
    command.env("GIT_OPTIONAL_LOCKS", "0");
    command.env("NO_COLOR", "1");
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Evita que se abra una consola para cada invocación de git.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn to_git_output(output: Output) -> GitOutput {
    GitOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        code: output.status.code().unwrap_or(-1),
        success: output.status.success(),
    }
}

/// Valida una ruta relativa al repositorio y evita rutas absolutas o `..`.
pub fn validate_relative_path(path: &str) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::new("La ruta del archivo está vacía."));
    }
    if path.contains('\0') {
        return Err(AppError::new("La ruta contiene caracteres no válidos."));
    }
    let parsed = Path::new(path);
    if parsed.is_absolute() {
        return Err(AppError::new(
            "Solo se permiten rutas relativas al repositorio.",
        ));
    }
    for component in parsed.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::new(
                    "La ruta no puede salir de la carpeta del repositorio.",
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Valida nombres de ramas y tags usando la propia lógica de Git.
pub fn validate_ref_name(repo: &GitRepo, name: &str, kind: RefKind) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::new("El nombre no puede estar vacío."));
    }
    if name.starts_with('-') || name.chars().any(|c| c.is_control()) {
        return Err(AppError::new("El nombre contiene caracteres no válidos."));
    }
    let (flag, full) = match kind {
        RefKind::Branch => ("--branch", name.to_string()),
        RefKind::Tag => ("", format!("refs/tags/{name}")),
    };
    let args = if flag.is_empty() {
        vec!["check-ref-format", full.as_str()]
    } else {
        vec!["check-ref-format", flag, name]
    };
    let out = repo.run(&args)?;
    if !out.success {
        return Err(AppError::new(format!(
            "«{name}» no es un nombre válido para Git."
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub enum RefKind {
    Branch,
    Tag,
}

pub fn validate_remote_name(name: &str) -> AppResult<()> {
    if name.is_empty()
        || name.starts_with('-')
        || name.starts_with('.')
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(AppError::new(
            "El nombre del remoto solo puede contener letras, números, guiones, guiones bajos y puntos.",
        ));
    }
    Ok(())
}

pub fn short_hash(hash: &str) -> String {
    hash.chars().take(7).collect()
}

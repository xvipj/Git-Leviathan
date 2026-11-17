use serde::Serialize;
use std::fmt;

/// Error serializable que el frontend puede mostrar tal cual.
///
/// `stderr` conserva la salida cruda de Git para que nunca se oculten errores.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub message: String,
    pub stderr: Option<String>,
    pub code: Option<i32>,
}

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            stderr: None,
            code: None,
        }
    }

    pub fn with_stderr(
        message: impl Into<String>,
        stderr: impl Into<String>,
        code: Option<i32>,
    ) -> Self {
        let stderr = stderr.into();
        let stderr = if stderr.trim().is_empty() {
            None
        } else {
            Some(stderr)
        };
        Self {
            message: message.into(),
            stderr,
            code,
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::new(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::new(format!(
            "No se pudo leer o escribir el estado local: {value}"
        ))
    }
}

pub type AppResult<T> = Result<T, AppError>;

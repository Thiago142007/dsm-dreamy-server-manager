//! Erros de comando, convertidos em string para o frontend.
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("servidor não encontrado: {0}")]
    ServerNotFound(String),
    #[error("caminho inválido ou fora da pasta do servidor: {0}")]
    PathNotAllowed(String),
    #[error("falha de E/S: {0}")]
    Io(String),
    #[error("falha de rede: {0}")]
    Http(String),
    #[error("resposta inesperada da API: {0}")]
    Parse(String),
    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for CommandError {
    fn from(e: std::io::Error) -> Self {
        CommandError::Io(e.to_string())
    }
}
impl From<reqwest::Error> for CommandError {
    fn from(e: reqwest::Error) -> Self {
        CommandError::Http(e.to_string())
    }
}
impl From<serde_json::Error> for CommandError {
    fn from(e: serde_json::Error) -> Self {
        CommandError::Parse(e.to_string())
    }
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

/// Atalho para erros genéricos.
pub fn err<T>(msg: impl Into<String>) -> CommandResult<T> {
    Err(CommandError::Other(msg.into()))
}

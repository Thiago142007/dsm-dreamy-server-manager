//! Logs em disco do servidor, dentro de `<servidor>/logs/`.
//!
//! O painel mostra o console ao vivo em memória (`process_mgr`); aqui ficam os
//! arquivos que o próprio servidor grava (`latest.log`, `yyyy-mm-dd-N.log.gz`, ...).
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use serde::Serialize;

use crate::error::{err, CommandResult};
use crate::state::AppState;
use crate::util;

/// Tamanho máximo (5 MB) lido de um arquivo de log.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// Pasta de logs de um servidor.
fn logs_dir(server_id: &str) -> PathBuf {
    util::server_dir(server_id).join("logs")
}

/// Um arquivo de log.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogItem {
    pub file_name: String,
    /// caminho relativo à pasta do servidor (ex.: "logs/latest.log")
    pub path: String,
    pub size: u64,
    pub size_human: String,
    /// data de modificação no formato AAAA-MM-DD HH:MM:SS
    pub modified: String,
}

/// Lista os arquivos de log, do mais recente para o mais antigo.
#[tauri::command]
pub(crate) fn list_logs(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<Vec<LogItem>> {
    state.find(&server_id)?;
    let dir = logs_dir(&server_id);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut items: Vec<(std::time::SystemTime, LogItem)> = Vec::new();
    for entry in fs::read_dir(&dir)?.flatten() {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let size = meta.len();
        items.push((
            meta.modified().unwrap_or(std::time::UNIX_EPOCH),
            LogItem {
                path: format!("logs/{file_name}"),
                size,
                size_human: util::human_bytes(size),
                modified: meta.modified().map(fmt_time).unwrap_or_default(),
                file_name,
            },
        ));
    }
    items.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(items.into_iter().map(|(_, item)| item).collect())
}

/// Lê um arquivo de log; arquivos acima de 5 MB são truncados com aviso.
#[tauri::command]
pub(crate) fn read_log(
    state: tauri::State<'_, AppState>,
    server_id: String,
    file_name: String,
) -> CommandResult<String> {
    state.find(&server_id)?;
    read_log_text(&server_id, &file_name)
}

/// Devolve o texto de um log (o frontend coloca na área de transferência).
#[tauri::command]
pub(crate) fn copy_log(
    state: tauri::State<'_, AppState>,
    server_id: String,
    file_name: String,
) -> CommandResult<String> {
    state.find(&server_id)?;
    read_log_text(&server_id, &file_name)
}

/// Exclui um arquivo de log.
#[tauri::command]
pub(crate) fn delete_log(
    state: tauri::State<'_, AppState>,
    server_id: String,
    file_name: String,
) -> CommandResult<()> {
    state.find(&server_id)?;
    let path = log_file(&server_id, &file_name)?;
    util::remove_any(&path)
}

/// Lê o texto do log, mantendo só os últimos 5 MB quando ele for maior.
fn read_log_text(server_id: &str, file_name: &str) -> CommandResult<String> {
    let path = log_file(server_id, file_name)?;
    let meta = fs::metadata(&path)?;
    let mut file = fs::File::open(&path)?;
    let truncated = meta.len() > MAX_LOG_BYTES;

    let mut bytes: Vec<u8> = Vec::new();
    if truncated {
        // logs interessam pelo final: começa a ler perto do fim do arquivo
        file.seek(SeekFrom::End(-(MAX_LOG_BYTES as i64)))?;
    }
    file.read_to_end(&mut bytes)?;
    drop(file);

    let mut text = String::from_utf8_lossy(&bytes).to_string();
    if truncated {
        text = format!(
            "--- arquivo truncado: exibindo os últimos {} de {} ---\n{}",
            util::human_bytes(MAX_LOG_BYTES),
            util::human_bytes(meta.len()),
            text
        );
    }
    Ok(text)
}

/// Descobre o caminho do arquivo de log, barrando path traversal.
fn log_file(server_id: &str, file_name: &str) -> CommandResult<PathBuf> {
    if file_name.trim().is_empty() {
        return err("informe o nome do arquivo de log".to_string());
    }
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return err(format!("nome de log inválido: {file_name}"));
    }
    let path = logs_dir(server_id).join(file_name);
    if !path.is_file() {
        return err(format!("log não encontrado: {}", path.display()));
    }
    Ok(path)
}

/// Data/hora legível a partir de `SystemTime`.
fn fmt_time(t: std::time::SystemTime) -> String {
    chrono::DateTime::<chrono::Local>::from(t)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

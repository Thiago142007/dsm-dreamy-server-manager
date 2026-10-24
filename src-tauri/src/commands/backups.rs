//! Backups dos servidores em `~/.dsm/backups/<server_id>/`.
//!
//! Cada backup é um `.tar.gz` chamado `YYYY-MM-DD_HH-MM-SS_<nome-do-servidor>.tar.gz`
//! (a data vem de `util::stamp_now`). O arquivo guarda o conteúdo da pasta do
//! servidor na raiz do arquivo, então restaurar é só extrair dentro dela.
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{err, CommandResult};
use crate::state::AppState;
use crate::util;

/// Pasta que guarda os backups de um servidor.
fn server_backups_dir(server_id: &str) -> PathBuf {
    util::backups_dir().join(server_id)
}

/// Um backup listado no painel.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupItem {
    /// nome do arquivo dentro de `~/.dsm/backups/<server_id>/`
    pub file_name: String,
    pub size: u64,
    pub size_human: String,
    /// data de criação no formato AAAA-MM-DD HH:MM:SS
    pub created: String,
    /// "auto" quando o nome contiver `_auto` (tarefa agendada), senão "manual"
    pub kind: String,
}

/// Lista os backups do servidor, do mais recente para o mais antigo.
#[tauri::command]
pub(crate) fn list_backups(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<Vec<BackupItem>> {
    state.find(&server_id)?;
    let dir = server_backups_dir(&server_id);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut items: Vec<(String, BackupItem)> = Vec::new();
    for entry in fs::read_dir(&dir)?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let item = backup_item(&path)?;
        // ordena pelo nome, que começa com a data/hora
        items.push((file_name, item));
    }
    items.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(items.into_iter().map(|(_, item)| item).collect())
}

/// Cria um backup completo da pasta do servidor.
#[tauri::command]
pub(crate) fn create_backup(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<BackupItem> {
    let entry = state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    if !root.exists() {
        return err(format!("pasta do servidor não encontrada: {}", root.display()));
    }

    let dir = server_backups_dir(&server_id);
    fs::create_dir_all(&dir)?;
    let name = format!("{}_{}.tar.gz", util::stamp_now(), safe_name(&entry.name));
    let output = dir.join(&name);

    // empacota o conteúdo na raiz do arquivo, ignorando uma pasta "backups"
    // que eventualmente exista dentro da pasta do servidor
    let mut items: Vec<(String, PathBuf)> = Vec::new();
    for child in fs::read_dir(&root)?.flatten() {
        let child_name = child.file_name().to_string_lossy().to_string();
        if child_name == "backups" {
            continue;
        }
        items.push((child_name, child.path()));
    }
    util::create_tar_gz(&items, &output)?;

    backup_item(&output)
}

/// Restaura um backup: limpa a pasta do servidor e extrai o arquivo nela.
#[tauri::command]
pub(crate) fn restore_backup(
    state: tauri::State<'_, AppState>,
    server_id: String,
    file_name: String,
) -> CommandResult<()> {
    state.find(&server_id)?;
    let backup = backup_file(&server_id, &file_name)?;
    let root = util::server_dir(&server_id);
    fs::create_dir_all(&root)?;

    for child in fs::read_dir(&root)?.flatten() {
        util::remove_any(&child.path())?;
    }
    util::extract_archive(&backup, &root)?;
    Ok(())
}

/// Duplica um arquivo de backup existente.
#[tauri::command]
pub(crate) fn copy_backup(
    state: tauri::State<'_, AppState>,
    server_id: String,
    file_name: String,
) -> CommandResult<BackupItem> {
    state.find(&server_id)?;
    let src = backup_file(&server_id, &file_name)?;
    let dir = server_backups_dir(&server_id);

    let stem = file_name.trim_end_matches(".tar.gz").to_string();
    let copy_name = dedupe(&dir, &format!("{stem}_copia.tar.gz"));
    fs::copy(&src, &copy_name)?;
    backup_item(&copy_name)
}

/// Move um backup para a pasta de backups de outro servidor.
#[tauri::command]
pub(crate) fn move_backup(
    state: tauri::State<'_, AppState>,
    server_id: String,
    file_name: String,
    target_server_id: String,
) -> CommandResult<BackupItem> {
    state.find(&server_id)?;
    state.find(&target_server_id)?;
    if server_id == target_server_id {
        return err("o servidor de destino é o mesmo".to_string());
    }
    let src = backup_file(&server_id, &file_name)?;
    let dir = server_backups_dir(&target_server_id);
    fs::create_dir_all(&dir)?;

    let target = dedupe(&dir, &file_name);
    if fs::rename(&src, &target).is_err() {
        fs::copy(&src, &target)?;
        fs::remove_file(&src)?;
    }
    backup_item(&target)
}

/// Exclui um backup.
#[tauri::command]
pub(crate) fn delete_backup(
    state: tauri::State<'_, AppState>,
    server_id: String,
    file_name: String,
) -> CommandResult<()> {
    state.find(&server_id)?;
    let backup = backup_file(&server_id, &file_name)?;
    util::remove_any(&backup)
}

/// Soma do tamanho de todos os backups do servidor, em bytes.
#[tauri::command]
pub(crate) fn backup_size(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<u64> {
    state.find(&server_id)?;
    let dir = server_backups_dir(&server_id);
    if !dir.exists() {
        return Ok(0);
    }
    let mut total = 0u64;
    for entry in fs::read_dir(&dir)?.flatten() {
        let path = entry.path();
        if path.is_file() {
            total += fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(total)
}

/// Descobre o caminho do arquivo de backup, barrando path traversal.
fn backup_file(server_id: &str, file_name: &str) -> CommandResult<PathBuf> {
    if file_name.trim().is_empty() {
        return err("informe o nome do backup".to_string());
    }
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return err(format!("nome de backup inválido: {file_name}"));
    }
    let path = server_backups_dir(server_id).join(file_name);
    if !path.is_file() {
        return err(format!("backup não encontrado: {}", path.display()));
    }
    Ok(path)
}

/// Monta o `BackupItem` a partir do arquivo no disco.
fn backup_item(path: &Path) -> CommandResult<BackupItem> {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| crate::error::CommandError::PathNotAllowed(path.display().to_string()))?;
    let meta = fs::metadata(path)?;
    let size = meta.len();
    Ok(BackupItem {
        created: created_of(&file_name, &meta),
        kind: if file_name.contains("_auto") { "auto" } else { "manual" }.to_string(),
        size,
        size_human: util::human_bytes(size),
        file_name,
    })
}

/// Data de criação: lida do nome (`YYYY-MM-DD_HH-MM-SS`) com fallback no mtime.
fn created_of(file_name: &str, meta: &fs::Metadata) -> String {
    let head = match file_name.get(..19) {
        Some(h) => h,
        None => file_name,
    };
    match chrono::NaiveDateTime::parse_from_str(head, "%Y-%m-%d_%H-%M-%S") {
        Ok(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        Err(_) => meta
            .modified()
            .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M:%S").to_string())
            .unwrap_or_default(),
    }
}

/// Nome do servidor seguro para usar em nome de arquivo.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();
    let trimmed: String = cleaned.chars().take(48).collect();
    if trimmed.trim().is_empty() {
        "servidor".to_string()
    } else {
        trimmed
    }
}

/// Nome livre dentro de `dir` (acrescenta `_copia2`, `_copia3`, ...).
fn dedupe(dir: &Path, name: &str) -> PathBuf {
    if !dir.join(name).exists() {
        return dir.join(name);
    }
    let stem = name.trim_end_matches(".tar.gz");
    let mut n = 2;
    loop {
        let candidate = dir.join(format!("{stem}_copia{n}.tar.gz"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
        if n > 999 {
            return candidate;
        }
    }
}

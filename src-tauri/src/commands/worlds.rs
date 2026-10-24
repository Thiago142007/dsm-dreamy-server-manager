//! Mundos de servidores Java.
//!
//! Um mundo é uma pasta dentro da pasta do servidor que contém `level.dat`.
//! O mundo ativo é o valor de `level-name` no `server.properties`, lido aqui
//! manualmente (o arquivo é apenas `chave=valor` por linha).
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::files::{list_files_inner, FileItem};
use crate::error::{err, CommandResult};
use crate::state::AppState;
use crate::util;

/// Um mundo encontrado na pasta do servidor.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldItem {
    /// nome da pasta do mundo
    pub name: String,
    /// caminho relativo à pasta do servidor
    pub path: String,
    pub size: u64,
    pub size_human: String,
    /// true quando é o mundo configurado em `level-name`
    pub active: bool,
}

/// Lista os mundos do servidor Java (quem tem `level.dat`).
#[tauri::command]
pub(crate) fn list_worlds(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> CommandResult<Vec<WorldItem>> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let active = level_name(&root);

    let mut items: Vec<WorldItem> = Vec::new();
    for entry in fs::read_dir(&root)?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !path.join("level.dat").exists() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let size = util::dir_size(&path);
        items.push(WorldItem {
            active: active.as_deref() == Some(name.as_str()),
            path: name.clone(),
            size,
            size_human: util::human_bytes(size),
            name,
        });
    }
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(items)
}

/// Apaga a pasta de um mundo (o servidor cria outro ao iniciar).
#[tauri::command]
pub(crate) fn regenerate_world(
    state: tauri::State<'_, AppState>,
    server_id: String,
    name: String,
) -> CommandResult<()> {
    state.find(&server_id)?;
    check_world_name(&name)?;
    let root = util::server_dir(&server_id);
    let path = util::resolve_in_server(&root, &name)?;
    if !path.is_dir() {
        return err(format!("mundo não encontrado: {}", path.display()));
    }
    if !path.join("level.dat").exists() {
        return err(format!(
            "{} não parece ser um mundo (sem level.dat)",
            path.display()
        ));
    }
    util::remove_any(&path)
}

/// Lista os arquivos de dentro de um mundo (reaproveita o navegador de arquivos).
#[tauri::command]
pub(crate) fn world_files(
    state: tauri::State<'_, AppState>,
    server_id: String,
    name: String,
) -> CommandResult<Vec<FileItem>> {
    state.find(&server_id)?;
    check_world_name(&name)?;
    let root = util::server_dir(&server_id);
    let path = util::resolve_in_server(&root, &name)?;
    if !path.is_dir() {
        return err(format!("mundo não encontrado: {}", path.display()));
    }
    list_files_inner(&server_id, &name)
}

/// Copia uma pasta de mundo externa para dentro do servidor, escolhendo um
/// nome que não colida (`world`, `world_2`, ...); devolve o nome usado.
#[tauri::command]
pub(crate) fn upload_world(
    state: tauri::State<'_, AppState>,
    server_id: String,
    source_absolute_path: String,
) -> CommandResult<String> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    fs::create_dir_all(&root)?;

    let source = PathBuf::from(source_absolute_path.trim());
    if source.as_os_str().is_empty() {
        return err("informe a pasta do mundo".to_string());
    }
    let meta = fs::metadata(&source)
        .map_err(|_| crate::error::CommandError::Other(format!(
            "não foi possível acessar {}",
            source.display()
        )))?;
    if !meta.is_dir() {
        return err(format!(
            "o caminho escolhido não é uma pasta de mundo: {}",
            source.display()
        ));
    }
    // copiar a própria pasta do servidor (ou acima dela) recursaria sem fim
    let root_canon = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    if let Ok(src_canon) = fs::canonicalize(&source) {
        if root_canon.starts_with(&src_canon) {
            return err("escolha uma pasta de mundo fora da pasta do servidor".to_string());
        }
    }

    let mut name = "world".to_string();
    let mut n = 1;
    while root.join(&name).exists() {
        n += 1;
        name = format!("world_{n}");
    }
    util::copy_any(&source, &root.join(&name))?;
    Ok(name)
}

/// Lê o valor de `level-name` no `server.properties`, se existir.
fn level_name(root: &Path) -> Option<String> {
    let raw = fs::read_to_string(root.join("server.properties")).ok()?;
    for line in raw.lines() {
        let line = line.trim();
        let rest = match line.strip_prefix("level-name") {
            Some(r) => r.trim_start(),
            None => continue,
        };
        if let Some(value) = rest.strip_prefix('=') {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Nomes de mundo são pastas simples, sem separadores.
fn check_world_name(name: &str) -> CommandResult<()> {
    if name.trim().is_empty() {
        return err("informe o nome do mundo".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name == "." {
        return err(format!("nome de mundo inválido: {name}"));
    }
    Ok(())
}

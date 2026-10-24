//! Gerenciador de arquivos do servidor: navegar, ler, escrever, renomear,
//! excluir, mover/copiar e compactar arquivos.
//!
//! Todos os caminhos vindos do frontend são relativos à pasta do servidor
//! (`~/.dsm/servers/<id>/`) e passam por `util::resolve_in_server`, que impede
//! path traversal. A lógica de listagem fica em `list_files_inner` para poder
//! ser reutilizada por outros módulos (ex.: mundos) sem carregar o estado.
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{err, CommandResult};
use crate::state::AppState;
use crate::util;

/// Tamanho máximo (2 MB) para leitura de arquivos de texto no editor.
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

/// Bytes analisados para descobrir se um arquivo é binário.
const SNIFF_BYTES: usize = 8192;

/// Extensões de arquivo comprimido suportadas.
const ARCHIVE_EXTS: [&str; 5] = [".zip", ".tar.gz", ".tgz", ".tar", ".7z"];

/// Um item do navegador de arquivos.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    /// nome do arquivo/pasta (sem diretórios)
    pub name: String,
    /// caminho relativo à pasta do servidor
    pub path: String,
    pub is_dir: bool,
    /// tamanho em bytes (para pastas, a soma do conteúdo)
    pub size: u64,
    pub size_human: String,
    /// data de modificação no formato AAAA-MM-DD HH:MM:SS
    pub modified: String,
    pub is_archive: bool,
}

/// Lista o conteúdo de uma pasta do servidor (pastas primeiro, depois por nome).
#[tauri::command]
pub(crate) fn list_files(
    state: tauri::State<'_, AppState>,
    server_id: String,
    path: String,
) -> CommandResult<Vec<FileItem>> {
    state.find(&server_id)?;
    list_files_inner(&server_id, &path)
}

/// Listagem de arquivos sem depender do estado do Tauri (uso interno).
pub(crate) fn list_files_inner(server_id: &str, path: &str) -> CommandResult<Vec<FileItem>> {
    let root = util::server_dir(server_id);
    let dir = util::resolve_in_server(&root, path)?;
    if !dir.exists() {
        return err(format!("caminho não encontrado: {}", dir.display()));
    }
    if !dir.is_dir() {
        return err("o caminho informado não é uma pasta".to_string());
    }

    let mut items: Vec<FileItem> = Vec::new();
    for entry in fs::read_dir(&dir)?.flatten() {
        let full = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = meta.is_dir();
        let size = if is_dir {
            util::dir_size(&full)
        } else {
            meta.len()
        };
        let is_archive = !is_dir && is_archive_name(&name);
        items.push(FileItem {
            path: rel_from(&root, &full),
            is_dir,
            size,
            size_human: util::human_bytes(size),
            modified: meta.modified().map(fmt_time).unwrap_or_default(),
            is_archive,
            name,
        });
    }

    // pastas primeiro; empate resolvido alfabeticamente (sem diferenciar caso)
    items.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(items)
}

/// Lê um arquivo de texto do servidor (limite de 2 MB, recusa binários).
#[tauri::command]
pub(crate) fn read_text_file(
    state: tauri::State<'_, AppState>,
    server_id: String,
    path: String,
) -> CommandResult<String> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    let full = util::resolve_in_server(&root, &path)?;
    if !full.is_file() {
        return err(format!("arquivo não encontrado: {}", full.display()));
    }
    let meta = fs::metadata(&full)?;
    if meta.len() > MAX_TEXT_BYTES {
        return err(format!(
            "arquivo muito grande para edição: {} (limite de {})",
            util::human_bytes(meta.len()),
            util::human_bytes(MAX_TEXT_BYTES)
        ));
    }
    let bytes = fs::read(&full)?;
    if is_binary(&bytes) {
        return err(format!(
            "arquivo binário, não pode ser exibido como texto: {}",
            full.display()
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| crate::error::CommandError::Parse("arquivo não está em UTF-8".to_string()))
}

/// Cria ou sobrescreve um arquivo de texto dentro do servidor.
#[tauri::command]
pub(crate) fn write_text_file(
    state: tauri::State<'_, AppState>,
    server_id: String,
    path: String,
    content: String,
) -> CommandResult<()> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    let full = util::resolve_in_server(&root, &path)?;
    if full == root {
        return err("informe o nome do arquivo".to_string());
    }
    if full.is_dir() {
        return err("o destino é uma pasta".to_string());
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&full, content)?;
    Ok(())
}

/// Cria uma pasta (com os pais necessários) dentro do servidor.
#[tauri::command]
pub(crate) fn create_folder(
    state: tauri::State<'_, AppState>,
    server_id: String,
    path: String,
) -> CommandResult<()> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    let full = util::resolve_in_server(&root, &path)?;
    if full == root {
        return err("informe o nome da pasta".to_string());
    }
    if full.exists() && !full.is_dir() {
        return err(format!("já existe um arquivo chamado {}", full.display()));
    }
    fs::create_dir_all(&full)?;
    Ok(())
}

/// Cria um arquivo vazio dentro do servidor.
#[tauri::command]
pub(crate) fn create_file(
    state: tauri::State<'_, AppState>,
    server_id: String,
    path: String,
) -> CommandResult<()> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    let full = util::resolve_in_server(&root, &path)?;
    if full == root {
        return err("informe o nome do arquivo".to_string());
    }
    if full.exists() {
        return err(format!("{} já existe", full.display()));
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&full, b"")?;
    Ok(())
}

/// Renomeia um arquivo/pasta (o novo nome não pode conter separadores).
#[tauri::command]
pub(crate) fn rename_path(
    state: tauri::State<'_, AppState>,
    server_id: String,
    path: String,
    new_name: String,
) -> CommandResult<()> {
    state.find(&server_id)?;
    check_name(&new_name, "o novo nome")?;
    let root = util::server_dir(&server_id);
    let full = util::resolve_in_server(&root, &path)?;
    if !full.exists() {
        return err(format!("não encontrado: {}", full.display()));
    }
    let parent = match full.parent() {
        Some(p) => p.to_path_buf(),
        None => return err("não é possível renomear a raiz do servidor".to_string()),
    };
    let target = parent.join(&new_name);
    if target.exists() {
        return err(format!("{} já existe", target.display()));
    }
    fs::rename(&full, &target)?;
    Ok(())
}

/// Exclui arquivos/pastas e devolve quantos itens foram removidos.
#[tauri::command]
pub(crate) fn delete_paths(
    state: tauri::State<'_, AppState>,
    server_id: String,
    paths: Vec<String>,
) -> CommandResult<usize> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    let mut removed = 0usize;
    for rel in &paths {
        let full = util::resolve_in_server(&root, rel)?;
        if full == root {
            return err("não é possível excluir a pasta do servidor".to_string());
        }
        if !full.exists() {
            continue;
        }
        util::remove_any(&full)?;
        removed += 1;
    }
    Ok(removed)
}

/// Copia (duplica) arquivos/pastas para dentro de `dest`.
#[tauri::command]
pub(crate) fn copy_paths(
    state: tauri::State<'_, AppState>,
    server_id: String,
    paths: Vec<String>,
    dest: String,
) -> CommandResult<usize> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    let dest_dir = util::resolve_in_server(&root, &dest)?;
    if !dest_dir.is_dir() {
        return err(format!("destino não é uma pasta: {}", dest_dir.display()));
    }
    let mut copied = 0usize;
    for rel in &paths {
        let full = util::resolve_in_server(&root, rel)?;
        if !full.exists() {
            return err(format!("não encontrado: {}", full.display()));
        }
        if full == dest_dir || is_ancestor(&full, &dest_dir) {
            return err("não é possível copiar uma pasta para dentro dela mesma".to_string());
        }
        let name = file_name_of(&full)?;
        let target = unique_dest(&dest_dir, &name);
        util::copy_any(&full, &target)?;
        copied += 1;
    }
    Ok(copied)
}

/// Move (recorta) arquivos/pastas para dentro de `dest`.
#[tauri::command]
pub(crate) fn move_paths(
    state: tauri::State<'_, AppState>,
    server_id: String,
    paths: Vec<String>,
    dest: String,
) -> CommandResult<usize> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    let dest_dir = util::resolve_in_server(&root, &dest)?;
    if !dest_dir.is_dir() {
        return err(format!("destino não é uma pasta: {}", dest_dir.display()));
    }
    let mut moved = 0usize;
    for rel in &paths {
        let full = util::resolve_in_server(&root, rel)?;
        if !full.exists() {
            return err(format!("não encontrado: {}", full.display()));
        }
        if full == dest_dir || is_ancestor(&full, &dest_dir) {
            return err("não é possível mover uma pasta para dentro dela mesma".to_string());
        }
        let name = file_name_of(&full)?;
        let target = unique_dest(&dest_dir, &name);
        if fs::rename(&full, &target).is_err() {
            // entre sistemas de arquivos diferentes: copia e apaga o original
            util::copy_any(&full, &target)?;
            util::remove_any(&full)?;
        }
        moved += 1;
    }
    Ok(moved)
}

/// Compacta os itens selecionados num .tar.gz ao lado deles; devolve o nome criado.
#[tauri::command]
pub(crate) fn compress_paths(
    state: tauri::State<'_, AppState>,
    server_id: String,
    paths: Vec<String>,
    output_name: String,
) -> CommandResult<String> {
    state.find(&server_id)?;
    if paths.is_empty() {
        return err("nenhum item selecionado para compactar".to_string());
    }
    check_archive_name(&output_name)?;

    let root = util::server_dir(&server_id);
    let mut resolved: Vec<PathBuf> = Vec::with_capacity(paths.len());
    for rel in &paths {
        let full = util::resolve_in_server(&root, rel)?;
        if !full.exists() {
            return err(format!("não encontrado: {}", full.display()));
        }
        resolved.push(full);
    }

    // o arquivo é criado na pasta do primeiro item (a "pasta atual" do navegador)
    let base = match resolved.first().and_then(|p| p.parent()) {
        Some(p) => p.to_path_buf(),
        None => root.clone(),
    };
    let items: Vec<(String, PathBuf)> = resolved
        .iter()
        .map(|p| (rel_from(&base, p), p.clone()))
        .collect();

    let output = unique_dest(&base, &with_tar_gz(&output_name));
    util::create_tar_gz(&items, &output)?;

    file_name_of(&output)
}

/// Extrai um arquivo comprimido em `dest`; devolve a quantidade de itens.
#[tauri::command]
pub(crate) fn extract_archive(
    state: tauri::State<'_, AppState>,
    server_id: String,
    path: String,
    dest: String,
) -> CommandResult<usize> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    let full = util::resolve_in_server(&root, &path)?;
    if !full.is_file() {
        return err(format!("arquivo não encontrado: {}", full.display()));
    }
    if !is_archive_name(&path) {
        return err(format!(
            "formato não suportado (use {}): {}",
            ARCHIVE_EXTS.join(", "),
            full.display()
        ));
    }
    let dest_dir = util::resolve_in_server(&root, &dest)?;
    fs::create_dir_all(&dest_dir)?;
    util::extract_archive(&full, &dest_dir)
}

/// Informa se o caminho terminou com uma extensão de arquivo comprimido.
#[tauri::command]
pub fn is_archive_path(path: String) -> bool {
    is_archive_name(&path)
}

/// Mesma verificação de `is_archive_path`, mas para uso interno.
fn is_archive_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        return true;
    }
    ARCHIVE_EXTS.iter().any(|ext| lower.ends_with(ext))
}

/// Devolve os caminhos absolutos para o frontend salvar; com vários itens
/// (ou pastas) gera um .tar.gz dentro do servidor e devolve só esse caminho.
#[tauri::command]
pub(crate) fn download_paths(
    state: tauri::State<'_, AppState>,
    server_id: String,
    paths: Vec<String>,
) -> CommandResult<Vec<String>> {
    state.find(&server_id)?;
    if paths.is_empty() {
        return err("nenhum item selecionado".to_string());
    }
    let root = util::server_dir(&server_id);
    let mut resolved: Vec<PathBuf> = Vec::with_capacity(paths.len());
    for rel in &paths {
        let full = util::resolve_in_server(&root, rel)?;
        if !full.exists() {
            return err(format!("não encontrado: {}", full.display()));
        }
        resolved.push(full);
    }

    // um único arquivo: entrega o próprio caminho absoluto
    if let [only] = resolved.as_slice() {
        if only.is_file() {
            let abs = fs::canonicalize(only).unwrap_or_else(|_| only.clone());
            return Ok(vec![abs.to_string_lossy().to_string()]);
        }
    }

    // vários itens (ou pastas): empacota num .tar.gz ao lado do primeiro item
    let base = match resolved.first().and_then(|p| p.parent()) {
        Some(p) => p.to_path_buf(),
        None => root.clone(),
    };
    let items: Vec<(String, PathBuf)> = resolved
        .iter()
        .map(|p| (rel_from(&base, p), p.clone()))
        .collect();
    let stem = match resolved.first() {
        Some(first) => file_name_of(first)?.trim_end_matches(".tar.gz").to_string(),
        None => "dsm".to_string(),
    };
    let stem = if stem.is_empty() { "dsm".to_string() } else { stem };
    let name = format!("{stem}_{}.tar.gz", util::stamp_now());
    let output = unique_dest(&base, &name);
    util::create_tar_gz(&items, &output)?;
    let abs = fs::canonicalize(&output).unwrap_or(output);
    Ok(vec![abs.to_string_lossy().to_string()])
}

/// Verifica se um caminho existe dentro da pasta do servidor.
#[tauri::command]
pub(crate) fn path_exists(
    state: tauri::State<'_, AppState>,
    server_id: String,
    path: String,
) -> CommandResult<bool> {
    state.find(&server_id)?;
    let root = util::server_dir(&server_id);
    Ok(util::resolve_in_server(&root, &path)?.exists())
}

/// Data/hora legível a partir de `SystemTime`.
fn fmt_time(t: std::time::SystemTime) -> String {
    chrono::DateTime::<chrono::Local>::from(t)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// Heurística simples: bytes nulos ou UTF-8 inválido indicam binário.
fn is_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(SNIFF_BYTES)];
    sample.contains(&0) || std::str::from_utf8(sample).is_err()
}

/// Caminho de `full` relativo a `root` (com "/" como separador).
fn rel_from(root: &Path, full: &Path) -> String {
    full.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| {
            full.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        })
}

/// Nome do último componente de um caminho.
fn file_name_of(path: &Path) -> CommandResult<String> {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| crate::error::CommandError::PathNotAllowed(path.display().to_string()))
}

/// `true` quando `maybe_parent` é ancestral de `child`.
fn is_ancestor(maybe_parent: &Path, child: &Path) -> bool {
    child.starts_with(maybe_parent)
}

/// Garante que `name` é um nome simples (sem separadores nem "..").
fn check_name(name: &str, what: &str) -> CommandResult<()> {
    if name.trim().is_empty() {
        return err(format!("{what} não pode ser vazio"));
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name == "." {
        return err(format!("{what} contém caracteres inválidos: {name}"));
    }
    Ok(())
}

/// Valida o nome de saída informado para compactação.
fn check_archive_name(name: &str) -> CommandResult<()> {
    if name.trim().is_empty() {
        return err("informe o nome do arquivo de saída".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return err(format!("nome de arquivo inválido: {name}"));
    }
    Ok(())
}

/// Garante a terminação `.tar.gz`.
fn with_tar_gz(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        name.to_string()
    } else {
        format!("{name}.tar.gz")
    }
}

/// Gera um caminho livre em `dir` acrescentando `_copia`, `_copia2`, ...
fn unique_dest(dir: &Path, name: &str) -> PathBuf {
    if !dir.join(name).exists() {
        return dir.join(name);
    }
    let mut n = 1;
    loop {
        n += 1;
        let candidate = dedupe_name(name, n);
        let path = dir.join(&candidate);
        if !path.exists() {
            return path;
        }
        if n > 999 {
            return path;
        }
    }
}

/// Insere `_copia<n>` antes da extensão (se houver).
fn dedupe_name(name: &str, n: usize) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}_copia{n}.{ext}"),
        _ => format!("{name}_copia{n}"),
    }
}

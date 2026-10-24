//! Leitura e escrita do server.properties.
//!
//! O arquivo é lido preservando a ordem e os comentários originais, para o
//! painel não destruir a configuração do usuário.
use std::fs;

use tauri::State;

use crate::error::{err, CommandResult};
use crate::model::ServerEntry;
use crate::state::AppState;
use crate::util;

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PropertyEntry {
    pub key: String,
    pub value: String,
    pub comment: Option<String>,
    ///true quando a chave é conhecida pelo painel (ganha editor especial)
    pub known: bool,
}

fn props_path(id: &str) -> std::path::PathBuf {
    util::server_dir(id).join("server.properties")
}

#[tauri::command]
pub fn read_properties(server_id: String) -> CommandResult<Vec<PropertyEntry>> {
    let path = props_path(&server_id);
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path)?;
    Ok(parse_properties(&raw))
}

pub fn parse_properties(raw: &str) -> Vec<PropertyEntry> {
    let mut out = Vec::new();
    let mut pending_comment: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('!') {
            pending_comment = Some(trimmed.trim_start_matches(['#', '!']).trim().to_string());
            continue;
        }
        if trimmed.is_empty() {
            pending_comment = None;
            continue;
        }
        if let Some(eq) = trimmed.find('=') {
            let key = trimmed[..eq].to_string();
            let value = trimmed[eq + 1..].to_string();
            let known = KNOWN_KEYS.contains(&key.as_str());
            out.push(PropertyEntry {
                key,
                value,
                comment: pending_comment.take(),
                known,
            });
        }
    }
    out
}

/// Chaves que o painel sabe editar com controles próprios.
const KNOWN_KEYS: &[&str] = &[
    "motd",
    "server-port",
    "max-players",
    "gamemode",
    "difficulty",
    "online-mode",
    "white-list",
    "allow-flight",
    "force-gamemode",
    "spawn-protection",
    "pvp",
    "level-name",
    "view-distance",
    "enable-command-block",
    "resource-pack",
    "require-resource-pack",
    "resource-pack-prompt",
    "max-world-size",
    "network-compression-threshold",
    "player-idle-timeout",
    "allow-nether",
    "enable-command-block",
    "op-permission-level",
    "function-permission-level",
    "level-type",
    "hardcore",
    "enable-rcon",
    "enforce-secure-profile",
    "max-tick-time",
];

#[tauri::command]
pub fn set_property(
    server_id: String,
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<PropertyEntry>> {
    let key = key.trim().to_string();
    if key.contains('=') || key.contains('\n') {
        return err("chave inválida");
    }
    write_raw(&server_id, &key, &value)?;
    if key == "motd" {
        let motd = decode_motd(&value);
        let entry = state.update(&server_id, move |e| e.motd = motd)?;
        let dir = util::server_dir(&server_id);
        installer_write(&dir, &entry).ok();
    }
    read_properties(server_id)
}

/// Escreve várias chaves de uma vez (usado pelo formulário de Opções).
#[tauri::command]
pub fn set_properties(
    server_id: String,
    changes: Vec<(String, String)>,
    state: State<'_, AppState>,
) -> CommandResult<Vec<PropertyEntry>> {
    for (key, value) in &changes {
        if key.contains('=') || key.contains('\n') {
            return err(format!("chave inválida: {key}"));
        }
        write_raw(&server_id, key, value)?;
    }
    if let Some((_, motd_raw)) = changes.iter().find(|(k, _)| k == "motd") {
        let motd = decode_motd(motd_raw);
        let entry = state.update(&server_id, move |e| e.motd = motd)?;
        let dir = util::server_dir(&server_id);
        installer_write(&dir, &entry).ok();
    }
    read_properties(server_id)
}

#[tauri::command]
pub fn remove_property(server_id: String, key: String) -> CommandResult<Vec<PropertyEntry>> {
    let path = props_path(&server_id);
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path)?;
    let mut out = Vec::new();
    let mut removed = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('!') || trimmed.is_empty() {
            out.push(line.to_string());
            continue;
        }
        if let Some(eq) = trimmed.find('=') {
            if trimmed[..eq].trim() == key.trim() {
                removed = true;
                continue;
            }
        }
        out.push(line.to_string());
    }
    if !removed {
        return err(format!("a chave {} não existe", key));
    }
    fs::write(&path, out.join("\n") + "\n")?;
    read_properties(server_id)
}

fn installer_write(dir: &std::path::Path, entry: &ServerEntry) -> CommandResult<()> {
    // mantém o nome/MOTD sincronizados sem apagar o resto do arquivo
    let path = dir.join("server.properties");
    if !path.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(&path)?;
    let mut out = Vec::new();
    for line in raw.lines() {
        if line.trim_start().starts_with("motd=") {
            continue;
        }
        out.push(line.to_string());
    }
    out.push(format!("motd={}", entry.motd_joined().replace('\n', "\\n")));
    fs::write(&path, out.join("\n") + "\n")?;
    Ok(())
}

/// Reescreve uma chave preservando comentários e ordem.
fn write_raw(server_id: &str, key: &str, value: &str) -> CommandResult<()> {
    let path = props_path(server_id);
    if !path.exists() {
        fs::create_dir_all(util::server_dir(server_id))?;
        fs::write(&path, format!("{key}={value}\n"))?;
        return Ok(());
    }
    let raw = fs::read_to_string(&path)?;
    let mut out = Vec::new();
    let mut found = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            out.push(line.to_string());
            continue;
        }
        if let Some(eq) = trimmed.find('=') {
            let current = trimmed[..eq].trim();
            if current == key {
                out.push(format!("{key}={value}"));
                found = true;
                continue;
            }
        }
        out.push(line.to_string());
    }
    if !found {
        out.push(format!("{key}={value}"));
    }
    fs::write(&path, out.join("\n") + "\n")?;
    Ok(())
}

/// Converte `\n` do server.properties em linhas separadas.
pub fn decode_motd(raw: &str) -> crate::model::Motd {
    let parts: Vec<&str> = raw.split("\\n").collect();
    crate::model::Motd {
        line1: parts.first().map(|s| s.to_string()).unwrap_or_default(),
        line2: parts.get(1).map(|s| s.to_string()).unwrap_or_default(),
    }
}

/// MOTD no formato do arquivo.
pub fn encode_motd(motd: &crate::model::Motd) -> String {
    format!("{}\\n{}", motd.line1, motd.line2)
}

/// Caminho absoluto do server.properties.
#[tauri::command]
pub fn properties_path(server_id: String) -> CommandResult<String> {
    Ok(props_path(&server_id).to_string_lossy().to_string())
}

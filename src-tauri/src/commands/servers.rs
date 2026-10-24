//! Comandos de servidores: criar, listar, atualizar, remover e trocar software.
use std::fs;
use std::path::PathBuf;

use tauri::Emitter;
use tauri::{AppHandle, State};

use crate::error::{err, CommandResult};
use crate::installer;
use crate::java_mgr;
use crate::model::{ProgressEvent, ServerEntry};
use crate::software;
use crate::state::AppState;
use crate::util;

#[tauri::command]
pub fn list_servers(state: State<'_, AppState>) -> CommandResult<Vec<ServerEntry>> {
    Ok(state.servers.lock().unwrap().clone())
}

/// Dados necessários para criar um servidor.
#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreateServerInput {
    pub name: String,
    pub software: String,
    pub version: String,
    pub motd_line1: Option<String>,
    pub motd_line2: Option<String>,
    /// caminho absoluto da imagem escolhida (opcional)
    pub icon_path: Option<String>,
    pub ram_mb: Option<u32>,
    pub port: Option<u16>,
    pub eula_accepted: bool,
    pub java_major: Option<u32>,
    pub modpack: Option<String>,
}

#[tauri::command]
pub async fn create_server(
    input: CreateServerInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> CommandResult<ServerEntry> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return err("dê um nome ao servidor");
    }
    if input.software != "modpack" && input.version.trim().is_empty() {
        return err("escolha a versão do servidor");
    }
    let software_info = software::by_id(&input.software)
        .ok_or_else(|| crate::error::CommandError::Other(format!("software inválido: {}", input.software)))?;

    let id = uuid::Uuid::new_v4().to_string();
    let dir = util::server_dir(&id);
    fs::create_dir_all(&dir)?;

    let default = state
        .settings
        .lock()
        .unwrap()
        .default_ram_mb
        .max(0);
    let java_major = input
        .java_major
        .unwrap_or_else(|| software::java_major_for(&input.version));

    let entry = ServerEntry {
        id: id.clone(),
        name,
        software: input.software.clone(),
        version: input.version.clone(),
        icon: None,
        motd: crate::model::Motd {
            line1: input.motd_line1.unwrap_or_else(|| format!("{} {}", software_info.name, input.version)),
            line2: input.motd_line2.unwrap_or_else(|| "Servidor criado no DSM".to_string()),
        },
        java_major,
        ram_mb: input.ram_mb.unwrap_or(if default > 0 { default } else { 2048 }),
        jar: "server.jar".to_string(),
        port: input.port.unwrap_or_else(next_free_port),
        created_at: chrono::Local::now().to_rfc3339(),
        modpack: input.modpack.clone(),
        eula_accepted: input.eula_accepted,
    };

    // ícone (opcional): copia e redimensiona para 64x64
    if let Some(icon_path) = &input.icon_path {
        if !icon_path.trim().is_empty() {
            let source = PathBuf::from(icon_path);
            let dest = dir.join("server-icon.png");
            installer::resize_icon(&source, &dest)?;
        }
    }

    state.servers.lock().unwrap().push(entry.clone());
    state.persist_servers()?;

    // instala em segundo plano; o frontend acompanha pelos eventos de progresso
    let entry_clone = entry.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        java_mgr::emit(Some(&app_handle), ProgressEvent {
            server_id: id.clone(),
            stage: "start".into(),
            message: "Iniciando a instalação...".into(),
            percent: Some(0.0),
        });
        let result = installer::install_server(&entry_clone, Some(&app_handle)).await;
        match result {
            Ok(outcome) => {
                let _ = app_handle.emit(
                    "server://installed",
                    serde_json::json!({
                        "serverId": id,
                        "jar": outcome.jar,
                        "note": outcome.extra_note,
                    }),
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "server://install-failed",
                    serde_json::json!({ "serverId": id, "error": e.to_string() }),
                );
            }
        }
    });

    Ok(entry)
}

fn next_free_port() -> u16 {
    // procura uma porta livre a partir de 25565
    use std::net::TcpListener;
    for port in 25565u16..25700 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    25565
}

#[tauri::command]
pub fn update_server(
    server_id: String,
    patch: ServerPatch,
    state: State<'_, AppState>,
) -> CommandResult<ServerEntry> {
    state
        .find(&server_id)
        .and_then(|_existing| {
            state.update(&server_id, move |entry| {
                if let Some(name) = patch.name {
                    entry.name = name;
                }
                if let Some(jar) = patch.jar {
                    entry.jar = jar;
                }
                if let Some(ram) = patch.ram_mb {
                    entry.ram_mb = ram;
                }
                if let Some(java) = patch.java_major {
                    entry.java_major = java;
                }
                if let Some(port) = patch.port {
                    entry.port = port;
                }
                if let Some(motd) = patch.motd {
                    entry.motd = motd;
                }
                if let Some(version) = patch.version {
                    entry.version = version;
                }
            })
        })
        .map(|_| ())?;
    // reescreve o server.properties para refletir nome/MOTD/porta
    let entry = state.find(&server_id)?;
    let dir = util::server_dir(&server_id);
    let _ = installer::write_properties(&dir, &entry);
    let _ = existing_name(&state, &server_id);
    Ok(entry)
}

fn existing_name(state: &AppState, id: &str) -> String {
    state
        .servers
        .lock()
        .unwrap()
        .iter()
        .find(|s| s.id == id)
        .map(|s| s.name.clone())
        .unwrap_or_default()
}

#[derive(serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerPatch {
    pub name: Option<String>,
    pub jar: Option<String>,
    pub ram_mb: Option<u32>,
    pub java_major: Option<u32>,
    pub port: Option<u16>,
    pub motd: Option<crate::model::Motd>,
    pub version: Option<String>,
}

#[tauri::command]
pub fn set_server_motd(
    server_id: String,
    motd: crate::model::Motd,
    state: State<'_, AppState>,
) -> CommandResult<ServerEntry> {
    let entry = state.update(&server_id, move |e| e.motd = motd.clone())?;
    let dir = util::server_dir(&server_id);
    installer::write_properties(&dir, &entry)?;
    Ok(entry)
}

/// Troca o ícone usando um arquivo do computador (redimensiona para 64x64).
#[tauri::command]
pub fn set_server_icon(
    server_id: String,
    source_path: String,
    state: State<'_, AppState>,
) -> CommandResult<ServerEntry> {
    let _entry = state.find(&server_id)?;
    let dir = util::server_dir(&server_id);
    let dest = dir.join("server-icon.png");
    installer::resize_icon(&PathBuf::from(source_path), &dest)?;
    let updated = state.update(&server_id, move |e| e.icon = Some("server-icon.png".into()))?;
    Ok(updated)
}

#[tauri::command]
pub fn get_server(server_id: String, state: State<'_, AppState>) -> CommandResult<ServerEntry> {
    state.find(&server_id)
}

/// Apaga o servidor (a pasta continua no disco; use com cuidado).
#[tauri::command]
pub async fn delete_server(
    server_id: String,
    wipe_folder: bool,
    state: State<'_, AppState>,
    hub: State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    if hub.is_running(&server_id) {
        return err("pare o servidor antes de removê-lo");
    }
    {
        let mut servers = state.servers.lock().unwrap();
        servers.retain(|s| s.id != server_id);
        state.persist_servers()?;
    }
    if wipe_folder {
        let _ = fs::remove_dir_all(util::server_dir(&server_id));
    }
    Ok(())
}

/// Pasta absoluta do servidor (útil para mostrar no painel).
#[tauri::command]
pub fn server_path(server_id: String) -> CommandResult<String> {
    Ok(util::server_dir(&server_id).to_string_lossy().to_string())
}

/// Caminhos de dados do painel (para a tela de informações).
#[tauri::command]
pub fn app_paths() -> CommandResult<serde_json::Value> {
    Ok(serde_json::json!({
        "home": util::dsm_home(),
        "servers": util::servers_dir(),
        "java": util::java_dir(),
        "backups": util::backups_dir(),
        "cache": util::cache_dir(),
    }))
}

/// Garante que o Java de uma major version está disponível.
#[tauri::command]
pub async fn ensure_java(major: u32, state: State<'_, AppState>, app: AppHandle) -> CommandResult<String> {
    let _ = state;
    let path = java_mgr::ensure_java(major, "system", Some(&app)).await?;
    Ok(path.to_string_lossy().to_string())
}

/// Lista as major versions de Java já baixadas / disponíveis.
#[tauri::command]
pub fn java_status() -> CommandResult<Vec<serde_json::Value>> {
    Ok(java_mgr::available_majors()
        .into_iter()
        .map(|major| {
            serde_json::json!({
                "major": major,
                "installed": java_mgr::java_binary(major).is_some(),
                "path": java_mgr::java_binary(major).map(|p| p.to_string_lossy().to_string()),
            })
        })
        .collect())
}

/// Diagnóstico: grava uma linha em ~/.dsm/crash.log.
///
/// Feito no backend (e não com o plugin de fs do frontend) porque não depende
/// das permissões do webview: assim o registro sobrevive mesmo quando a
/// interface não consegue escrever. É o que consultamos quando alguém diz
/// "o app abre mas fica branco".
#[tauri::command]
pub fn log_diagnostico(linha: String) -> CommandResult<()> {
    let path = util::dsm_home().join("crash.log");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let stamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S");
    let mut conteudo = String::new();
    if path.exists() {
        conteudo = fs::read_to_string(&path)?;
    }
    // o arquivo não pode crescer sem limite: guarda as últimas 200 linhas
    let mut linhas: Vec<&str> = conteudo.lines().collect();
    linhas.push(Box::leak(format!("[{stamp}] {linha}").into_boxed_str()));
    let excesso = linhas.len().saturating_sub(200);
    if excesso > 0 {
        linhas.drain(0..excesso);
    }
    fs::write(&path, linhas.join("\n") + "\n")?;
    Ok(())
}

/// Ícone do servidor em base64 (PNG 64x64), para a interface mostrar.
#[tauri::command]
pub fn get_server_icon(server_id: String) -> CommandResult<Option<String>> {
    let path = util::server_dir(&server_id).join("server-icon.png");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path)?;
    use base64::Engine;
    Ok(Some(base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Teste de vida: o frontend usa para saber que o backend respondeu.
#[tauri::command]
pub fn ping() -> CommandResult<String> {
    Ok("pong".into())
}

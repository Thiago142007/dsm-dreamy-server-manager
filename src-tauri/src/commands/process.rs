//! Comandos de ciclo de vida do servidor: iniciar, parar, reiniciar, forçar e console.
use tauri::{AppHandle, State};

use crate::error::{err, CommandResult};
use crate::java_mgr;
use crate::model::{LogLine, ServerEntry, ServerStatus};
use crate::process_mgr::{LaunchSpec, ProcessHub};
use crate::state::AppState;
use crate::util;

/// Monta o comando de inicialização de um servidor.
///
/// Regras:
/// - Forge/NeoForge escrevem `unix_args.txt`, então o Java é chamado com `@args`
///   e a RAM vem de `user_jvm_args.txt` (que regravamos aqui).
/// - Fabric/Quilt/Paper/Vanilla etc. usam `-Xmx<RAM>M -jar server.jar nogui`.
/// - Bedrock roda o binário `bedrock_server` direto.
/// - PocketMine roda `php PocketMine-MP.phar`.
pub async fn build_launch(entry: &ServerEntry, app: &AppHandle) -> CommandResult<LaunchSpec> {
    let dir = util::server_dir(&entry.id);

    if entry.software == "pocketmine" {
        let php = java_mgr::which("php").ok_or_else(|| {
            crate::error::CommandError::Other(
                "PHP não encontrado. Instale com: sudo apt install php-cli".into(),
            )
        })?;
        return Ok(LaunchSpec {
            java: php,
            args: vec!["PocketMine-MP.phar".into()],
            dir,
        });
    }

    if entry.software == "bedrock" {
        let bin = dir.join("bedrock_server");
        if !bin.exists() {
            return Err(crate::error::CommandError::Other(
                "bedrock_server não encontrado na pasta do servidor".into(),
            ));
        }
        return Ok(LaunchSpec {
            java: bin,
            args: vec![],
            dir,
        });
    }

    let java = java_mgr::ensure_java(entry.java_major, &entry.id, Some(&app)).await?;

    let args_txt = dir.join("unix_args.txt");
    if args_txt.exists() {
        // Forge/NeoForge: a RAM é lida de user_jvm_args.txt
        let jvm_args = dir.join("user_jvm_args.txt");
        let content = format!(
            "# Arquivo gerado pelo DSM\n-Xmx{}M\n-Xms{}M\n",
            entry.ram_mb, entry.ram_mb
        );
        std::fs::write(&jvm_args, content)?;
        return Ok(LaunchSpec {
            java,
            args: vec![
                "@user_jvm_args.txt".into(),
                "@unix_args.txt".into(),
            ],
            dir,
        });
    }

    let jar = dir.join(&entry.jar);
    if !jar.exists() {
        return Err(crate::error::CommandError::Other(format!(
            "o arquivo {} não existe na pasta do servidor. Veja a aba Arquivos.",
            entry.jar
        )));
    }

    Ok(LaunchSpec {
        java,
        args: vec![
            format!("-Xmx{}M", entry.ram_mb),
            format!("-Xms{}M", entry.ram_mb),
            "-jar".into(),
            entry.jar.clone(),
            "nogui".into(),
        ],
        dir,
    })
}

#[tauri::command]
pub async fn start_server(
    server_id: String,
    state: State<'_, AppState>,
    hub: State<'_, std::sync::Arc<ProcessHub>>,
    app: AppHandle,
) -> CommandResult<ServerStatus> {
    let entry = state.find(&server_id)?;
    if hub.is_running(&server_id) {
        return err("o servidor já está rodando");
    }
    let spec = build_launch(&entry, &app).await?;
    hub.spawn(&server_id, spec)?;
    Ok(ServerStatus::Starting)
}

#[tauri::command]
pub fn stop_server(
    server_id: String,
    hub: State<'_, std::sync::Arc<ProcessHub>>,
) -> CommandResult<()> {
    hub.stop(&server_id)
}

#[tauri::command]
pub fn restart_server(
    server_id: String,
    hub: State<'_, std::sync::Arc<ProcessHub>>,
) -> CommandResult<()> {
    hub.restart(&server_id)
}

#[tauri::command]
pub fn force_stop_server(
    server_id: String,
    hub: State<'_, std::sync::Arc<ProcessHub>>,
) -> CommandResult<()> {
    hub.force_stop(&server_id)
}

#[tauri::command]
pub fn send_console(
    server_id: String,
    command: String,
    hub: State<'_, std::sync::Arc<ProcessHub>>,
) -> CommandResult<()> {
    hub.send(&server_id, command.trim())
}

#[tauri::command]
pub fn console_history(server_id: String, hub: State<'_, std::sync::Arc<ProcessHub>>) -> CommandResult<Vec<LogLine>> {
    Ok(hub.history(&server_id))
}

#[tauri::command]
pub fn server_status(server_id: String, hub: State<'_, std::sync::Arc<ProcessHub>>) -> CommandResult<ServerStatus> {
    Ok(hub.status(&server_id))
}

/// Comando de inicialização em texto (aba Inicialização).
#[tauri::command]
pub fn startup_command(
    server_id: String,
    state: State<'_, AppState>,
    hub: State<'_, std::sync::Arc<ProcessHub>>,
) -> CommandResult<serde_json::Value> {
    let entry = state.find(&server_id)?;
    let dir = util::server_dir(&server_id);
    let unix_args = dir.join("unix_args.txt").exists();
    let java = if entry.software == "pocketmine" {
        java_mgr::which("php")
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "php".into())
    } else if entry.software == "bedrock" {
        "./bedrock_server".into()
    } else {
        java_mgr::java_binary(entry.java_major)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("java {}", entry.java_major))
    };
    let command = if entry.software == "pocketmine" {
        format!("php PocketMine-MP.phar")
    } else if entry.software == "bedrock" {
        "./bedrock_server".into()
    } else if unix_args {
        format!("{} @user_jvm_args.txt @unix_args.txt", java)
    } else {
        format!(
            "{} -Xmx{}M -Xms{}M -jar {} nogui",
            java, entry.ram_mb, entry.ram_mb, entry.jar
        )
    };
    let _ = hub;
    Ok(serde_json::json!({
        "command": command,
        "jar": entry.jar,
        "jarPath": dir.join(&entry.jar).to_string_lossy(),
        "unixArgs": unix_args,
        "running": hub.is_running(&server_id),
    }))
}

/// Define a RAM máxima e reescreve o comando de inicialização.
#[tauri::command]
pub fn set_ram(
    server_id: String,
    ram_mb: u32,
    state: State<'_, AppState>,
) -> CommandResult<ServerEntry> {
    if !(256..=262144).contains(&ram_mb) {
        return err("a RAM deve ficar entre 256 MB e 256 GB");
    }
    state.update(&server_id, move |e| e.ram_mb = ram_mb)
}

/// Define a versão do Java.
#[tauri::command]
pub fn set_java_major(
    server_id: String,
    major: u32,
    state: State<'_, AppState>,
) -> CommandResult<ServerEntry> {
    state.update(&server_id, move |e| e.java_major = major)
}

/// Define o nome do jar de inicialização.
#[tauri::command]
pub fn set_jar_name(
    server_id: String,
    jar: String,
    state: State<'_, AppState>,
) -> CommandResult<ServerEntry> {
    let jar = jar.trim().to_string();
    if jar.is_empty() || jar.contains('/') || jar.contains("..") {
        return err("nome de jar inválido");
    }
    state.update(&server_id, move |e| e.jar = jar)
}

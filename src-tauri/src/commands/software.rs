//! Software disponível e troca de software/versão (com backup automático).
use tauri::Emitter;
use tauri::{AppHandle, State};

use crate::catalog;
use crate::error::{err, CommandResult};
use crate::java_mgr;
use crate::model::{ProgressEvent, ServerEntry};
use crate::process_mgr::ProcessHub;
use crate::software;
use crate::state::AppState;
use crate::util;

#[tauri::command]
pub fn list_software() -> CommandResult<Vec<crate::model::SoftwareInfo>> {
    Ok(software::all())
}

/// Abas que o painel deve mostrar para um software.
#[tauri::command]
pub fn tabs_for(server_id: String, state: State<'_, AppState>) -> CommandResult<serde_json::Value> {
    let entry = state.find(&server_id)?;
    Ok(serde_json::to_value(software::tabs_for(&entry.software))?)
}

#[tauri::command]
pub async fn versions(software_id: String) -> CommandResult<Vec<catalog::VersionOption>> {
    catalog::versions(&software_id).await
}

#[tauri::command]
pub async fn install_plan(
    software_id: String,
    version: String,
) -> CommandResult<catalog::InstallPlan> {
    catalog::install_plan(&software_id, &version).await
}

/// Troca o software e a versão de um servidor existente.
///
/// Quando `wipe` é true, o painel faz um backup completo antes (para o usuário
/// poder voltar atrás) e depois limpa a pasta do servidor.
#[tauri::command]
pub async fn change_software(
    server_id: String,
    software_id: String,
    version: String,
    wipe: bool,
    state: State<'_, AppState>,
    hub: State<'_, std::sync::Arc<ProcessHub>>,
    app: AppHandle,
) -> CommandResult<ServerEntry> {
    let _entry = state.find(&server_id)?;
    if hub.is_running(&server_id) {
        return err("pare o servidor antes de trocar o software");
    }
    if software::by_id(&software_id).is_none() {
        return err(format!("software inválido: {software_id}"));
    }
    if software_id == "modpack" {
        return err("modpacks são trocados pela aba Modpacks");
    }

    let backup_file = if wipe {
        let dir = util::server_dir(&server_id);
        let backup_dir = util::backups_dir().join(&server_id);
        std::fs::create_dir_all(&backup_dir)?;
        let file = backup_dir.join(format!("{}_troca-de-software.tar.gz", util::stamp_now()));
        java_mgr::emit(Some(&app), ProgressEvent {
            server_id: server_id.clone(),
            stage: "backup".into(),
            message: "Fazendo backup de segurança antes da troca...".into(),
            percent: Some(0.05),
        });
        util::create_tar_gz(&[("server".into(), dir)], &file)?;
        Some(file.to_string_lossy().to_string())
    } else {
        None
    };

    // limpa a pasta quando o usuário pediu para apagar tudo
    if wipe {
        let dir = util::server_dir(&server_id);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let _ = util::remove_any(&e.path());
            }
        }
    }

    let java_major = software::java_major_for(&version);
    let updated = state.update(&server_id, move |e| {
        e.software = software_id.clone();
        e.version = version.clone();
        e.java_major = java_major;
        e.modpack = None;
    })?;

    let outcome = crate::installer::install_server(&updated, Some(&app)).await;
    match outcome {
        Ok(o) => {
            let entry = state.update(&server_id, move |e| {
                if !o.jar.is_empty() {
                    e.jar = o.jar;
                }
            })?;
            let _ = app.emit(
                "server://installed",
                serde_json::json!({ "serverId": server_id, "backup": backup_file }),
            );
            Ok(entry)
        }
        Err(e) => Err(e),
    }
}

/// Remove o cache de versões (útil quando uma API muda).
#[tauri::command]
pub fn clear_version_cache(software_id: Option<String>) -> CommandResult<()> {
    let dir = util::cache_dir();
    if let Some(id) = software_id {
        let _ = std::fs::remove_file(dir.join(format!("versions-{id}.json")));
    } else if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    Ok(())
}

//! Agendamento de tarefas (reinício, backup, comandos) com expressões cron.
use tauri::State;


use crate::error::{err, CommandResult};
use crate::model::{ScheduledTask, ServerEntry};
use crate::process_mgr::ProcessHub;
use crate::state::AppState;

#[tauri::command]
pub fn list_tasks(server_id: String, state: State<'_, AppState>) -> CommandResult<Vec<ScheduledTask>> {
    Ok(state
        .tasks
        .lock()
        .unwrap()
        .iter()
        .filter(|t| t.server_id == server_id)
        .cloned()
        .collect())
}

#[tauri::command]
pub fn all_tasks(state: State<'_, AppState>) -> CommandResult<Vec<ScheduledTask>> {
    Ok(state.tasks.lock().unwrap().clone())
}

/// Valida uma expressão cron de 6 campos (segundo minuto hora dia mês dia-da-semana).
pub fn validate_cron(expr: &str) -> CommandResult<cron::Schedule> {
    cron::Schedule::try_from(expr)
        .map_err(|e: cron::error::Error| crate::error::CommandError::Other(format!("cron inválido: {e}")))
}

#[tauri::command]
pub fn create_task(
    server_id: String,
    name: String,
    cron_expression: String,
    action: String,
    payload: String,
    state: State<'_, AppState>,
) -> CommandResult<ScheduledTask> {
    validate_cron(&cron_expression)?;
    if !matches!(action.as_str(), "restart" | "backup" | "command" | "stop" | "start") {
        return err("ação inválida (use restart, backup, command, stop ou start)");
    }
    if action == "command" && payload.trim().is_empty() {
        return err("informe o comando a ser executado");
    }
    let task = ScheduledTask {
        id: uuid::Uuid::new_v4().to_string(),
        server_id,
        name: if name.trim().is_empty() {
            "Tarefa sem nome".into()
        } else {
            name
        },
        cron: cron_expression,
        action,
        payload,
        enabled: true,
        last_run: None,
    };
    state.tasks.lock().unwrap().push(task.clone());
    state.persist_tasks()?;
    Ok(task)
}

#[tauri::command]
pub fn update_task(
    task_id: String,
    enabled: Option<bool>,
    name: Option<String>,
    cron_expression: Option<String>,
    action: Option<String>,
    payload: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<ScheduledTask> {
    if let Some(expr) = &cron_expression {
        validate_cron(expr)?;
    }
    let mut tasks = state.tasks.lock().unwrap();
    let task = tasks
        .iter_mut()
        .find(|t| t.id == task_id)
        .ok_or_else(|| crate::error::CommandError::Other("tarefa não encontrada".into()))?;
    if let Some(v) = enabled {
        task.enabled = v;
    }
    if let Some(v) = name {
        task.name = v;
    }
    if let Some(v) = cron_expression {
        task.cron = v;
    }
    if let Some(v) = action {
        task.action = v;
    }
    if let Some(v) = payload {
        task.payload = v;
    }
    let updated = task.clone();
    drop(tasks);
    state.persist_tasks()?;
    Ok(updated)
}

#[tauri::command]
pub fn delete_task(task_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let mut tasks = state.tasks.lock().unwrap();
    tasks.retain(|t| t.id != task_id);
    drop(tasks);
    state.persist_tasks()
}

/// Executa uma tarefa agora (botão "testar").
#[tauri::command]
pub fn run_task_now(
    task_id: String,
    state: State<'_, AppState>,
    hub: State<'_, std::sync::Arc<ProcessHub>>,
) -> CommandResult<()> {
    let task = {
        let tasks = state.tasks.lock().unwrap();
        tasks
            .iter()
            .find(|t| t.id == task_id)
            .cloned()
            .ok_or_else(|| crate::error::CommandError::Other("tarefa não encontrada".into()))?
    };
    let entry: Option<ServerEntry> = {
        let servers = state.servers.lock().unwrap();
        servers.iter().find(|s| s.id == task.server_id).cloned()
    };
    let entry = entry.ok_or_else(|| crate::error::CommandError::ServerNotFound(task.server_id.clone()))?;
    run_action(&entry, &task.action, &task.payload, &hub)?;
    let stamp = chrono::Local::now().to_rfc3339();
    let mut tasks = state.tasks.lock().unwrap();
    if let Some(t) = tasks.iter_mut().find(|t| t.id == task_id) {
        t.last_run = Some(stamp);
    }
    drop(tasks);
    state.persist_tasks()?;
    Ok(())
}

/// Roda a ação de uma tarefa. Chamado também pelo agendador em background.
pub fn run_action(
    entry: &ServerEntry,
    action: &str,
    payload: &str,
    hub: &ProcessHub,
) -> CommandResult<()> {
    match action {
        "restart" => hub.restart(&entry.id),
        "stop" => hub.stop(&entry.id),
        "command" => hub.send(&entry.id, payload.trim()),
        "backup" => {
            let dir = crate::util::server_dir(&entry.id);
            let backup_dir = crate::util::backups_dir().join(&entry.id);
            std::fs::create_dir_all(&backup_dir)?;
            let file = backup_dir.join(format!("{}.tar.gz", crate::util::stamp_now()));
            crate::util::create_tar_gz(&[("server".into(), dir)], &file)?;
            Ok(())
        }
        "start" => Err(crate::error::CommandError::Other(
            "início automático é feito pela thread do agendador".into(),
        )),
        other => Err(crate::error::CommandError::Other(format!("ação desconhecida: {other}"))),
    }
}

/// Pré-visualiza as próximas execuções de uma expressão cron.
#[tauri::command]
pub fn cron_preview(cron_expression: String, limit: Option<usize>) -> CommandResult<Vec<String>> {
    let schedule = validate_cron(&cron_expression)?;
    let limit = limit.unwrap_or(5).min(20);
    Ok(schedule
        .upcoming(chrono::Local)
        .take(limit)
        .map(|t| t.format("%d/%m/%Y %H:%M:%S").to_string())
        .collect())
}

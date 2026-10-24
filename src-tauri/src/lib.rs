//! DSM — Painel de servidor de Minecraft para Linux.
//!
//! Biblioteca do app: registra o estado, os plugins e todos os comandos, e sobe
//! a thread do agendador de tarefas. O binário (`main.rs`) só chama `run()`.
// `cron` é uma crate externa; o Scheduler a usa por caminho completo.
extern crate cron;

pub mod catalog;
pub mod commands;
pub mod error;
pub mod installer;
pub mod java_mgr;
pub mod model;
pub mod process_mgr;
pub mod software;
pub mod state;
pub mod util;

use std::sync::Arc;
use std::time::Duration;

use process_mgr::ProcessHub;
use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let state = AppState::load().map_err(|e| format!("falha ao carregar os dados: {e}"))?;
            app.manage(state);
            let hub = ProcessHub::new(app.handle().clone());
            app.manage(hub);

            // a janela principal vem do array `windows` do tauri.conf.json
            ajustar_janela(app)?;

            let scheduler_app = app.handle().clone();
            std::thread::spawn(move || scheduler_loop(scheduler_app));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // utilidades
            commands::servers::ping,
            commands::servers::app_paths,
            commands::servers::server_path,
            commands::servers::get_server_icon,
            commands::servers::log_diagnostico,
            commands::servers::log_diagnostico,
            // servidores
            commands::servers::list_servers,
            commands::servers::get_server,
            commands::servers::create_server,
            commands::servers::update_server,
            commands::servers::delete_server,
            commands::servers::set_server_motd,
            commands::servers::set_server_icon,
            commands::servers::ensure_java,
            commands::servers::java_status,
            // catálogo / software
            commands::software::list_software,
            commands::software::versions,
            commands::software::install_plan,
            commands::software::tabs_for,
            commands::software::change_software,
            commands::software::clear_version_cache,
            // ciclo de vida
            commands::process::start_server,
            commands::process::stop_server,
            commands::process::restart_server,
            commands::process::force_stop_server,
            commands::process::send_console,
            commands::process::console_history,
            commands::process::server_status,
            commands::process::startup_command,
            commands::process::set_ram,
            commands::process::set_java_major,
            commands::process::set_jar_name,
            // server.properties
            commands::properties::read_properties,
            commands::properties::set_property,
            commands::properties::set_properties,
            commands::properties::remove_property,
            commands::properties::properties_path,
            // arquivos
            commands::files::list_files,
            commands::files::read_text_file,
            commands::files::write_text_file,
            commands::files::create_folder,
            commands::files::create_file,
            commands::files::rename_path,
            commands::files::delete_paths,
            commands::files::copy_paths,
            commands::files::move_paths,
            commands::files::compress_paths,
            commands::files::extract_archive,
            commands::files::is_archive_path,
            commands::files::download_paths,
            commands::files::path_exists,
            // players
            commands::players::list_online_players,
            commands::players::resolve_player_name,
            commands::players::list_whitelist,
            commands::players::add_to_whitelist,
            commands::players::remove_from_whitelist,
            commands::players::list_ops,
            commands::players::add_op,
            commands::players::remove_op,
            commands::players::list_banned_players,
            commands::players::ban_player,
            commands::players::ban_player_nick,
            commands::players::ban_player_ip,
            commands::players::unban_player,
            commands::players::list_banned_ips,
            commands::players::ban_ip,
            commands::players::unban_ip,
            commands::players::get_player_snapshot,
            commands::players::set_player_health,
            commands::players::set_player_food,
            commands::players::move_item,
            commands::players::set_item_count,
            commands::players::remove_item,
            commands::players::give_item,
            commands::players::kill_player,
            commands::players::kit_player,
            commands::players::list_kits,
            // mundos
            commands::worlds::list_worlds,
            commands::worlds::regenerate_world,
            commands::worlds::world_files,
            commands::worlds::upload_world,
            // backups
            commands::backups::list_backups,
            commands::backups::create_backup,
            commands::backups::restore_backup,
            commands::backups::copy_backup,
            commands::backups::move_backup,
            commands::backups::delete_backup,
            commands::backups::backup_size,
            // logs
            commands::logs::list_logs,
            commands::logs::read_log,
            commands::logs::copy_log,
            commands::logs::delete_log,
            // conteúdo (plugins, mods, datapacks)
            commands::content::search_content,
            commands::content::install_content,
            commands::content::installed_content,
            // agendamento
            commands::scheduler::list_tasks,
            commands::scheduler::all_tasks,
            commands::scheduler::create_task,
            commands::scheduler::update_task,
            commands::scheduler::delete_task,
            commands::scheduler::run_task_now,
            commands::scheduler::cron_preview,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o DSM");
}

/// Garante que a janela principal existe e tem o tamanho/título certos.
///
/// A janela vem do array `windows` do tauri.conf.json, mas acertamos tudo em
/// runtime porque a combinação tauri 2.12 + tauri-build 2.7 pode embarcar a
/// config sem essa seção — aí a janela nasceria com 200x200 (padrão do GTK) e
/// sem título. Assim o resultado é o mesmo em qualquer combinação de versões.
fn ajustar_janela(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

    let titulo = "DSM — Painel de Servidor Minecraft";

    let window = if let Some(existing) = app.webview_windows().values().next().cloned() {
        existing.set_title(titulo)?;
        existing.set_size(LogicalSize::new(1280.0, 820.0))?;
        existing.set_min_size(Some(LogicalSize::new(940.0, 600.0)))?;
        existing
    } else {
        WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
            .title(titulo)
            .inner_size(1280.0, 820.0)
            .min_inner_size(940.0, 600.0)
            .resizable(true)
            .decorations(true)
            .visible(true)
            .theme(Some(tauri::Theme::Dark))
            .build()?
    };

    // garante que ela aparece de fato
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Thread que roda as tarefas agendadas a cada 30 segundos.
fn scheduler_loop(app: tauri::AppHandle) {
    use chrono::{Duration as ChronoDuration, Local};
    loop {
        std::thread::sleep(Duration::from_secs(30));
        let state = match app.try_state::<AppState>() {
            Some(s) => s,
            None => continue,
        };
        let hub = match app.try_state::<Arc<ProcessHub>>() {
            Some(h) => h.inner().clone(),
            None => continue,
        };
        let tasks = state.tasks.lock().unwrap().clone();
        let servers = state.servers.lock().unwrap().clone();
        let now = Local::now();
        for task in tasks.iter().filter(|t| t.enabled) {
            let schedule = match cron::Schedule::try_from(task.cron.as_str()) {
                Ok(s) => s,
                Err(_) => continue,
            };
            // janela de 30s: se havia uma execução prevista nesse intervalo, roda
            let window_start = now - ChronoDuration::seconds(31);
            let due = schedule
                .after(&window_start)
                .next()
                .map(|t| t <= now)
                .unwrap_or(false);
            if !due {
                continue;
            }
            // evita rodar duas vezes no mesmo minuto
            let stamp = now.format("%Y%m%d%H%M").to_string();
            let already = task
                .last_run
                .as_deref()
                .map(|l| l.replace(['-', ':', 'T'], "").starts_with(&stamp))
                .unwrap_or(false);
            if already {
                continue;
            }
            if let Some(entry) = servers.iter().find(|s| s.id == task.server_id) {
                let _ = commands::scheduler::run_action(entry, &task.action, &task.payload, &hub);
                let stamp = now.to_rfc3339();
                if let Some(t) = state.tasks.lock().unwrap().iter_mut().find(|t| t.id == task.id) {
                    t.last_run = Some(stamp);
                }
                let _ = state.persist_tasks();
            }
        }
    }
}

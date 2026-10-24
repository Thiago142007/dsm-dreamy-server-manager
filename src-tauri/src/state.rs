//! Estado global do app: registro de servidores, configs e agendamentos.
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::CommandResult;
use crate::model::{ScheduledTask, ServerEntry};
use crate::util;

/// Configurações do painel.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub prefer_official_assets: bool,
    pub notifications: bool,
    pub default_ram_mb: u32,
}

pub struct AppState {
    pub servers: Mutex<Vec<ServerEntry>>,
    pub tasks: Mutex<Vec<ScheduledTask>>,
    pub settings: Mutex<AppSettings>,
    pub data_file: PathBuf,
    pub tasks_file: PathBuf,
    pub settings_file: PathBuf,
}

impl AppState {
    pub fn load() -> CommandResult<Self> {
        let home = util::dsm_home();
        fs::create_dir_all(&home)?;
        fs::create_dir_all(util::servers_dir())?;
        fs::create_dir_all(util::java_dir())?;
        fs::create_dir_all(util::backups_dir())?;
        fs::create_dir_all(util::cache_dir())?;

        let data_file = home.join("servers.json");
        let tasks_file = home.join("tasks.json");
        let settings_file = home.join("settings.json");

        let servers: Vec<ServerEntry> = read_json(&data_file)?.unwrap_or_default();
        let tasks: Vec<ScheduledTask> = read_json(&tasks_file)?.unwrap_or_default();
        let settings: AppSettings = read_json(&settings_file)?.unwrap_or(AppSettings {
            prefer_official_assets: true,
            notifications: true,
            default_ram_mb: 2048,
        });

        Ok(Self {
            servers: Mutex::new(servers),
            tasks: Mutex::new(tasks),
            settings: Mutex::new(settings),
            data_file,
            tasks_file,
            settings_file,
        })
    }

    pub fn persist_servers(&self) -> CommandResult<()> {
        let servers = self.servers.lock().unwrap().clone();
        write_json(&self.data_file, &servers)
    }

    pub fn persist_tasks(&self) -> CommandResult<()> {
        let tasks = self.tasks.lock().unwrap().clone();
        write_json(&self.tasks_file, &tasks)
    }

    pub fn persist_settings(&self) -> CommandResult<()> {
        let settings = self.settings.lock().unwrap().clone();
        write_json(&self.settings_file, &settings)
    }

    pub fn find(&self, id: &str) -> CommandResult<ServerEntry> {
        self.servers
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| crate::error::CommandError::ServerNotFound(id.to_string()))
    }

    pub fn update<F: FnOnce(&mut ServerEntry)>(&self, id: &str, f: F) -> CommandResult<ServerEntry> {
        let mut servers = self.servers.lock().unwrap();
        let entry = servers
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| crate::error::CommandError::ServerNotFound(id.to_string()))?;
        f(entry);
        let updated = entry.clone();
        drop(servers);
        self.persist_servers()?;
        Ok(updated)
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> CommandResult<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&raw)?))
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(value)?;
    fs::write(path, raw)?;
    Ok(())
}

//! Modelos de dados compartilhados entre o backend e o frontend.
use serde::{Deserialize, Serialize};

/// MotD do servidor (duas linhas, como no server.properties).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Motd {
    pub line1: String,
    pub line2: String,
}

/// Servidor registrado no painel.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub id: String,
    pub name: String,
    /// id do software: "vanilla", "paper", "fabric", "modpack", ...
    pub software: String,
    /// versão do Minecraft/Jogo ("" quando for modpack ainda não instalado)
    pub version: String,
    /// caminho relativo do ícone dentro da pasta do servidor
    pub icon: Option<String>,
    pub motd: Motd,
    /// major version do java (8, 17, 21, 25 ...)
    pub java_major: u32,
    /// RAM máxima em MB
    pub ram_mb: u32,
    /// nome do jar de inicialização (padrão "server.jar")
    pub jar: String,
    pub port: u16,
    pub created_at: String,
    /// id do projeto Modrinth quando o software é "modpack"
    pub modpack: Option<String>,
    /// EULA aceita (obrigatório para servidores oficiais)
    pub eula_accepted: bool,
}

impl ServerEntry {
    pub fn motd_joined(&self) -> String {
        format!("{}\n{}", self.motd.line1, self.motd.line2)
    }
}

/// Status do processo do servidor.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    Offline,
    Starting,
    Online,
    Stopping,
}

/// Uma linha de console/log.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub id: u64,
    pub ts: String,
    pub stream: String, // "stdout" | "stderr"
    pub line: String,
}

/// Evento de progresso enviado durante download/instalação.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub server_id: String,
    pub stage: String,
    pub message: String,
    /// 0.0 .. 1.0 (None = indeterminado)
    pub percent: Option<f64>,
}

/// Software disponível para criar um servidor.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareInfo {
    pub id: String,
    pub name: String,
    pub kind: String, // "java" | "bedrock" | "php"
    pub plugins: bool,
    pub mods: bool,
    pub datapacks: bool,
    /// true = usa server.properties / estrutura de mundo Java
    pub properties: bool,
    pub proxy: bool,
    pub description: String,
}

/// Tarefa agendada.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub server_id: String,
    pub name: String,
    /// expressão cron de 6 campos (seg min hora dia mês dia-da-semana)
    pub cron: String,
    pub action: String, // "restart" | "backup" | "command" | "stop" | "start"
    pub payload: String,
    pub enabled: bool,
    pub last_run: Option<String>,
}

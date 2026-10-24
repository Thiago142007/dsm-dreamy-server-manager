//! Registro de softwares de servidor suportados e suas capacidades.
use crate::model::SoftwareInfo;

/// Java major version recomendada por versão do Minecraft.
///
/// Regras (as mesmas que o launcher usa):
/// - 1.21.9+ e o novo esquema de versões (26.x) → Java 25
/// - 1.20.5+ e todo 1.21.x → Java 21
/// - 1.18 a 1.20.4 → Java 17
/// - 1.17.x → Java 16
/// - 1.16.5 e anteriores → Java 8
pub fn java_major_for(game_version: &str) -> u32 {
    let v = game_version.trim();
    if let Some(rest) = v.strip_prefix("1.") {
        let parts: Vec<u32> = rest
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        let minor = parts.first().copied().unwrap_or(0);
        let patch = parts.get(1).copied().unwrap_or(0);
        if minor >= 22 {
            return 25;
        }
        if minor == 21 && patch >= 9 {
            return 25;
        }
        if minor == 21 {
            return 21;
        }
        if minor == 20 && patch >= 5 {
            return 21;
        }
        if minor >= 18 {
            return 17;
        }
        if minor == 17 {
            return 16;
        }
        return 8;
    }
    // esquema novo de versões (26.x, 27.x ...)
    let major: u32 = v.split('.').next().and_then(|s| s.parse().ok()).unwrap_or(26);
    match major {
        25..=u32::MAX => 25,
        21..=24 => 21,
        18..=20 => 17,
        _ => 8,
    }
}

fn soft(
    id: &str,
    name: &str,
    kind: &str,
    plugins: bool,
    mods: bool,
    datapacks: bool,
    properties: bool,
    proxy: bool,
    description: &str,
) -> SoftwareInfo {
    SoftwareInfo {
        id: id.to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        plugins,
        mods,
        datapacks,
        properties,
        proxy,
        description: description.to_string(),
    }
}

/// Todos os softwares oferecidos na tela de criação.
pub fn all() -> Vec<SoftwareInfo> {
    vec![
        soft("vanilla", "Vanilla", "java", false, false, true, true, false,
             "Servidor oficial da Mojang. Sem plugins ou mods, mas recebe datapacks."),
        soft("paper", "Paper", "java", true, false, true, true, false,
             "O mais usado. Alta performance e compatível com plugins de Spigot/Bukkit."),
        soft("purpur", "Purpur", "java", true, false, true, true, false,
             "Fork do Paper com dezenas de opções extras de configuração."),
        soft("spigot", "Spigot", "java", true, false, true, true, false,
             "Base histórica dos plugins. A instalação compila o BuildTools (5-15 min)."),
        soft("quilt", "Quilt", "java", false, true, true, true, false,
             "Loader de mods leve e rápido, compatível com a API do Fabric."),
        soft("mohist", "Mohist", "java", true, true, true, true, false,
             "Híbrido: aceita plugins de Bukkit e mods de Forge no mesmo servidor."),
        soft("bungeecord", "BungeeCord", "java", false, false, false, false, true,
             "Proxy clássico para juntar vários servidores em uma rede."),
        soft("pocketmine", "PocketMine-MP", "php", true, false, false, false, false,
             "Servidor de Minecraft Bedrock Edition feito em PHP."),
        soft("bedrock", "Vanilla Bedrock", "bedrock", true, false, false, false, false,
             "Servidor oficial Bedrock Dedicated Server (apenas a versão mais recente)."),
        soft("velocity", "Velocity", "java", false, false, false, false, true,
             "Proxy moderno e seguro, focado em performance e escalabilidade."),
        soft("fabric", "Fabric", "java", false, true, true, true, false,
             "Loader de mods com atualizações rápidas para cada nova versão."),
        soft("magma", "Magma", "java", true, true, true, true, false,
             "Servidor híbrido de mods Forge + plugins, focado em 1.12.2 a 1.20."),
        soft("neoforge", "NeoForge", "java", false, true, true, true, false,
             "Sucessor do Forge para as versões 1.20.2+ com mods."),
        soft("archlight", "ArchLight", "java", false, true, true, true, false,
             "Servidor de mods Forge otimizado, com melhorias de performance."),
        soft("modpack", "Modpacks", "java", false, true, true, true, false,
             "Instala um modpack completo do Modrinth/CurseForge já configurado."),
        soft("forge", "Forge", "java", false, true, true, true, false,
             "A plataforma de mods tradicional para as versões 1.7.10 a 1.20.1."),
    ]
}

pub fn by_id(id: &str) -> Option<SoftwareInfo> {
    all().into_iter().find(|s| s.id == id)
}

/// Abas habilitadas para um software.
#[derive(serde::Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tabs {
    pub plugins: bool,
    pub mods: bool,
    pub datapacks: bool,
    pub properties: bool,
}

/// Serializa as abas visíveis (o frontend só monta o que existe).
pub fn tabs_for(software_id: &str) -> Tabs {
    let s = by_id(software_id);
    Tabs {
        plugins: s.as_ref().map(|s| s.plugins).unwrap_or(false),
        mods: s.as_ref().map(|s| s.mods).unwrap_or(false),
        datapacks: s.as_ref().map(|s| s.datapacks).unwrap_or(false),
        properties: s.as_ref().map(|s| s.properties).unwrap_or(false),
    }
}

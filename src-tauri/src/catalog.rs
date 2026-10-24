//! Catálogo de versões por software de servidor.
//!
//! Cada software tem um adaptador que consulta a API oficial e devolve a lista de
//! versões do jogo. O resultado é cacheado em ~/.dsm/cache por 6 horas para a
//! interface continuar rápida (e funcionando offline).
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::error::{err, CommandResult};
use crate::util;

const CACHE_TTL: u64 = 6 * 60 * 60;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionOption {
    pub version: String,
    pub stable: bool,
    /// texto extra mostrado na interface (ex.: "apenas build mais recente")
    pub note: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InstallKind {
    /// baixa o jar direto e salva como server.jar
    Jar { url: String },
    /// baixa o instalador Forge/NeoForge e roda `java -jar installer.jar --installServer`
    ForgeInstaller { url: String },
    /// baixa o instalador Fabric/Quilt e gera o jar de inicialização
    ModLoader { installer_url: String, loader: String, minecraft: String },
    /// compila o Spigot com o BuildTools (5-15 minutos)
    BuildTools { version: String },
    /// baixa e extrai um arquivo (Bedrock / PocketMine)
    Extract { url: String, extract_to: String },
    /// canal de download indisponível
    Unavailable { reason: String },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub kind: InstallKind,
    pub note: String,
}

async fn get_json(url: &str) -> CommandResult<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("DSM-Minecraft-Panel/0.1")
        .build()?;
    let res = client.get(url).send().await?;
    let status = res.status();
    if !status.is_success() {
        return err(format!("GET {} -> HTTP {}", url, status.as_u16()));
    }
    Ok(res.json::<serde_json::Value>().await?)
}

async fn get_text(url: &str) -> CommandResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("DSM-Minecraft-Panel/0.1")
        .build()?;
    let res = client.get(url).send().await?;
    if !res.status().is_success() {
        return err(format!("GET {} -> HTTP {}", url, res.status().as_u16()));
    }
    Ok(res.text().await?)
}

fn cache_path(software: &str) -> PathBuf {
    util::cache_dir().join(format!("versions-{software}.json"))
}

fn read_cache(software: &str) -> Option<Vec<VersionOption>> {
    let path = cache_path(software);
    let meta = fs::metadata(&path).ok()?;
    let modified = meta.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).ok()?;
    if age > Duration::from_secs(CACHE_TTL) {
        return None;
    }
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_cache(software: &str, versions: &[VersionOption]) {
    let _ = fs::create_dir_all(util::cache_dir());
    if let Ok(raw) = serde_json::to_string(versions) {
        let _ = fs::write(cache_path(software), raw);
    }
}

fn opt(version: &str) -> VersionOption {
    let stable = !version.contains('-') && !version.contains('+') && !version.contains(' ');
    VersionOption { version: version.to_string(), stable, note: None }
}

fn opt_with_note(version: &str, note: &str) -> VersionOption {
    VersionOption { version: version.to_string(), stable: true, note: Some(note.to_string()) }
}

/// Lista de versões de um software (com cache).
///
/// Magma, ArchLight, Bedrock e PocketMine sempre buscam de novo: a resposta
/// também guarda as URLs de download, que precisam estar frescas.
pub async fn versions(software: &str) -> CommandResult<Vec<VersionOption>> {
    if software == "modpack" {
        return Ok(vec![opt_with_note("modpack", "escolha um modpack na aba Modpacks")]);
    }
    let live = matches!(software, "magma" | "archlight" | "bedrock" | "pocketmine");
    if !live {
        if let Some(cached) = read_cache(software) {
            return Ok(cached);
        }
    }
    let list = match software {
        "vanilla" => vanilla_versions().await?,
        "paper" | "velocity" => papermc_versions(software).await?,
        "purpur" => purpur_versions().await?,
        "fabric" => fabric_versions().await?,
        "quilt" => quilt_versions().await?,
        "spigot" => spigot_versions(),
        "bungeecord" => bungeecord_versions(),
        "bedrock" => bedrock_versions().await?,
        "pocketmine" => pocketmine_versions().await?,
        "magma" => magma_versions().await?,
        "neoforge" => neoforge_versions().await?,
        "forge" => forge_versions().await?,
        "archlight" => arclight_versions().await?,
        "mohist" => mohist_versions().await?,
        other => return err(format!("software desconhecido: {other}")),
    };
    if !list.is_empty() {
        write_cache(software, &list);
    }
    Ok(list)
}

// --------------------------------------------------------------- adaptadores

async fn vanilla_versions() -> CommandResult<Vec<VersionOption>> {
    let json = get_json("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json").await?;
    let arr = json["versions"]
        .as_array()
        .ok_or_else(|| crate::error::CommandError::Parse("sem campo versions".into()))?;
    let mut list: Vec<VersionOption> = arr
        .iter()
        .filter(|v| v["type"].as_str() == Some("release"))
        .map(|v| VersionOption {
            version: v["id"].as_str().unwrap_or_default().to_string(),
            stable: true,
            note: None,
        })
        .collect();
    list.reverse(); // mais recentes primeiro
    Ok(list)
}

async fn papermc_versions(project: &str) -> CommandResult<Vec<VersionOption>> {
    let json = get_json(&format!("https://fill.papermc.io/v3/projects/{project}")).await?;
    let map = json["versions"]
        .as_object()
        .ok_or_else(|| crate::error::CommandError::Parse("sem campo versions".into()))?;
    let mut out = Vec::new();
    for (_channel, versions) in map {
        if let Some(arr) = versions.as_array() {
            for v in arr {
                let id = v.as_str().unwrap_or_default().to_string();
                if !id.is_empty() && !id.contains('-') {
                    out.push(opt(&id));
                }
            }
        }
    }
    out.sort_by(|a, b| b.version.cmp(&a.version));
    out.dedup_by(|a, b| a.version == b.version);
    Ok(out)
}

async fn purpur_versions() -> CommandResult<Vec<VersionOption>> {
    let json = get_json("https://api.purpurmc.org/v2/purpur").await?;
    let arr = json["versions"]
        .as_array()
        .ok_or_else(|| crate::error::CommandError::Parse("sem campo versions".into()))?;
    let mut list: Vec<VersionOption> = arr
        .iter()
        .filter_map(|v| v.as_str())
        .filter(|v| !v.contains('-'))
        .map(opt)
        .collect();
    list.reverse();
    Ok(list)
}

async fn fabric_versions() -> CommandResult<Vec<VersionOption>> {
    let json = get_json("https://meta.fabricmc.net/v2/versions/game").await?;
    let arr = json.as_array().ok_or_else(|| crate::error::CommandError::Parse("resposta inesperada".into()))?;
    let mut list: Vec<VersionOption> = arr
        .iter()
        .filter(|v| v["stable"].as_bool() == Some(true))
        .map(|v| opt(v["version"].as_str().unwrap_or_default()))
        .collect();
    list.reverse();
    Ok(list)
}

async fn quilt_versions() -> CommandResult<Vec<VersionOption>> {
    let json = match get_json("https://meta.quiltmc.org/v3/versions/game").await {
        Ok(j) => j,
        Err(_) => get_json("https://meta.quiltmc.org/v2/versions/game").await?,
    };
    let arr = json.as_array().ok_or_else(|| crate::error::CommandError::Parse("resposta inesperada".into()))?;
    let mut list: Vec<VersionOption> = arr
        .iter()
        .filter(|v| v["stable"].as_bool().unwrap_or(true))
        .map(|v| opt(v["version"].as_str().unwrap_or_default()))
        .collect();
    list.reverse();
    Ok(list)
}

fn spigot_versions() -> Vec<VersionOption> {
    // O SpigotMC não publica API de versões do jar de servidor: o único caminho
    // oficial é compilar com o BuildTools, e ele tem uma lista própria de revisões.
    // Esta lista é mantida de acordo com as revisões suportadas pelo BuildTools.
    const VERSIONS: &[&str] = &[
        "1.21.8", "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6",
        "1.20.4", "1.20.2", "1.20.1", "1.20", "1.19.4", "1.19.2", "1.19", "1.18.2", "1.17.1",
        "1.16.5", "1.15.2", "1.14.4", "1.13.2", "1.12.2", "1.11.2", "1.10.2", "1.9.4", "1.9.2",
        "1.9", "1.8.8", "1.7.10",
    ];
    VERSIONS.iter().map(|v| opt_with_note(v, "compilado via BuildTools")).collect()
}

fn bungeecord_versions() -> Vec<VersionOption> {
    const VERSIONS: &[&str] = &[
        "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.19", "1.18.2", "1.17.1", "1.16.5",
        "1.15.2", "1.14.4", "1.13.2", "1.12.2", "1.11.2", "1.10.2", "1.9.4", "1.8.8", "1.7.10",
    ];
    VERSIONS
        .iter()
        .map(|v| opt_with_note(v, "o jar é único: o painel baixa sempre a build mais recente"))
        .collect()
}

async fn bedrock_versions() -> CommandResult<Vec<VersionOption>> {
    let json = get_json("https://net-secondary.web.minecraft-services.net/api/v1.0/download/links").await?;
    let links = json["result"]["links"]
        .as_array()
        .ok_or_else(|| crate::error::CommandError::Parse("sem links".into()))?;
    let mut list = Vec::new();
    for l in links {
        let kind = l["downloadType"].as_str().unwrap_or_default();
        let url = l["downloadUrl"].as_str().unwrap_or_default().to_string();
        if kind == "serverBedrockLinux" || kind == "serverBedrockPreviewLinux" {
            let preview = kind.ends_with("PreviewLinux");
            let version = url
                .rsplit('/')
                .next()
                .and_then(|n| n.strip_prefix("bedrock-server-"))
                .and_then(|n| n.strip_suffix(".zip"))
                .unwrap_or("latest")
                .to_string();
            list.push(VersionOption {
                version: version.clone(),
                stable: !preview,
                note: Some(if preview {
                    "preview (versão de testes)".into()
                } else {
                    "versão estável mais recente".into()
                }),
            });
            BEDROCK_URLS.lock().unwrap().insert(version, url);
        }
    }
    if list.is_empty() {
        return err("não foi possível descobrir a versão do Bedrock");
    }
    Ok(list)
}

async fn pocketmine_versions() -> CommandResult<Vec<VersionOption>> {
    let json = get_json("https://api.github.com/repos/pmmp/PocketMine-MP/releases?per_page=25").await?;
    let arr = json.as_array().ok_or_else(|| crate::error::CommandError::Parse("resposta inesperada".into()))?;
    let mut list = Vec::new();
    for rel in arr {
        if rel["prerelease"].as_bool() == Some(true) {
            continue;
        }
        let tag = rel["tag_name"].as_str().unwrap_or_default().to_string();
        let mut link = None;
        if let Some(assets) = rel["assets"].as_array() {
            for asset in assets {
                let name = asset["name"].as_str().unwrap_or_default();
                if name == "PocketMine-MP.phar" {
                    link = asset["browser_download_url"].as_str().map(|s| s.to_string());
                }
            }
        }
        if let (Some(url), false) = (link, tag.is_empty()) {
            POCKETMINE_URLS.lock().unwrap().insert(tag.clone(), url);
            list.push(VersionOption {
                version: tag,
                stable: true,
                note: Some("precisa do PHP instalado no sistema".into()),
            });
        }
    }
    if list.is_empty() {
        return err("nenhuma release estável encontrada no PocketMine-MP");
    }
    Ok(list)
}

async fn magma_versions() -> CommandResult<Vec<VersionOption>> {
    // O projeto passou a publicar builds fora do GitHub (os repositórios antigos
    // Magma-1-20-x etc. saíram do ar). Tentamos os nomes conhecidos; se nenhum
    // tiver release, a interface mostra "nenhuma versão" em vez de quebrar.
    const REPOS: &[&str] = &[
        "Magma-1-20-x",
        "Magma-1-18-x",
        "Magma-1-16-x",
        "Magma-1-12-2",
        "Magma-Forge",
        "Magma-Neo",
    ];
    let mut out: Vec<VersionOption> = Vec::new();
    for repo in REPOS {
        let url = format!("https://api.github.com/repos/magmafoundation/{repo}/releases?per_page=1");
        let json = match get_json(&url).await {
            Ok(j) => j,
            Err(_) => continue,
        };
        let arr = match json.as_array() {
            Some(a) => a,
            None => continue,
        };
        let latest = match arr.first() {
            Some(l) => l,
            None => continue,
        };
        let name = latest["tag_name"].as_str().unwrap_or_default().to_string();
        let asset = latest["assets"]
            .as_array()
            .and_then(|a| {
                a.iter()
                    .find(|x| x["name"].as_str().unwrap_or_default().ends_with(".jar"))
                    .cloned()
            });
        if let (Some(asset), false) = (asset, name.is_empty()) {
            let url = asset["browser_download_url"].as_str().unwrap_or_default().to_string();
            out.push(VersionOption {
                version: name.clone(),
                stable: true,
                note: Some(format!("{repo} · jar oficial do Magma")),
            });
            MAGMA_URLS.lock().unwrap().insert(name, url);
        }
    }
    Ok(out)
}

lazy_static::lazy_static! {
    static ref MAGMA_URLS: std::sync::Mutex<std::collections::HashMap<String, String>> =
        std::sync::Mutex::new(std::collections::HashMap::new());
    static ref ARCLIGHT_URLS: std::sync::Mutex<std::collections::HashMap<String, String>> =
        std::sync::Mutex::new(std::collections::HashMap::new());
    static ref BEDROCK_URLS: std::sync::Mutex<std::collections::HashMap<String, String>> =
        std::sync::Mutex::new(std::collections::HashMap::new());
    static ref POCKETMINE_URLS: std::sync::Mutex<std::collections::HashMap<String, String>> =
        std::sync::Mutex::new(std::collections::HashMap::new());
}

pub fn magma_url_for(version: &str) -> Option<String> {
    MAGMA_URLS.lock().unwrap().get(version).cloned()
}
pub fn arclight_url_for(mc_version: &str) -> Option<String> {
    ARCLIGHT_URLS.lock().unwrap().get(mc_version).cloned()
}
pub fn bedrock_url_for(version: &str) -> Option<String> {
    BEDROCK_URLS.lock().unwrap().get(version).cloned()
}
pub fn pocketmine_url_for(version: &str) -> Option<String> {
    POCKETMINE_URLS.lock().unwrap().get(version).cloned()
}

/// Extrai "1.21.4" de uma versão de NeoForge ("21.4.10-beta").
fn mc_from_neoforge(version: &str) -> String {
    let parts: Vec<&str> = version.split('.').collect();
    let major: u32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(21);
    let minor: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    if major >= 26 {
        format!("{major}.{minor}")
    } else if minor == 0 {
        format!("1.{major}")
    } else {
        format!("1.{major}.{minor}")
    }
}

async fn neoforge_versions() -> CommandResult<Vec<VersionOption>> {
    let xml = get_text("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml").await?;
    let mut versions = parse_xml_versions(&xml);
    versions.retain(|v| !v.contains("alpha") && !v.contains("snapshot"));
    versions.reverse();
    let list = versions
        .into_iter()
        .map(|v| {
            let mc = mc_from_neoforge(&v);
            opt_with_note(&v, &format!("Minecraft {mc}"))
        })
        .collect();
    Ok(list)
}

async fn forge_versions() -> CommandResult<Vec<VersionOption>> {
    // O metadata do Forge é um mapa {versão-do-minecraft: [versoes-do-forge]}
    let json = match get_json("https://files.minecraftforge.net/maven/net/minecraftforge/forge/maven-metadata.json").await
    {
        Ok(j) => j,
        Err(_) => get_json("https://maven.minecraftforge.net/maven/net/minecraftforge/forge/maven-metadata.json").await?,
    };
    let map = json
        .as_object()
        .ok_or_else(|| crate::error::CommandError::Parse("metadata do Forge inesperado".into()))?;
    let mut out: Vec<VersionOption> = Vec::new();
    for (mc, builds) in map {
        if let Some(arr) = builds.as_array() {
            if let Some(latest) = arr.last().and_then(|v| v.as_str()) {
                if latest.contains("latest") || latest.contains("recommended") {
                    continue;
                }
                out.push(opt_with_note(latest, &format!("Minecraft {mc}")));
            }
        }
    }
    out.reverse();
    Ok(out)
}

async fn arclight_versions() -> CommandResult<Vec<VersionOption>> {
    let json = get_json("https://api.github.com/repos/IzzelAliz/Arclight/releases?per_page=60").await?;
    let arr = json.as_array().ok_or_else(|| crate::error::CommandError::Parse("resposta inesperada".into()))?;
    let mut seen = std::collections::HashSet::new();
    let mut list = Vec::new();
    for rel in arr {
        let assets = match rel["assets"].as_array() {
            Some(a) => a,
            None => continue,
        };
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or_default().to_string();
            // formato: arclight-forge-1.21.1-1.0.1-8ec9529.jar
            if !name.ends_with(".jar") {
                continue;
            }
            if !(name.contains("forge") || name.contains("neoforge")) {
                continue; // ignora a variante fabric (o usuário pediu ArchLight/Forge)
            }
            if let Some(mc) = name.split('-').nth(2) {
                if mc.starts_with("1.") && seen.insert(mc.to_string()) {
                    let url = asset["browser_download_url"].as_str().unwrap_or_default().to_string();
                    ARCLIGHT_URLS.lock().unwrap().insert(mc.to_string(), url);
                    list.push(opt(mc));
                }
            }
        }
    }
    if list.is_empty() {
        return err("nenhum jar do Arclight encontrado nas releases");
    }
    Ok(list)
}

async fn mohist_versions() -> CommandResult<Vec<VersionOption>> {
    // O canal público de builds do Mohist está fora do ar; as versões ainda são
    // publicadas nesta API, então a lista aparece e a instalação avisa o usuário.
    let json = get_json("https://mohistmc.com/api/v2/projects/mohist").await?;
    let arr = json["versions"]
        .as_array()
        .ok_or_else(|| crate::error::CommandError::Parse("sem versions".into()))?;
    let list = arr
        .iter()
        .filter_map(|v| v.as_str())
        .map(opt)
        .collect();
    Ok(list)
}

fn parse_xml_versions(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<version>") {
        let after = &rest[start + 9..];
        if let Some(end) = after.find("</version>") {
            let v = &after[..end];
            if !v.contains("maven") {
                out.push(v.trim().to_string());
            }
            rest = &after[end + 10..];
        } else {
            break;
        }
    }
    out
}

// --------------------------------------------------------------- plano de instalação

/// Descobre como baixar/instalar um software específico numa versão.
pub async fn install_plan(software: &str, version: &str) -> CommandResult<InstallPlan> {
    match software {
        "vanilla" => {
            let json = get_json("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json").await?;
            let arr = json["versions"].as_array().ok_or_else(|| crate::error::CommandError::Parse("sem versions".into()))?;
            let meta_url = arr
                .iter()
                .find(|v| v["id"].as_str() == Some(version))
                .and_then(|v| v["url"].as_str())
                .ok_or_else(|| crate::error::CommandError::Other(format!("versão não encontrada: {version}")))?
                .to_string();
            let meta = get_json(&meta_url).await?;
            let server = meta["downloads"]["server"]["url"]
                .as_str()
                .ok_or_else(|| crate::error::CommandError::Other("sem jar de servidor nesta versão".into()))?
                .to_string();
            Ok(InstallPlan { kind: InstallKind::Jar { url: server }, note: "servidor oficial Mojang".into() })
        }
        "paper" | "velocity" => {
            let builds = get_json(&format!(
                "https://fill.papermc.io/v3/projects/{software}/versions/{version}/builds"
            ))
            .await?;
            let arr = builds
                .as_array()
                .ok_or_else(|| crate::error::CommandError::Parse("sem builds".into()))?;
            let build = arr
                .iter()
                .find(|b| b["channel"].as_str() == Some("STABLE"))
                .or_else(|| arr.first())
                .ok_or_else(|| crate::error::CommandError::Other("nenhum build disponível".into()))?;
            let download = build["downloads"]["server:default"]
                .as_object()
                .ok_or_else(|| crate::error::CommandError::Other("build sem jar de servidor".into()))?;
            let url = download
                .get("url")
                .and_then(|u| u.as_str())
                .ok_or_else(|| crate::error::CommandError::Other("build sem URL".into()))?
                .to_string();
            let id = build["id"].as_i64().unwrap_or_default();
            Ok(InstallPlan {
                kind: InstallKind::Jar { url },
                note: format!("build #{id}"),
            })
        }
        "purpur" => Ok(InstallPlan {
            kind: InstallKind::Jar {
                url: format!("https://api.purpurmc.org/v2/purpur/{version}/latest/download"),
            },
            note: "build mais recente do Purpur".into(),
        }),
        "fabric" => {
            let installer = fabric_installer_url().await?;
            Ok(InstallPlan {
                kind: InstallKind::ModLoader {
                    installer_url: installer,
                    loader: "fabric".into(),
                    minecraft: version.to_string(),
                },
                note: "instala o Fabric e baixa o Minecraft".into(),
            })
        }
        "quilt" => {
            let xml = get_text("https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml").await?;
            let mut versions = parse_xml_versions(&xml);
            versions.retain(|v| !v.contains("alpha"));
            let latest = versions.last().cloned().unwrap_or_else(|| "0.9.0".to_string());
            Ok(InstallPlan {
                kind: InstallKind::ModLoader {
                    installer_url: format!(
                        "https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/{latest}/quilt-installer-{latest}.jar"
                    ),
                    loader: "quilt".into(),
                    minecraft: version.to_string(),
                },
                note: "instala o Quilt e baixa o Minecraft".into(),
            })
        }
        "spigot" => Ok(InstallPlan {
            kind: InstallKind::BuildTools { version: version.to_string() },
            note: "a compilação leva de 5 a 15 minutos".into(),
        }),
        "bungeecord" => Ok(InstallPlan {
            kind: InstallKind::Jar {
                url: "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar".into(),
            },
            note: "build mais recente do BungeeCord".into(),
        }),
        "bedrock" => {
            let versions = bedrock_versions().await?;
            if !versions.iter().any(|v| v.version == version) {
                return Err(crate::error::CommandError::Other("versão Bedrock não encontrada".into()));
            }
            let url = bedrock_url_for(version).ok_or_else(|| {
                crate::error::CommandError::Other("link do Bedrock não encontrado".into())
            })?;
            Ok(InstallPlan {
                kind: InstallKind::Extract { url, extract_to: ".".into() },
                note: "servidor oficial Bedrock".into(),
            })
        }
        "pocketmine" => {
            let url = pocketmine_url_for(version)
                .ok_or_else(|| crate::error::CommandError::Other("build do PocketMine não encontrada".into()))?;
            Ok(InstallPlan {
                kind: InstallKind::Extract {
                    url,
                    extract_to: ".".into(),
                },
                note: "requer o PHP instalado no sistema (sudo apt install php-cli)".into(),
            })
        }
        "magma" => {
            let url = magma_url_for(version)
                .ok_or_else(|| crate::error::CommandError::Other("jar do Magma não encontrado (lista as versões primeiro)".into()))?;
            Ok(InstallPlan {
                kind: InstallKind::Jar { url },
                note: format!("jar oficial do Magma {version}"),
            })
        }
        "archlight" => {
            let url = arclight_url_for(version)
                .ok_or_else(|| crate::error::CommandError::Other("jar do ArchLight não encontrado (liste as versões primeiro)".into()))?;
            Ok(InstallPlan {
                kind: InstallKind::Jar { url },
                note: format!("ArchLight (Arclight) para Minecraft {version}"),
            })
        }
        "neoforge" => {
            let url = format!(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar"
            );
            Ok(InstallPlan {
                kind: InstallKind::ForgeInstaller { url },
                note: format!("NeoForge {} para Minecraft {}", version, mc_from_neoforge(version)),
            })
        }
        "forge" => {
            let url = format!(
                "https://maven.minecraftforge.net/maven/net/minecraftforge/forge/{version}/forge-{version}-installer.jar"
            );
            Ok(InstallPlan {
                kind: InstallKind::ForgeInstaller { url },
                note: format!("Forge {}", version),
            })
        }
        "mohist" => Ok(InstallPlan {
            kind: InstallKind::Unavailable {
                reason: "O canal público de builds do Mohist está fora do ar no momento. Use Paper, Purpur ou Magma, que entregam a mesma mistura de plugins e mods.".into(),
            },
            note: "download indisponível".into(),
        }),
        "modpack" => Err(crate::error::CommandError::Other(
            "modpacks são instalados pela aba Modpacks".into(),
        )),
        other => Err(crate::error::CommandError::Other(format!("software desconhecido: {other}"))),
    }
}

/// URL do instalador do Fabric mais recente.
async fn fabric_installer_url() -> CommandResult<String> {
    let xml = get_text("https://maven.fabricmc.net/net/fabricmc/fabric-installer/maven-metadata.xml").await?;
    let mut versions = parse_xml_versions(&xml);
    if versions.is_empty() {
        return err("nenhuma versão do instalador do Fabric encontrada");
    }
    let latest = versions.pop().unwrap();
    Ok(format!(
        "https://maven.fabricmc.net/net/fabricmc/fabric-installer/{latest}/fabric-installer-{latest}.jar"
    ))
}

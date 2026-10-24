//! Busca e instalação de conteúdo: plugins, mods e datapacks.
//!
//! Provedores suportados:
//! - Modrinth (funciona sem cadastro; é o padrão)
//! - Hangar (plugins Paper)
//! - Spiget (plugins do SpigotMC)
//! - CurseForge (precisa de chave de API, que o usuário cola no app)
//!
//! A busca já é filtrada pelo loader do software e pela versão do Minecraft, então
//! um servidor Fabric nunca aparece um mod de Forge.
use std::collections::HashMap;
use std::fs;

use tauri::State;

use crate::error::{err, CommandResult};
use crate::java_mgr;
use crate::model::ServerEntry;
use crate::state::AppState;
use crate::util;

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentItem {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub versions: Vec<String>,
    /// nome do arquivo já instalado no servidor, quando for o caso
    pub installed: Option<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    pub items: Vec<ContentItem>,
    pub total: u64,
    pub provider: String,
}

#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchInput {
    pub server_id: String,
    pub kind: String, // plugins | mods | datapacks
    pub provider: String,
    pub query: String,
    pub page: u32,
    pub limit: u32,
    pub curse_forge_key: Option<String>,
}

#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentInstallInput {
    pub server_id: String,
    pub kind: String,
    pub provider: String,
    pub project_id: String,
    pub version: Option<String>,
    pub curse_forge_key: Option<String>,
}

/// Cliente HTTP simples com timeout.
fn client() -> CommandResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("DSM-Minecraft-Panel/0.1")
        .build()
        .map_err(Into::into)
}

async fn get_json(url: &str, key: Option<&str>) -> CommandResult<serde_json::Value> {
    let mut request = client()?.get(url);
    if let Some(key) = key {
        request = request.header("x-api-key", key);
    }
    let res = request.send().await?;
    if !res.status().is_success() {
        return err(format!("GET {url} -> HTTP {}", res.status().as_u16()));
    }
    Ok(res.json().await?)
}

/// Pasta onde o conteúdo é instalado.
fn content_folder(entry: &ServerEntry, kind: &str) -> CommandResult<String> {
    let dir = util::server_dir(&entry.id);
    match kind {
        "plugins" => Ok("plugins".into()),
        "mods" => Ok("mods".into()),
        "datapacks" => {
            // datapacks vão na pasta datapacks do mundo ativo
            let world = active_world(&dir);
            Ok(format!("{world}/datapacks"))
        }
        other => err(format!("tipo de conteúdo desconhecido: {other}")),
    }
}

/// Descobre o mundo ativo lendo level-name do server.properties.
pub fn active_world(dir: &std::path::Path) -> String {
    let props = dir.join("server.properties");
    if let Ok(raw) = fs::read_to_string(&props) {
        for line in raw.lines() {
            if let Some(rest) = line.trim().strip_prefix("level-name=") {
                let name = rest.trim();
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
    }
    "world".to_string()
}

/// Categorias (loaders) do Modrinth equivalentes ao software do servidor.
fn modrinth_loaders(entry: &ServerEntry, kind: &str) -> Vec<String> {
    if kind == "plugins" {
        return match entry.software.as_str() {
            "paper" | "purpur" => vec!["paper", "bukkit", "spigot"],
            "spigot" => vec!["spigot", "bukkit"],
            "mohist" | "magma" => vec!["bukkit"],
            "pocketmine" => vec![],
            _ => vec!["bukkit", "paper", "spigot"],
        }
        .into_iter()
        .map(String::from)
        .collect();
    }
    match entry.software.as_str() {
        "fabric" => vec!["fabric"],
        "quilt" => vec!["fabric", "quilt"],
        "forge" => vec!["forge"],
        "neoforge" => vec!["neoforge"],
        "archlight" => vec!["forge", "neoforge"],
        "magma" | "mohist" => vec!["forge"],
        _ => vec!["fabric", "forge", "neoforge", "quilt"],
    }
    .into_iter()
    .map(String::from)
    .collect()
}

/// Projeto_type do Modrinth por tipo de conteúdo.
fn project_type(kind: &str) -> &'static str {
    match kind {
        "plugins" => "plugin",
        "mods" => "mod",
        _ => "datapack",
    }
}

/// Arquivos já instalados, para marcar "Já instalado".
async fn installed_files(entry: &ServerEntry, kind: &str) -> CommandResult<HashMap<String, String>> {
    let folder = content_folder(entry, kind)?;
    let dir = util::server_dir(&entry.id).join(&folder);
    let mut map = HashMap::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".jar") && !name.ends_with(".zip") {
                continue;
            }
            // normaliza: remove versão e extensão para comparar por nome
            let stem = name
                .rsplit_once('-')
                .map(|(a, _)| a)
                .unwrap_or(&name)
                .to_lowercase()
                .replace(['_', '.'], "");
            map.insert(stem, name);
        }
    }
    Ok(map)
}

fn find_installed(installed: &HashMap<String, String>, slug: &str, title: &str) -> Option<String> {
    let normalize = |s: &str| s.to_lowercase().replace(['_', ' ', '-', '.'], "");
    let key = normalize(slug);
    for (stem, file) in installed {
        if stem == &key || stem.contains(&key) || key.contains(stem.as_str()) {
            return Some(file.clone());
        }
    }
    let title_key = normalize(title);
    for (stem, file) in installed {
        if stem.contains(&title_key) {
            return Some(file.clone());
        }
    }
    None
}

#[tauri::command]
pub async fn search_content(
    input: ContentSearchInput,
    state: State<'_, AppState>,
) -> CommandResult<ContentSearchResult> {
    let entry = state.find(&input.server_id)?;
    let installed = installed_files(&entry, &input.kind).await?;
    let result = match input.provider.as_str() {
        "modrinth" => search_modrinth(&entry, &input).await?,
        "hangar" => search_hangar(&entry, &input).await?,
        "spiget" => search_spiget(&entry, &input).await?,
        "curseforge" => search_curseforge(&entry, &input).await?,
        other => return err(format!("provedor não suportado: {other}")),
    };
    let items = result
        .0
        .into_iter()
        .map(|mut item| {
            item.installed = find_installed(&installed, &item.slug, &item.title);
            item
        })
        .collect();
    Ok(ContentSearchResult {
        items,
        total: result.1,
        provider: input.provider,
    })
}

// ------------------------------------------------------------------ Modrinth

fn modrinth_facets(entry: &ServerEntry, kind: &str) -> String {
    let project = project_type(kind);
    let mut facets = vec![format!("[\"project_type:{project}\"]")];
    let loaders = modrinth_loaders(entry, kind);
    if !loaders.is_empty() {
        let inner = loaders
            .iter()
            .map(|l| format!("\"categories:{l}\""))
            .collect::<Vec<_>>()
            .join(",");
        facets.push(format!("[{inner}]"));
    }
    if !entry.version.is_empty() {
        facets.push(format!("[\"versions:{}\"]", entry.version));
    }
    format!("[{}]", facets.join(","))
}

async fn search_modrinth(
    entry: &ServerEntry,
    input: &ContentSearchInput,
) -> CommandResult<(Vec<ContentItem>, u64)> {
    let facets = modrinth_facets(entry, &input.kind);
    let query = if input.query.trim().is_empty() {
        String::new()
    } else {
        format!("&query={}", urlencoding(&input.query))
    };
    let url = format!(
        "https://api.modrinth.com/v2/search?facets={}&limit={}&offset={}&index=downloads{}",
        urlencoding(&facets),
        input.limit,
        input.page * input.limit,
        query
    );
    let json = get_json(&url, None).await?;
    let hits = json["hits"].as_array().cloned().unwrap_or_default();
    let total = json["total_hits"].as_u64().unwrap_or(0);
    let items = hits
        .into_iter()
        .map(|hit| ContentItem {
            id: hit["project_id"].as_str().unwrap_or_default().to_string(),
            slug: hit["slug"].as_str().unwrap_or_default().to_string(),
            title: hit["title"].as_str().unwrap_or_default().to_string(),
            description: hit["description"].as_str().unwrap_or_default().to_string(),
            author: hit["author"].as_str().unwrap_or("?").to_string(),
            downloads: hit["downloads"].as_u64().unwrap_or(0),
            icon_url: hit["icon_url"].as_str().map(String::from),
            versions: hit["versions"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            installed: None,
        })
        .collect();
    Ok((items, total))
}

// -------------------------------------------------------------------- Hangar

async fn search_hangar(
    entry: &ServerEntry,
    input: &ContentSearchInput,
) -> CommandResult<(Vec<ContentItem>, u64)> {
    if input.kind != "plugins" {
        return err("o Hangar só tem plugins");
    }
    let platform = match entry.software.as_str() {
        "paper" | "purpur" => "PAPER",
        "spigot" => "SPIGOT",
        _ => "PAPER",
    };
    let query = if input.query.trim().is_empty() {
        String::new()
    } else {
        format!("&q={}", urlencoding(&input.query))
    };
    let url = format!(
        "https://hangar.papermc.io/api/v1/projects?limit={}&offset={}&platform={}&sort=-downloads{}",
        input.limit,
        input.page * input.limit,
        platform,
        query
    );
    let json = get_json(&url, None).await?;
    let projects = json["result"]
        .as_object()
        .and_then(|r| r.values().find(|v| v.is_array()))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let total = projects.len() as u64;
    let items = projects
        .into_iter()
        .map(|p| {
            let namespace = &p["namespace"];
            let slug = namespace["slug"].as_str().unwrap_or_default().to_string();
            ContentItem {
                id: format!(
                    "{}/{}",
                    namespace["owner"].as_str().unwrap_or_default(),
                    slug
                ),
                slug,
                title: p["name"].as_str().unwrap_or_default().to_string(),
                description: p["description"].as_str().unwrap_or_default().to_string(),
                author: namespace["owner"].as_str().unwrap_or("?").to_string(),
                downloads: p["stats"]["downloads"].as_u64().unwrap_or(0),
                icon_url: p["avatarUrl"].as_str().map(String::from),
                versions: vec![],
                installed: None,
            }
        })
        .collect();
    Ok((items, total))
}

// -------------------------------------------------------------------- Spiget

async fn search_spiget(
    _entry: &ServerEntry,
    input: &ContentSearchInput,
) -> CommandResult<(Vec<ContentItem>, u64)> {
    if input.kind != "plugins" {
        return err("o Spiget só tem plugins");
    }
    let query = if input.query.trim().is_empty() {
        String::new()
    } else {
        format!("/{}", urlencoding(&input.query))
    };
    let url = format!(
        "https://api.spiget.org/v2/search/resources{}?size={}&page={}",
        query,
        input.limit,
        input.page + 1
    );
    let json = get_json(&url, None).await?;
    let arr = json.as_array().cloned().unwrap_or_default();
    let total = arr.len() as u64;
    let items = arr
        .into_iter()
        .map(|p| ContentItem {
            id: p["id"].as_i64().unwrap_or_default().to_string(),
            slug: p["id"].as_i64().unwrap_or_default().to_string(),
            title: p["name"].as_str().unwrap_or_default().to_string(),
            description: p["tag"].as_str().unwrap_or_default().to_string(),
            author: "SpigotMC".into(),
            downloads: p["downloads"].as_u64().unwrap_or(0),
            icon_url: None,
            versions: vec![],
            installed: None,
        })
        .collect();
    Ok((items, total))
}

// ---------------------------------------------------------------- CurseForge

async fn search_curseforge(
    entry: &ServerEntry,
    input: &ContentSearchInput,
) -> CommandResult<(Vec<ContentItem>, u64)> {
    let key = input
        .curse_forge_key
        .clone()
        .ok_or_else(|| crate::error::CommandError::Other(
            "cole a chave da API do CurseForge no botão ⚙ API (console.curseforge.com)".into(),
        ))?;
    let class_id = match input.kind.as_str() {
        "plugins" => 5,          // Bukkit plugins
        "mods" => 6,             // Mods
        "datapacks" => 6945,     // Data Packs
        _ => 6,
    };
    let loader = match entry.software.as_str() {
        "fabric" => Some("Fabric"),
        "quilt" => Some("Fabric"),
        "forge" => Some("Forge"),
        "neoforge" => Some("NeoForge"),
        "paper" | "purpur" | "spigot" => Some("Paper"),
        _ => None,
    };
    let mut url = format!(
        "https://api.curseforge.com/v1/mods/search?gameId=432&classId={class_id}&pageSize={}&index={}&sortField=2&sortOrder=desc",
        input.limit,
        input.page * input.limit
    );
    if !input.query.trim().is_empty() {
        url.push_str(&format!("&searchText={}", urlencoding(&input.query)));
    }
    if let Some(loader) = loader {
        url.push_str(&format!("&modLoaderType={loader}"));
    }
    let json = get_json(&url, Some(&key)).await?;
    let data = json["data"].as_array().cloned().unwrap_or_default();
    let total = json["pagination"]["totalCount"].as_u64().unwrap_or(0);
    let items = data
        .into_iter()
        .map(|m| ContentItem {
            id: m["id"].as_i64().unwrap_or_default().to_string(),
            slug: m["slug"].as_str().unwrap_or_default().to_string(),
            title: m["name"].as_str().unwrap_or_default().to_string(),
            description: m["summary"].as_str().unwrap_or_default().to_string(),
            author: m["authors"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|a| a["name"].as_str())
                .unwrap_or("?")
                .to_string(),
            downloads: m["downloadCount"].as_u64().unwrap_or(0),
            icon_url: m["logo"]["url"].as_str().map(String::from),
            versions: vec![],
            installed: None,
        })
        .collect();
    Ok((items, total))
}

// ------------------------------------------------------------------ instalação

#[tauri::command]
pub async fn install_content(
    input: ContentInstallInput,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CommandResult<String> {
    let entry = state.find(&input.server_id)?;
    let folder = content_folder(&entry, &input.kind)?;
    let dir = util::server_dir(&entry.id).join(&folder);
    fs::create_dir_all(&dir)?;

    let url = match input.provider.as_str() {
        "modrinth" => modrinth_file_url(&entry, &input).await?,
        "hangar" => hangar_file_url(&entry, &input).await?,
        "spiget" => format!("https://api.spiget.org/v2/resources/{}/download", input.project_id),
        "curseforge" => {
            let key = input.curse_forge_key.clone().ok_or_else(|| {
                crate::error::CommandError::Other("chave da API do CurseForge necessária".into())
            })?;
            curseforge_file_url(&input, &key).await?
        }
        other => return err(format!("provedor não suportado: {other}")),
    };

    let file_name = url
        .rsplit('/')
        .next()
        .unwrap_or("arquivo.jar")
        .split('?')
        .next()
        .unwrap_or("arquivo.jar")
        .to_string();
    let target = dir.join(&file_name);
    java_mgr::download(&url, &target, &entry.id, "install", Some(&app)).await?;
    Ok(file_name)
}

/// Escolhe o arquivo do Modrinth compatível com a versão/loader do servidor.
async fn modrinth_file_url(entry: &ServerEntry, input: &ContentInstallInput) -> CommandResult<String> {
    let versions = get_json(
        &format!("https://api.modrinth.com/v2/project/{}/version", input.project_id),
        None,
    )
    .await?;
    let loaders = modrinth_loaders(entry, &input.kind);
    let arr = versions.as_array().ok_or_else(|| crate::error::CommandError::Parse("sem versões".into()))?;
    for version in arr {
        // respeita uma versão específica pedida pelo usuário
        if let Some(want) = &input.version {
            if version["version_number"].as_str() != Some(want.as_str()) {
                continue;
            }
        }
        let game_versions = version["game_versions"].as_array().cloned().unwrap_or_default();
        let has_game = game_versions
            .iter()
            .any(|v| v.as_str() == Some(entry.version.as_str()));
        if !entry.version.is_empty() && !has_game && input.kind != "plugins" {
            continue;
        }
        let version_loaders = version["loaders"].as_array().cloned().unwrap_or_default();
        let loader_ok = if loaders.is_empty() {
            true
        } else {
            version_loaders
                .iter()
                .any(|l| loaders.iter().any(|w| w == l.as_str().unwrap_or("")))
        };
        if !loader_ok {
            continue;
        }
        if let Some(file) = version["files"].as_array().and_then(|f| f.first()) {
            if let Some(url) = file["url"].as_str() {
                return Ok(url.to_string());
            }
        }
    }
    err("nenhuma versão desse projeto é compatível com o seu servidor")
}

async fn hangar_file_url(entry: &ServerEntry, input: &ContentInstallInput) -> CommandResult<String> {
    let parts: Vec<&str> = input.project_id.split('/').collect();
    if parts.len() != 2 {
        return err("projeto do Hangar inválido");
    }
    let platform = match entry.software.as_str() {
        "spigot" => "SPIGOT",
        _ => "PAPER",
    };
    let url = format!(
        "https://hangar.papermc.io/api/v1/projects/{}/{}/versions?platform={}&limit=1",
        parts[0], parts[1], platform
    );
    let json = get_json(&url, None).await?;
    let version = json["result"]
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| crate::error::CommandError::Other("sem versões no Hangar".into()))?;
    let name = version["name"].as_str().unwrap_or_default();
    Ok(format!(
        "https://hangar.papermc.io/api/v1/projects/{}/{}/versions/{}/{}",
        parts[0], parts[1], name, platform
    ))
}

async fn curseforge_file_url(input: &ContentInstallInput, key: &str) -> CommandResult<String> {
    let mod_id = input.project_id.clone();
    let json = get_json(
        &format!("https://api.curseforge.com/v1/mods/{mod_id}/files?pageSize=5"),
        Some(key),
    )
    .await?;
    let file = json["data"]
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| crate::error::CommandError::Other("sem arquivos no CurseForge".into()))?;
    let id = file["id"].as_i64().unwrap_or_default();
    let url = format!("https://api.curseforge.com/v1/mods/{mod_id}/files/{id}/download-url");
    let json = get_json(&url, Some(key)).await?;
    json["data"].as_str().map(String::from).ok_or_else(|| {
        crate::error::CommandError::Other("o CurseForge não devolveu o link do arquivo".into())
    })
}

/// Lista os arquivos instalados (usado pela interface para marcar "Já instalado").
#[tauri::command]
pub fn installed_content(
    server_id: String,
    kind: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<String>> {
    let entry = state.find(&server_id)?;
    let folder = content_folder(&entry, &kind)?;
    let dir = util::server_dir(&server_id).join(folder);
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".jar") || name.ends_with(".zip") {
                out.push(name);
            }
        }
    }
    Ok(out)
}

fn urlencoding(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

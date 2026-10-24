//! Download e cache dos JREs portáteis (Adoptium Temurin).
//!
//! O app baixa um JRE por major version dentro de ~/.dsm/java, para o usuário não
//! precisar instalar nada no sistema e para versões antigas do Minecraft rodarem
//! no Java correto (1.7.10 precisa de Java 8, 1.17 de Java 16, etc.).
use tauri::Emitter;
use std::fs;
use std::path::PathBuf;

use crate::error::{err, CommandResult};
use crate::model::ProgressEvent;
use crate::util;

fn arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86" => "x86",
        _ => "x64",
    }
}

/// Diretório do JRE de uma major version específica.
pub fn jre_dir(major: u32) -> PathBuf {
    util::java_dir().join(format!("jdk-{major}"))
}

/// Caminho absoluto do binário java de uma major version, se já estiver baixado.
pub fn java_binary(major: u32) -> Option<PathBuf> {
    let base = jre_dir(major);
    let direct = base.join("bin/java");
    if direct.exists() {
        return Some(direct);
    }
    // o Temurin extrai para jdk-<major>-<ver>/
    if let Ok(entries) = fs::read_dir(util::java_dir()) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() && p.file_name().map(|n| n.to_string_lossy().contains(&format!("jdk-{major}"))).unwrap_or(false) {
                let candidate = p.join("bin/java");
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// Java do sistema (fallback quando não queremos baixar nada).
pub fn system_java() -> Option<PathBuf> {
    for candidate in ["/usr/bin/java", "/usr/local/bin/java"] {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return Some(p);
        }
    }
    which("java")
}

pub fn which(bin: &str) -> Option<PathBuf> {
    let paths = std::env::var("PATH").ok()?;
    for dir in paths.split(':') {
        let p = PathBuf::from(dir).join(bin);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Garante que existe um Java para a major version pedida, baixando se preciso.
pub async fn ensure_java(
    major: u32,
    server_id: &str,
    app: Option<&tauri::AppHandle>,
) -> CommandResult<PathBuf> {
    if let Some(existing) = java_binary(major) {
        return Ok(existing);
    }
    fs::create_dir_all(util::java_dir())?;

    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{major}/ga/linux/{}/jre/hotspot/normal/eclipse",
        arch()
    );
    emit(app, ProgressEvent {
        server_id: server_id.to_string(),
        stage: "java".into(),
        message: format!("Baixando Java {major} (Temurin JRE)..."),
        percent: None,
    });

    // baixa para um arquivo temporário (o endpoint redireciona para o CDN)
    let tmp = util::java_dir().join(format!("jre-{major}.tar.gz"));
    download(&url, &tmp, server_id, "java", app).await?;

    emit(app, ProgressEvent {
        server_id: server_id.to_string(),
        stage: "java".into(),
        message: "Extraindo o Java...".into(),
        percent: Some(0.9),
    });

    // extrai em ~/.dsm/java/
    let file = fs::File::open(&tmp)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(util::java_dir())?;
    let _ = fs::remove_file(&tmp);

    java_binary(major).ok_or_else(|| {
        crate::error::CommandError::Other(format!(
            "o Java {major} foi baixado mas o binário não foi encontrado em {}",
            jre_dir(major).display()
        ))
    })
}

/// Download com progresso, seguindo redirects.
pub async fn download(
    url: &str,
    dest: &PathBuf,
    server_id: &str,
    stage: &str,
    app: Option<&tauri::AppHandle>,
) -> CommandResult<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .user_agent("DSM-Minecraft-Panel/0.1")
        .build()?;
    let res = client.get(url).send().await?;
    if !res.status().is_success() {
        return err(format!("GET {url} -> HTTP {}", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(0);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::File::create(dest)?;
    let mut stream = res.bytes_stream();
    let mut done: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        use std::io::Write;
        file.write_all(&chunk)?;
        done += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 120 {
            last_emit = std::time::Instant::now();
            let percent = if total > 0 { Some(done as f64 / total as f64) } else { None };
            emit(app, ProgressEvent {
                server_id: server_id.to_string(),
                stage: stage.into(),
                message: format!(
                    "{} — {} / {}",
                    url.rsplit('/').next().unwrap_or("arquivo"),
                    util::human_bytes(done),
                    if total > 0 { util::human_bytes(total) } else { "?".into() }
                ),
                percent,
            });
        }
    }
    Ok(())
}

/// Emite um evento de progresso para o frontend.
pub fn emit(app: Option<&tauri::AppHandle>, event: ProgressEvent) {
    if let Some(app) = app {
        let _ = app.emit("dsm://progress", event);
    }
}

/// Versões principais de Java disponíveis para escolha manual na aba Inicialização.
pub fn available_majors() -> Vec<u32> {
    vec![8, 11, 16, 17, 21, 25]
}

//! Criação e instalação de um servidor: baixa o jar, roda instaladores,
//! escreve server.properties/eula e aplica o ícone.
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::catalog::{self, InstallKind};
use crate::error::{err, CommandResult};
use crate::java_mgr;
use crate::model::{ProgressEvent, ServerEntry};
use crate::software::java_major_for;
use crate::util;

pub struct InstallOutcome {
    pub jar: String,
    pub java_major: u32,
    pub extra_note: String,
}

/// Instala o software de um servidor já registrado.
pub async fn install_server(
    entry: &ServerEntry,
    app: Option<&tauri::AppHandle>,
) -> CommandResult<InstallOutcome> {
    let dir = util::server_dir(&entry.id);
    fs::create_dir_all(&dir)?;

    let plan = catalog::install_plan(&entry.software, &entry.version).await?;
    java_mgr::emit(app, ProgressEvent {
        server_id: entry.id.clone(),
        stage: "plan".into(),
        message: format!("Preparando {} {} — {}", entry.software, entry.version, plan.note),
        percent: Some(0.02),
    });

    match plan.kind {
        InstallKind::Jar { url } => {
            let jar = dir.join(&entry.jar);
            java_mgr::download(&url, &jar, &entry.id, "download", app).await?;
            finish(entry, &dir, app, InstallOutcome {
                jar: entry.jar.clone(),
                java_major: entry.java_major,
                extra_note: String::new(),
            })
            .await
        }
        InstallKind::ForgeInstaller { url } => {
            let installer = dir.join("installer.jar");
            java_mgr::download(&url, &installer, &entry.id, "download", app).await?;
            java_mgr::emit(app, ProgressEvent {
                server_id: entry.id.clone(),
                stage: "install".into(),
                message: "Rodando o instalador do Forge/NeoForge...".into(),
                percent: Some(0.75),
            });
            let java = java_mgr::ensure_java(entry.java_major, &entry.id, app).await?;
            let output = Command::new(&java)
                .arg("-jar")
                .arg("installer.jar")
                .arg("--installServer")
                .current_dir(&dir)
                .output()?;
            if !output.status.success() {
                let log = String::from_utf8_lossy(&output.stderr).to_string();
                let _ = fs::remove_file(&installer);
                return Err(crate::error::CommandError::Other(format!(
                    "falha ao instalar o Forge/NeoForge:\n{}",
                    log.lines().take(20).collect::<Vec<_>>().join("\n")
                )));
            }
            let _ = fs::remove_file(&installer);
            let log_file = dir.join("installer.jar.log");
            let _ = fs::remove_file(log_file);
            finish(entry, &dir, app, InstallOutcome {
                jar: String::new(), // Forge usa unix_args.txt
                java_major: entry.java_major,
                extra_note: "Forge/NeoForge instalado via instalador oficial".into(),
            })
            .await
        }
        InstallKind::ModLoader {
            installer_url,
            loader,
            minecraft,
        } => {
            let installer = dir.join(format!("{loader}-installer.jar"));
            java_mgr::download(&installer_url, &installer, &entry.id, "download", app).await?;
            java_mgr::emit(app, ProgressEvent {
                server_id: entry.id.clone(),
                stage: "install".into(),
                message: format!("Instalando o {loader} para Minecraft {minecraft}..."),
                percent: Some(0.7),
            });
            let java = java_mgr::ensure_java(entry.java_major, &entry.id, app).await?;
            let output = Command::new(&java)
                .arg("-jar")
                .arg(&installer)
                .arg("server")
                .arg("-mcversion")
                .arg(&minecraft)
                .arg("-downloadMinecraft")
                .current_dir(&dir)
                .output()?;
            if !output.status.success() {
                let log = String::from_utf8_lossy(&output.stderr).to_string();
                return Err(crate::error::CommandError::Other(format!(
                    "falha ao instalar o {loader}:\n{}",
                    log.lines().take(20).collect::<Vec<_>>().join("\n")
                )));
            }
            let _ = fs::remove_file(&installer);
            let jar = dir.join(&entry.jar);
            if !jar.exists() {
                // o loader gera fabric-server-launch.jar / quilt-server-launch.jar
                for candidate in ["fabric-server-launch.jar", "quilt-server-launch.jar"] {
                    if dir.join(candidate).exists() {
                        let _ = fs::rename(dir.join(candidate), &jar);
                        break;
                    }
                }
            }
            finish(entry, &dir, app, InstallOutcome {
                jar: entry.jar.clone(),
                java_major: entry.java_major,
                extra_note: format!("{loader} instalado para Minecraft {minecraft}"),
            })
            .await
        }
        InstallKind::BuildTools { version } => {
            let bt = dir.join("BuildTools.jar");
            java_mgr::download(
                "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar",
                &bt,
                &entry.id,
                "download",
                app,
            )
            .await?;
            java_mgr::emit(app, ProgressEvent {
                server_id: entry.id.clone(),
                stage: "build".into(),
                message: "Compilando o Spigot (BuildTools) — isso leva de 5 a 15 minutos...".into(),
                percent: None,
            });
            let java = java_mgr::ensure_java(entry.java_major, &entry.id, app).await?;
            // BuildTools precisa de um diretório de trabalho vazio para gerar a saída
            let work = dir.join("buildtools-work");
            fs::create_dir_all(&work)?;
            let mut child = Command::new(&java)
                .arg("-jar")
                .arg(&bt)
                .arg("--rev")
                .arg(&version)
                .arg("--outputdir")
                .arg(&work)
                .current_dir(&work)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()?;
            java_mgr::emit(app, ProgressEvent {
                server_id: entry.id.clone(),
                stage: "build".into(),
                message: "BuildTools rodando...".into(),
                percent: Some(0.1),
            });
            let status = child.wait()?;
            if !status.success() {
                return err("o BuildTools falhou. Veja o log em buildtools-work/BuildTools.log.txt");
            }
            // procura o spigot-*.jar gerado
            let mut found: Option<PathBuf> = None;
            if let Ok(entries) = fs::read_dir(&work) {
                for e in entries.flatten() {
                    let p = e.path();
                    if let Some(name) = p.file_name().map(|n| n.to_string_lossy().to_string()) {
                        if name.starts_with("spigot-") && name.ends_with(".jar") {
                            found = Some(p);
                        }
                    }
                }
            }
            let jar = dir.join(&entry.jar);
            match found {
                Some(spigot) => {
                    fs::copy(&spigot, &jar)?;
                    let _ = fs::remove_dir_all(&work);
                    let _ = fs::remove_file(&bt);
                }
                None => {
                    return err("o BuildTools não gerou o spigot.jar (veja buildtools-work/BuildTools.log.txt)");
                }
            }
            finish(entry, &dir, app, InstallOutcome {
                jar: entry.jar.clone(),
                java_major: entry.java_major,
                extra_note: format!("Spigot {version} compilado com BuildTools"),
            })
            .await
        }
        InstallKind::Extract { url, extract_to } => {
            let file_name = url.rsplit('/').next().unwrap_or("arquivo").to_string();
            let target = dir.join(&file_name);
            java_mgr::download(&url, &target, &entry.id, "download", app).await?;
            java_mgr::emit(app, ProgressEvent {
                server_id: entry.id.clone(),
                stage: "install".into(),
                message: format!("Extraindo {file_name}..."),
                percent: Some(0.85),
            });
            let dest = dir.join(&extract_to);
            let total = util::extract_archive(&target, &dest)?;
            let _ = fs::remove_file(&target);
            let _ = total;

            // PocketMine-MP: precisa de um script de início e do PHP no sistema
            if entry.software == "pocketmine" {
                write_pocketmine_script(&dir)?;
                if java_mgr::which("php").is_none() {
                    return Err(crate::error::CommandError::Other(
                        "PocketMine-MP precisa do PHP instalado no sistema. Rode: sudo apt install php-cli".into(),
                    ));
                }
            }
            // Bedrock: garante permissão de execução
            for bin in ["bedrock_server", "start.sh"] {
                let p = dir.join(bin);
                if p.exists() {
                    let _ = Command::new("chmod").arg("+x").arg(&p).status();
                }
            }
            finish(entry, &dir, app, InstallOutcome {
                jar: if dir.join("bedrock_server").exists() {
                    "bedrock_server".into()
                } else {
                    entry.jar.clone()
                },
                java_major: entry.java_major,
                extra_note: "arquivo extraído".into(),
            })
            .await
        }
        InstallKind::Unavailable { reason } => Err(crate::error::CommandError::Other(reason)),
    }
}

/// Escrita final comum a todos os tipos: eula, properties e servidor vazio.
async fn finish(
    entry: &ServerEntry,
    dir: &PathBuf,
    app: Option<&tauri::AppHandle>,
    outcome: InstallOutcome,
) -> CommandResult<InstallOutcome> {
    java_mgr::emit(app, ProgressEvent {
        server_id: entry.id.clone(),
        stage: "finalize".into(),
        message: "Escrevendo arquivos de configuração...".into(),
        percent: Some(0.95),
    });
    write_eula(dir, entry)?;
    write_properties(dir, entry)?;
    // cria a pasta de mundo/pasta padrão
    let _ = fs::create_dir_all(dir.join("plugins"));
    java_mgr::emit(app, ProgressEvent {
        server_id: entry.id.clone(),
        stage: "done".into(),
        message: "Servidor instalado!".into(),
        percent: Some(1.0),
    });
    Ok(outcome)
}

/// Aceite do EULA da Mojang. Só é escrito quando o usuário marcou a caixa.
pub fn write_eula(dir: &PathBuf, entry: &ServerEntry) -> CommandResult<()> {
    let path = dir.join("eula.txt");
    let value = if entry.eula_accepted {
        "true"
    } else {
        "false"
    };
    fs::write(
        &path,
        format!(
            "# Ao alterar esta opção você declara que concorda com o EULA da Mojang.\n# https://www.minecraft.net/eula\neula={value}\n"
        ),
    )?;
    Ok(())
}

/// server.properties mínimo para o servidor Java (Bedrock tem chaves diferentes).
pub fn write_properties(dir: &PathBuf, entry: &ServerEntry) -> CommandResult<()> {
    if entry.software == "bedrock" {
        return Ok(());
    }
    let path = dir.join("server.properties");
    if path.exists() {
        // não sobrescreve: apenas garante que a MOTD e a porta estão certas
        let existing = fs::read_to_string(&path).unwrap_or_default();
        let mut out = String::new();
        for line in existing.lines() {
            if line.starts_with("motd=") || line.starts_with("server-port=") {
                continue;
            }
            out.push_str(line);
            out.push('\n');
        }
        out.push_str(&format!("motd={}\n", escape_motd(&entry.motd_joined())));
        out.push_str(&format!("server-port={}\n", entry.port));
        fs::write(&path, out)?;
        return Ok(());
    }
    let motd = escape_motd(&entry.motd_joined());
    let content = format!(
        "# Arquivo gerado pelo DSM. Edite pela aba \"Opções\".\n\
motd={motd}\n\
server-port={port}\n\
query.port={port}\n\
max-players=20\n\
gamemode=survival\n\
difficulty=easy\n\
online-mode=true\n\
white-list=false\n\
allow-flight=false\n\
force-gamemode=false\n\
spawn-protection=16\n\
pvp=true\n\
level-name=world\n\
view-distance=10\n\
enable-command-block=false\n",
        motd = motd,
        port = entry.port,
    );
    fs::write(&path, content)?;
    Ok(())
}

fn escape_motd(motd: &str) -> String {
    motd.replace('\n', "\\n")
}

fn write_pocketmine_script(dir: &PathBuf) -> CommandResult<()> {
    let script = "#!/bin/bash\ncd \"$(dirname \"$0\")\"\nif ! command -v php >/dev/null 2>&1; then\n  echo \"PHP não encontrado. Instale com: sudo apt install php-cli\"\n  exit 1\nfi\nexec php PocketMine-MP.phar\n";
    fs::write(dir.join("start.sh"), script)?;
    let _ = Command::new("chmod").arg("+x").arg(dir.join("start.sh")).status();
    Ok(())
}

/// Redimensiona um ícone para 64x64 (tamanho máximo do server-icon do Minecraft),
/// cortando o centro para manter o formato quadrado.
pub fn resize_icon(source: &PathBuf, dest: &PathBuf) -> CommandResult<()> {
    let img = image::open(source).map_err(|e| crate::error::CommandError::Other(format!("não foi possível abrir a imagem: {e}")))?;
    let resized = img.resize_to_fill(64, 64, image::imageops::FilterType::Lanczos3);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    resized
        .save_with_format(dest, image::ImageFormat::Png)
        .map_err(|e| crate::error::CommandError::Other(format!("falha ao salvar o ícone: {e}")))?;
    Ok(())
}

/// Java major esperado para uma versão de jogo (usado na criação).
pub fn expected_java(game_version: &str) -> u32 {
    java_major_for(game_version)
}

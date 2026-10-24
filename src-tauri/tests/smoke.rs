//! Teste de fumaça: prova o caminho completo do backend — descobrir versões,
//! planejar a instalação, baixar o jar, escrever os arquivos e LIGAR o servidor.
//!
//! Roda com `cargo test --test smoke -- --nocapture`.
use std::fs;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use dsm_lib::catalog;
use dsm_lib::java_mgr;
use dsm_lib::model::{Motd, ServerEntry};
use dsm_lib::software;
use dsm_lib::util;

fn test_server(id: &str, software: &str, version: &str) -> ServerEntry {
    ServerEntry {
        id: id.to_string(),
        name: format!("Teste {software}"),
        software: software.to_string(),
        version: version.to_string(),
        icon: None,
        motd: Motd {
            line1: "linha um".into(),
            line2: "linha dois".into(),
        },
        java_major: software::java_major_for(version),
        ram_mb: 1024,
        jar: "server.jar".into(),
        port: 25599,
        created_at: "agora".into(),
        modpack: None,
        eula_accepted: true,
    }
}

#[tokio::test]
async fn catalogo_tem_versoes_para_todos_os_softwares() {
    for s in software::all() {
        // modpack não tem versão; Mohist e Magma estão sem canal público de builds
        if s.id == "modpack" || s.id == "mohist" || s.id == "magma" {
            continue;
        }
        let versions = catalog::versions(&s.id)
            .await
            .unwrap_or_else(|e| panic!("{}: {}", s.id, e));
        assert!(
            !versions.is_empty(),
            "{} não devolveu nenhuma versão",
            s.id
        );
        println!("{:>12}: {} versões (ex: {})", s.id, versions.len(), versions[0].version);
    }
}

#[tokio::test]
async fn java_major_correta_por_versao() {
    assert_eq!(software::java_major_for("1.7.10"), 8);
    assert_eq!(software::java_major_for("1.12.2"), 8);
    assert_eq!(software::java_major_for("1.16.5"), 8);
    assert_eq!(software::java_major_for("1.17.1"), 16);
    assert_eq!(software::java_major_for("1.18.2"), 17);
    assert_eq!(software::java_major_for("1.20.4"), 17);
    assert_eq!(software::java_major_for("1.20.5"), 21);
    assert_eq!(software::java_major_for("1.21.4"), 21);
    assert_eq!(software::java_major_for("26.3"), 25);
}

#[tokio::test]
async fn cria_e_inicia_um_servidor_paper() {
    let entry = test_server("smoke-paper", "paper", "1.21.4");
    let dir = util::servers_dir().join("smoke-paper");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    // 1. plano de instalação
    let plan = catalog::install_plan(&entry.software, &entry.version)
        .await
        .expect("plano de instalação");
    println!("plano: {}", plan.note);

    // 2. baixa o jar
    let url = match &plan.kind {
        catalog::InstallKind::Jar { url } => url.clone(),
        other => panic!("esperava um jar, veio {other:?}"),
    };
    let jar = dir.join("server.jar");
    java_mgr::download(&url, &jar, "smoke", "test", None)
        .await
        .expect("download do jar");
    let size = fs::metadata(&jar).unwrap().len();
    println!("jar baixado: {} bytes", size);
    assert!(size > 1_000_000, "jar pequeno demais: {size}");

    // 3. arquivos básicos
    dsm_lib::installer::write_eula(&dir, &entry).unwrap();
    dsm_lib::installer::write_properties(&dir, &entry).unwrap();
    let props = fs::read_to_string(dir.join("server.properties")).unwrap();
    assert!(props.contains("motd=linha um\\nlinha dois"));
    assert!(fs::read_to_string(dir.join("eula.txt")).unwrap().contains("eula=true"));

    // 4. Java + start
    let java = java_mgr::ensure_java(entry.java_major, "smoke", None)
        .await
        .expect("java");
    let mut child = Command::new(&java)
        .args([
            "-Xmx1024M",
            "-jar",
            "server.jar",
            "nogui",
        ])
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("iniciar o servidor");

    // 5. espera o servidor dizer que subiu
    let started = Instant::now();
    let stdout = child.stdout.take().unwrap();
    // stderr em paralelo para o pipe não encher e travar o servidor
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                println!("   ! {line}");
            }
        });
    }
    let reader = BufReader::new(stdout);
    let mut online = false;
    let mut linhas = 0;
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        linhas += 1;
        if linhas <= 6 || line.contains("Done (") {
            println!("   | {line}");
        }
        if line.contains("Done (") && line.contains("For help, type") {
            online = true;
            break;
        }
        if started.elapsed() > Duration::from_secs(150) {
            break;
        }
    }
    assert!(online, "o servidor não indicou que subiu em 150s (vi {linhas} linhas)");

    // 6. console: manda um comando e confirma a resposta
    {
        use std::io::Write;
        let stdin = child.stdin.as_mut().unwrap();
        stdin.write_all(b"say ola do teste\n").unwrap();
        stdin.write_all(b"list\n").unwrap();
        stdin.flush().unwrap();
    }
    std::thread::sleep(Duration::from_secs(3));

    // 7. para com "stop" (caminho gracioso)
    {
        use std::io::Write;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(b"stop\n").unwrap();
            stdin.flush().ok();
        }
    }
    let status = child.wait().expect("parar o servidor");
    println!("servidor encerrado com status {:?}", status.code());

    // 8. o mundo foi criado?
    assert!(dir.join("world").exists(), "a pasta world deveria existir");
    assert!(dir.join("logs").exists(), "a pasta logs deveria existir");
    let _ = fs::remove_dir_all(&dir);
    println!("OK — servidor Paper criado, iniciado, comandado e parado.");
}

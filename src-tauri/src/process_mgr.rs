//! Gerenciador de processos dos servidores.
//!
//! Mantém um `HashMap<id, Arc<ProcHandle>>` com os processos vivos. Cada processo
//! tem duas threads (stdout e stderr) que empurram as linhas para o buffer de
//! console e emitem eventos para o frontend, e uma thread que espera o processo
//! terminar — e religa o servidor quando houve pedido de reinício.
//!
//! O hub vive dentro de um `Arc` gerenciado pelo Tauri, então as threads podem
//! chamá-lo diretamente (inclusive para reiniciar o servidor após o exit).
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Emitter;
use tauri::AppHandle;

use crate::error::{err, CommandResult};
use crate::model::{LogLine, ServerStatus};

/// Quantas linhas de console ficam guardadas por servidor.
const MAX_BUFFER: usize = 5000;

/// Dados necessários para (re)iniciar o processo.
#[derive(Clone)]
pub struct LaunchSpec {
    pub java: PathBuf,
    pub args: Vec<String>,
    pub dir: PathBuf,
}

pub struct ProcHandle {
    pub child: Arc<Mutex<Child>>,
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub status: Arc<Mutex<ServerStatus>>,
    pub log: Arc<Mutex<Vec<LogLine>>>,
    pub counter: Arc<Mutex<u64>>,
    /// true = quando terminar, ligar de novo (botão "Reiniciar")
    pub restart_requested: Arc<Mutex<bool>>,
    pub spec: LaunchSpec,
}

pub type SharedProc = Arc<ProcHandle>;

pub struct ProcessHub {
    pub app: AppHandle,
    pub procs: Mutex<HashMap<String, SharedProc>>,
    /// referência fraca para o próprio hub (o Arc vivo fica no estado do Tauri)
    weak: Mutex<Option<std::sync::Weak<ProcessHub>>>,
}

fn now_ts() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

pub fn detect_status(line: &str) -> Option<ServerStatus> {
    if line.contains("Done (") && line.contains("For help, type") {
        return Some(ServerStatus::Online);
    }
    if line.contains("Stopping the server") || line.contains("Stopping server") {
        return Some(ServerStatus::Stopping);
    }
    if line.contains("Preparing spawn area") || line.contains("Starting minecraft server") {
        return Some(ServerStatus::Starting);
    }
    None
}

impl ProcessHub {
    /// Cria o hub já dentro de um `Arc`, que é o que o Tauri vai gerenciar.
    pub fn new(app: AppHandle) -> Arc<Self> {
        let hub = Arc::new(Self {
            app,
            procs: Mutex::new(HashMap::new()),
            weak: Mutex::new(None),
        });
        *hub.weak.lock().unwrap() = Some(Arc::downgrade(&hub));
        hub
    }

    fn get(&self, id: &str) -> CommandResult<SharedProc> {
        self.procs
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| crate::error::CommandError::Other("o servidor está offline".into()))
    }

    pub fn history(&self, id: &str) -> Vec<LogLine> {
        self.procs
            .lock()
            .unwrap()
            .get(id)
            .map(|p| p.log.lock().unwrap().clone())
            .unwrap_or_default()
    }

    pub fn status(&self, id: &str) -> ServerStatus {
        self.procs
            .lock()
            .unwrap()
            .get(id)
            .map(|p| *p.status.lock().unwrap())
            .unwrap_or(ServerStatus::Offline)
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.procs.lock().unwrap().contains_key(id)
    }

    /// Empurra uma linha de log e emite o evento para o frontend.
    pub fn push_log(&self, id: &str, proc: &SharedProc, stream: &str, line: String) {
        let mut counter = proc.counter.lock().unwrap();
        *counter += 1;
        let entry = LogLine {
            id: *counter,
            ts: now_ts(),
            stream: stream.to_string(),
            line: line.clone(),
        };
        drop(counter);
        {
            let mut log = proc.log.lock().unwrap();
            log.push(entry.clone());
            if log.len() > MAX_BUFFER {
                let excess = log.len() - MAX_BUFFER;
                log.drain(0..excess);
            }
        }
        let _ = self.app.emit(
            "server://log",
            serde_json::json!({ "serverId": id, "line": entry }),
        );
    }

    pub fn set_status(&self, id: &str, proc: &SharedProc, status: ServerStatus) {
        *proc.status.lock().unwrap() = status;
        let _ = self.app
            .emit("server://status", serde_json::json!({ "serverId": id, "status": status }));
    }

    /// Inicia o processo. `spec` guarda tudo que é preciso para reiniciar depois.
    pub fn spawn(&self, id: &str, spec: LaunchSpec) -> CommandResult<()> {
        if self.procs.lock().unwrap().contains_key(id) {
            return err("o servidor já está rodando");
        }

        let mut command = Command::new(&spec.java);
        command
            .args(&spec.args)
            .current_dir(&spec.dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("TERM", "dumb")
            .env("NO_COLOR", "1");

        let mut child = command.spawn().map_err(|e| {
            crate::error::CommandError::Other(format!("falha ao iniciar o processo: {e}"))
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| crate::error::CommandError::Other("processo sem stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| crate::error::CommandError::Other("processo sem stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| crate::error::CommandError::Other("processo sem stderr".into()))?;

        let proc = Arc::new(ProcHandle {
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(stdin)),
            status: Arc::new(Mutex::new(ServerStatus::Starting)),
            log: Arc::new(Mutex::new(Vec::new())),
            counter: Arc::new(Mutex::new(0)),
            restart_requested: Arc::new(Mutex::new(false)),
            spec: spec.clone(),
        });
        self.procs.lock().unwrap().insert(id.to_string(), proc.clone());
        self.set_status(id, &proc, ServerStatus::Starting);
        self.push_log(
            id,
            &proc,
            "system",
            format!("$ {} {}", spec.java.display(), spec.args.join(" ")),
        );

        // ---- stdout ----
        {
            let hub: Arc<ProcessHub> = self.arc();
            let id = id.to_string();
            let proc = proc.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    hub.handle_line(&id, &proc, "stdout", line);
                }
            });
        }
        // ---- stderr ----
        {
            let hub: Arc<ProcessHub> = self.arc();
            let id = id.to_string();
            let proc = proc.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    hub.handle_line(&id, &proc, "stderr", line);
                }
            });
        }
        // ---- espera do exit ----
        {
            let hub: Arc<ProcessHub> = self.arc();
            let id = id.to_string();
            let proc = proc.clone();
            std::thread::spawn(move || {
                loop {
                    let exited = {
                        let mut child = proc.child.lock().unwrap();
                        matches!(child.try_wait(), Ok(Some(_)))
                    };
                    if exited {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(120));
                }
                let code = proc
                    .child
                    .lock()
                    .unwrap()
                    .try_wait()
                    .ok()
                    .flatten()
                    .and_then(|s| s.code());
                let restart = std::mem::replace(&mut *proc.restart_requested.lock().unwrap(), false);
                hub.push_log(
                    &id,
                    &proc,
                    "system",
                    format!("processo encerrado (código {:?})", code),
                );
                hub.set_status(&id, &proc, ServerStatus::Offline);
                hub.procs.lock().unwrap().remove(&id);
                if restart {
                    hub.push_log(&id, &proc, "system", "reiniciando o servidor...".into());
                    if let Err(e) = hub.spawn(&id, proc.spec.clone()) {
                        hub.push_log(&id, &proc, "system", format!("falha ao reiniciar: {e}"));
                    }
                }
            });
        }

        Ok(())
    }

    /// Trata uma linha lida do processo: log + detecção de status.
    pub fn handle_line(&self, id: &str, proc: &SharedProc, stream: &str, line: String) {
        if let Some(status) = detect_status(&line) {
            let current = *proc.status.lock().unwrap();
            // uma vez online, não volta para "starting" por causa de outras mensagens
            let next = match (current, status) {
                (ServerStatus::Online, ServerStatus::Starting) => ServerStatus::Online,
                (_current, next) => next,
            };
            self.set_status(id, proc, next);
        }
        self.push_log(id, proc, stream, line);
    }

    /// Devolve um `Arc<Self>`: o hub é criado com `ProcessHub::new` dentro de um
    /// `Arc` e uma referência fraca para si mesmo fica guardada, então as threads
    /// conseguem um clone sem depender do estado do Tauri.
    fn arc(&self) -> Arc<ProcessHub> {
        self.weak
            .lock()
            .unwrap()
            .clone()
            .and_then(|weak| weak.upgrade())
            .expect("o hub precisa ser criado com ProcessHub::new dentro de um Arc")
    }

    /// Escreve uma linha no stdin do processo (comando de console).
    pub fn send(&self, id: &str, line: &str) -> CommandResult<()> {
        let proc = self.get(id)?;
        {
            let mut stdin = proc.stdin.lock().unwrap();
            stdin
                .write_all(line.as_bytes())
                .map_err(|e| crate::error::CommandError::Other(format!("falha ao enviar: {e}")))?;
            stdin
                .write_all(b"\n")
                .map_err(|e| crate::error::CommandError::Other(format!("falha ao enviar: {e}")))?;
            stdin
                .flush()
                .map_err(|e| crate::error::CommandError::Other(format!("falha ao enviar: {e}")))?;
        }
        self.push_log(id, &proc, "command", format!("> {line}"));
        Ok(())
    }

    /// Para o servidor com "stop" (salva tudo).
    pub fn stop(&self, id: &str) -> CommandResult<()> {
        let proc = self.get(id)?;
        *proc.restart_requested.lock().unwrap() = false;
        self.set_status(id, &proc, ServerStatus::Stopping);
        self.send(id, "stop")
    }

    /// Desliga forçado (SIGKILL) — usado quando o servidor trava.
    pub fn force_stop(&self, id: &str) -> CommandResult<()> {
        let proc = self.get(id)?;
        {
            let mut child = proc.child.lock().unwrap();
            let _ = child.kill();
        }
        self.set_status(id, &proc, ServerStatus::Stopping);
        self.push_log(
            id,
            &proc,
            "system",
            "desligamento forçado enviado (SIGKILL) — o mundo pode não ter sido salvo".into(),
        );
        Ok(())
    }

    /// Reinicia: manda "stop" e marca para religar quando o processo sair.
    pub fn restart(&self, id: &str) -> CommandResult<()> {
        let proc = self.get(id)?;
        *proc.restart_requested.lock().unwrap() = true;
        self.set_status(id, &proc, ServerStatus::Stopping);
        self.send(id, "stop")
    }

    pub fn remove(&self, id: &str) {
        self.procs.lock().unwrap().remove(id);
    }
}

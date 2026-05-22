const { spawn } = require("node:child_process");
const path = require("node:path");

function createDefaultSpawner({ serverDir, jarFileName = "paper.jar", javaExecutable = "java" }) {
  return () =>
    spawn(javaExecutable, ["-jar", jarFileName, "nogui"], {
      cwd: serverDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
}

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_PATTERN = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g;

function countReplacementChars(text) {
  return (String(text || "").match(/\uFFFD/g) || []).length;
}

function decodeChunk(value) {
  if (Buffer.isBuffer(value)) {
    const utf8 = value.toString("utf8");
    const latin1 = value.toString("latin1");
    const utf8Losses = countReplacementChars(utf8);
    const latin1Losses = countReplacementChars(latin1);
    if (utf8Losses === 0 || utf8Losses <= latin1Losses) {
      return utf8;
    }
    return latin1;
  }
  return String(value || "");
}

function normalizeConsoleChunk(value) {
  return decodeChunk(value).replace(ANSI_ESCAPE_PATTERN, "").replace(ANSI_OSC_PATTERN, "").replace(CONTROL_CHARS_PATTERN, "");
}

function splitLines(value) {
  return normalizeConsoleChunk(value)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIgnorableStdinError(error) {
  const code = String(error?.code || "").toUpperCase();
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

function createServerRuntime({
  spawnProcess,
  serverDir = path.resolve(process.cwd(), "server"),
  javaExecutable = "java",
  maxConsoleLines = 400,
  onLine,
} = {}) {
  let proc = null;
  let startedAt = 0;
  const lines = [];
  const spawnFn = spawnProcess || createDefaultSpawner({ serverDir, javaExecutable });

  function pushLines(chunk, stream = "OUT") {
    for (const line of splitLines(chunk)) {
      const formatted = `[${stream}] ${line}`;
      lines.push(formatted);
      if (typeof onLine === "function") {
        onLine({ stream, line, formatted });
      }
    }
    if (lines.length > maxConsoleLines) {
      lines.splice(0, lines.length - maxConsoleLines);
    }
  }

  function getStatus() {
    if (!proc) {
      return { state: "offline", pid: null, startedAt: null, uptimeMs: 0 };
    }
    return {
      state: "running",
      pid: proc.pid || null,
      startedAt: new Date(startedAt).toISOString(),
      uptimeMs: Date.now() - startedAt,
    };
  }

  function attachStdinErrorHandler(childProc) {
    const stdin = childProc?.stdin;
    if (!stdin || typeof stdin.on !== "function") return;
    if (stdin.__dsmErrorHandlerAttached) return;
    stdin.__dsmErrorHandlerAttached = true;
    stdin.on("error", (error) => {
      if (isIgnorableStdinError(error)) {
        pushLines(`Ignored stdin error (${error.code})`, "SYS");
        return;
      }
      pushLines(`stdin error: ${error?.message || "unknown"}`, "ERR");
    });
  }

  function canWriteToStdin(stdin) {
    if (!stdin || typeof stdin.write !== "function") return false;
    if (stdin.destroyed || stdin.writableEnded || stdin.closed) return false;
    return true;
  }

  function tryWriteToStdin(value) {
    const stdin = proc?.stdin;
    if (!canWriteToStdin(stdin)) return false;
    try {
      stdin.write(value);
      return true;
    } catch (error) {
      if (!isIgnorableStdinError(error)) {
        pushLines(`stdin write failed: ${error?.message || "unknown"}`, "ERR");
      }
      return false;
    }
  }

  async function start() {
    if (proc) {
      return getStatus();
    }
    proc = spawnFn();
    startedAt = Date.now();

    if (proc.stdout) {
      proc.stdout.on("data", (chunk) => pushLines(chunk, "OUT"));
    }
    if (proc.stderr) {
      proc.stderr.on("data", (chunk) => pushLines(chunk, "ERR"));
    }
    attachStdinErrorHandler(proc);
    proc.on("error", (error) => {
      pushLines(`Process error: ${error?.message || "unknown"}`, "ERR");
    });
    proc.on("exit", (code, signal) => {
      pushLines(`Process exited (code=${code}, signal=${signal})`, "SYS");
      proc = null;
      startedAt = 0;
    });

    pushLines("Server process started", "SYS");
    return getStatus();
  }

  async function stop() {
    if (!proc) {
      return getStatus();
    }

    const activeProc = proc;
    const ended = new Promise((resolve) => {
      activeProc.once("exit", resolve);
    });

    if (!tryWriteToStdin("stop\n")) {
      pushLines("Stop command skipped: stdin unavailable.", "SYS");
    }
    let exited = await Promise.race([ended.then(() => true), delay(12000).then(() => false)]);

    if (!exited && typeof activeProc.kill === "function") {
      activeProc.kill();
      exited = await Promise.race([ended.then(() => true), delay(4000).then(() => false)]);
    }

    if (!exited && typeof activeProc.kill === "function") {
      try {
        activeProc.kill("SIGKILL");
      } catch {}
      await Promise.race([ended, delay(2000)]);
    }

    return getStatus();
  }

  async function restart() {
    await stop();
    return start();
  }

  function sendCommand(command) {
    if (!proc || !proc.stdin || typeof proc.stdin.write !== "function") {
      throw new Error("Server is offline");
    }
    const wrote = tryWriteToStdin(`${command}\n`);
    if (!wrote) {
      throw new Error("Server is offline");
    }
    pushLines(`> ${command}`, "CMD");
  }

  function getConsoleLines() {
    return [...lines];
  }

  return {
    __dsmDefaultRuntime: true,
    start,
    stop,
    restart,
    sendCommand,
    getConsoleLines,
    getStatus,
  };
}

module.exports = {
  createServerRuntime,
};

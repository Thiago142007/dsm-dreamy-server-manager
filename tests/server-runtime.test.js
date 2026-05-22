const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const { createServerRuntime } = require("../src/lib/server-runtime");

class FakeProcess extends EventEmitter {
  constructor({ brokenPipeOnStop = false } = {}) {
    super();
    this.pid = 4242;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = new EventEmitter();
    this.stdin.writes = [];
    this.stdin.write = (chunk) => {
      this.stdin.writes.push(chunk);
      if (String(chunk).trim().toLowerCase() === "stop") {
        if (brokenPipeOnStop) {
          const error = new Error("write EPIPE");
          error.code = "EPIPE";
          this.stdin.emit("error", error);
          this.emit("exit", 0, null);
          throw error;
        }
        this.emit("exit", 0, null);
      }
    };
    this.killed = false;
  }

  kill() {
    this.killed = true;
    this.emit("exit", 0, null);
  }
}

test("runtime starts, receives console output and accepts commands", async () => {
  const proc = new FakeProcess();
  const runtime = createServerRuntime({
    spawnProcess: () => proc,
  });

  const started = await runtime.start();
  assert.equal(started.state, "running");
  assert.equal(started.pid, 4242);

  proc.stdout.emit("data", Buffer.from("Done (1.2s)! For help, type \"help\"\n", "utf8"));
  proc.stderr.emit("data", Buffer.from("[WARN] sample warning\n", "utf8"));
  runtime.sendCommand("say hello");

  const logs = runtime.getConsoleLines();
  assert.equal(logs.length >= 2, true);
  assert.equal(proc.stdin.writes.includes("say hello\n"), true);
});

test("runtime stop transitions to offline state", async () => {
  const proc = new FakeProcess();
  const runtime = createServerRuntime({
    spawnProcess: () => proc,
  });

  await runtime.start();
  const stopped = await runtime.stop();
  assert.equal(stopped.state, "offline");
  assert.equal(proc.stdin.writes.includes("stop\n"), true);
});

test("runtime stop ignores EPIPE on stdin without crashing", async () => {
  const proc = new FakeProcess({ brokenPipeOnStop: true });
  const runtime = createServerRuntime({
    spawnProcess: () => proc,
  });

  await runtime.start();
  const stopped = await runtime.stop();
  assert.equal(stopped.state, "offline");
  assert.equal(proc.stdin.writes.includes("stop\n"), true);
});

test("runtime strips ansi escape sequences and preserves latin1 text", async () => {
  const proc = new FakeProcess();
  const runtime = createServerRuntime({
    spawnProcess: () => proc,
  });

  await runtime.start();
  proc.stdout.emit("data", Buffer.from("\u001b[0;34;1mINFORMAÇÕES\u001b[m\n", "latin1"));

  const logs = runtime.getConsoleLines();
  assert.equal(logs.some((line) => line.includes("\u001b[")), false);
  assert.equal(logs.some((line) => line.includes("INFORMAÇÕES")), true);
});

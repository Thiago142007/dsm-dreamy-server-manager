const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");
const { resolveStorageRoot } = require("../electron/portable-paths");
const { createServer } = require("../src/server");

test("package config builds a named x64 portable executable", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(__dirname, "..", "package.json"), "utf8")
  );

  assert.equal(packageJson.scripts["dist:win"], "electron-builder --win portable");
  assert.deepEqual(packageJson.build.win.target, [
    { target: "portable", arch: ["x64"] },
  ]);
  assert.equal(packageJson.build.win.artifactName, "Dreamy Server Manager.${ext}");
  assert.equal(packageJson.build.portable.requestExecutionLevel, "user");
});

test("desktop development stores data in the working directory", () => {
  assert.equal(
    resolveStorageRoot({
      isPackaged: false,
      cwd: "C:\\workspace\\dsm",
      execPath: "C:\\electron\\electron.exe",
      portableExecutableDir: "C:\\ignored",
    }),
    path.resolve("C:\\workspace\\dsm")
  );
});

test("portable build stores data beside the portable executable", () => {
  assert.equal(
    resolveStorageRoot({
      isPackaged: true,
      cwd: "C:\\ignored",
      execPath: "C:\\Temp\\unpacked\\Dreamy Server Manager.exe",
      portableExecutableDir: "D:\\Apps\\Dreamy",
    }),
    path.join(path.resolve("D:\\Apps\\Dreamy"), "Dreamy Server Manager Data")
  );
});

test("packaged fallback stores data beside process.execPath", () => {
  assert.equal(
    resolveStorageRoot({
      isPackaged: true,
      cwd: "C:\\ignored",
      execPath: "D:\\Apps\\Dreamy\\Dreamy Server Manager.exe",
      portableExecutableDir: "",
    }),
    path.join(path.resolve("D:\\Apps\\Dreamy"), "Dreamy Server Manager Data")
  );
});

test("desktop backend can use a free loopback port", async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-electron-"));
  const backend = createServer({
    dataDir: path.join(storageRoot, "data"),
    serverDir: path.join(storageRoot, "server"),
  });

  try {
    await backend.start(0, "127.0.0.1");
    const url = new URL(backend.baseUrl);
    assert.equal(url.hostname, "127.0.0.1");
    assert.notEqual(url.port, "0");

    const response = await fetch(`${backend.baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
  } finally {
    await backend.stop();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});

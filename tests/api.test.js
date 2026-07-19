const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const archiver = require("archiver");
const { createServer } = require("../src/server");

async function setupApp({
  dataDir,
  serverDir,
  runtimeManager,
  downloadPaperVersion,
  downloadBinary,
  commandRunner,
  runtimePlatform,
  runtimeArch,
  runtimeEnv,
  searchPlugins,
  resolvePluginDownload,
  getPluginDetails,
} = {}) {
  const app = createServer({
    dataDir,
    serverDir,
    runtimeManager,
    downloadPaperVersion,
    downloadBinary,
    commandRunner,
    runtimePlatform,
    runtimeArch,
    runtimeEnv,
    searchPlugins,
    resolvePluginDownload,
    getPluginDetails,
  });
  await app.start(0);

  const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "85113005" }),
  });
  const loginBody = await loginResponse.json();
  const token = loginBody.token;

  const serversResponse = await fetch(`${app.baseUrl}/api/home/servers`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const serversBody = await serversResponse.json();
  const serverId = serversBody.servers[0].id;

  return {
    app,
    token,
    serverId,
    authHeaders(extra = {}) {
      return {
        authorization: `Bearer ${token}`,
        "x-dsm-server-id": serverId,
        ...extra,
      };
    },
  };
}

async function loginAs(app, username, password) {
  const response = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  return {
    status: response.status,
    body,
    token: body.token,
  };
}

async function createZipFile(targetPath, entries = []) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(targetPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("warning", (error) => {
      if (error && error.code === "ENOENT") return;
      reject(error);
    });
    archive.on("error", reject);

    archive.pipe(output);
    for (const entry of entries) {
      const name = String(entry?.name || "").trim();
      if (!name) continue;
      archive.append(Buffer.from(String(entry?.content || ""), "utf8"), { name });
    }
    archive.finalize().catch(reject);
  });
}

test("api health endpoint returns ok", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-"));
  const { app } = await setupApp({ dataDir });
  try {
    const response = await fetch(`${app.baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  } finally {
    await app.stop();
  }
});

test("api logout invalidates the current session token", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-auth-"));
  const { app, authHeaders } = await setupApp({ dataDir });
  try {
    const meBeforeLogout = await fetch(`${app.baseUrl}/api/auth/me`, {
      headers: authHeaders(),
    });
    assert.equal(meBeforeLogout.status, 200);

    const logoutResponse = await fetch(`${app.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: authHeaders(),
    });
    assert.equal(logoutResponse.status, 200);

    const meAfterLogout = await fetch(`${app.baseUrl}/api/auth/me`, {
      headers: authHeaders(),
    });
    assert.equal(meAfterLogout.status, 401);
  } finally {
    await app.stop();
  }
});

test("api supports cowork sharing and enforces permissions", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-cowork-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.writeFile(path.join(serverDir, "hello.txt"), "hello", "utf8");

  const { app, authHeaders, serverId, token } = await setupApp({ dataDir, serverDir });
  try {
    const createUser = await fetch(`${app.baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "alice",
        password: "alice123",
        maxServers: 1,
      }),
    });
    assert.equal(createUser.status, 201);

    const grantCowork = await fetch(`${app.baseUrl}/api/server/cowork`, {
      method: "POST",
      headers: {
        ...authHeaders({ "content-type": "application/json" }),
      },
      body: JSON.stringify({
        targetUsername: "alice",
        permissions: {
          filesRead: true,
        },
      }),
    });
    assert.equal(grantCowork.status, 200);

    const aliceLogin = await loginAs(app, "alice", "alice123");
    assert.equal(aliceLogin.status, 200);
    const aliceHeaders = {
      authorization: `Bearer ${aliceLogin.token}`,
      "x-dsm-server-id": serverId,
    };

    const aliceHome = await fetch(`${app.baseUrl}/api/home/servers`, {
      headers: { authorization: `Bearer ${aliceLogin.token}` },
    });
    const aliceHomeBody = await aliceHome.json();
    assert.equal(aliceHome.status, 200);
    assert.equal(aliceHomeBody.servers.some((item) => item.id === serverId && item.accessType === "cowork"), true);

    const readFiles = await fetch(`${app.baseUrl}/api/server/files`, {
      headers: aliceHeaders,
    });
    assert.equal(readFiles.status, 200);

    const writeDenied = await fetch(`${app.baseUrl}/api/server/files/write`, {
      method: "POST",
      headers: {
        ...aliceHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "test.txt",
        content: "blocked",
      }),
    });
    assert.equal(writeDenied.status, 403);

    const commandDenied = await fetch(`${app.baseUrl}/api/server/command`, {
      method: "POST",
      headers: {
        ...aliceHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "say blocked",
      }),
    });
    assert.equal(commandDenied.status, 403);

    const coworkManageDenied = await fetch(`${app.baseUrl}/api/server/cowork`, {
      headers: aliceHeaders,
    });
    assert.equal(coworkManageDenied.status, 403);
  } finally {
    await app.stop();
  }
});

test("api blocks server export for cowork access", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-export-cowork-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.writeFile(path.join(serverDir, "hello.txt"), "hello", "utf8");

  const { app, authHeaders, serverId, token } = await setupApp({ dataDir, serverDir });
  try {
    const createUser = await fetch(`${app.baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "alice",
        password: "alice123",
        maxServers: 1,
      }),
    });
    assert.equal(createUser.status, 201);

    const grantCowork = await fetch(`${app.baseUrl}/api/server/cowork`, {
      method: "POST",
      headers: {
        ...authHeaders({ "content-type": "application/json" }),
      },
      body: JSON.stringify({
        targetUsername: "alice",
        permissions: {
          filesRead: true,
        },
      }),
    });
    assert.equal(grantCowork.status, 200);

    const aliceLogin = await loginAs(app, "alice", "alice123");
    assert.equal(aliceLogin.status, 200);
    const aliceHeaders = {
      authorization: `Bearer ${aliceLogin.token}`,
      "x-dsm-server-id": serverId,
    };
    const exportDenied = await fetch(`${app.baseUrl}/api/server/export`, {
      method: "POST",
      headers: aliceHeaders,
    });
    assert.equal(exportDenied.status, 403);
  } finally {
    await app.stop();
  }
});

test("api exports and imports full server preserving name and files", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-export-import-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders, token } = await setupApp({ dataDir, serverDir });
  try {
    const createSourceServer = await fetch(`${app.baseUrl}/api/home/servers`, {
      method: "POST",
      headers: {
        ...authHeaders({ "content-type": "application/json" }),
      },
      body: JSON.stringify({
        name: "Meu Servidor Compartilhavel",
      }),
    });
    const createSourceBody = await createSourceServer.json();
    assert.equal(createSourceServer.status, 201);
    const sourceServer = createSourceBody.server;

    await fs.mkdir(path.join(sourceServer.path, "world"), { recursive: true });
    await fs.mkdir(path.join(sourceServer.path, "plugins"), { recursive: true });
    await fs.writeFile(path.join(sourceServer.path, "server.properties"), "motd=Dreamy\nmax-players=20\n", "utf8");
    await fs.writeFile(path.join(sourceServer.path, "world", "level.dat"), Buffer.from([1, 2, 3, 4]));
    await fs.writeFile(path.join(sourceServer.path, "plugins", "test.jar"), Buffer.from([10, 20, 30, 40]));

    const exportResponse = await fetch(`${app.baseUrl}/api/server/export`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-dsm-server-id": sourceServer.id,
      },
    });
    const exportBody = await exportResponse.json();
    assert.equal(exportResponse.status, 200);
    assert.equal(exportBody.ok, true);
    assert.equal(exportBody.archive.server.name, "Meu Servidor Compartilhavel");
    assert.equal(Array.isArray(exportBody.archive.entries), true);
    assert.equal(exportBody.archive.entries.length > 0, true);

    const createImportUser = await fetch(`${app.baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "bob",
        password: "bob123",
        maxServers: 2,
      }),
    });
    assert.equal(createImportUser.status, 201);

    const bobLogin = await loginAs(app, "bob", "bob123");
    assert.equal(bobLogin.status, 200);

    const importPayloadBase64 = Buffer.from(JSON.stringify(exportBody.archive), "utf8").toString("base64");
    const importResponse = await fetch(`${app.baseUrl}/api/home/servers/import`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bobLogin.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        archiveBase64: importPayloadBase64,
      }),
    });
    const importBody = await importResponse.json();
    assert.equal(importResponse.status, 201);
    assert.equal(importBody.ok, true);
    assert.equal(importBody.server.name, "Meu Servidor Compartilhavel");

    const importedProperties = await fs.readFile(path.join(importBody.server.path, "server.properties"), "utf8");
    const importedWorld = await fs.readFile(path.join(importBody.server.path, "world", "level.dat"));
    const importedPlugin = await fs.readFile(path.join(importBody.server.path, "plugins", "test.jar"));
    assert.equal(importedProperties.includes("motd=Dreamy"), true);
    assert.deepEqual(Array.from(importedWorld), [1, 2, 3, 4]);
    assert.deepEqual(Array.from(importedPlugin), [10, 20, 30, 40]);
  } finally {
    await app.stop();
  }
});

test("api imports server from export download file endpoint", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-export-stream-import-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders, token } = await setupApp({ dataDir, serverDir });
  try {
    const createSourceServer = await fetch(`${app.baseUrl}/api/home/servers`, {
      method: "POST",
      headers: {
        ...authHeaders({ "content-type": "application/json" }),
      },
      body: JSON.stringify({
        name: "Servidor Import via Download",
      }),
    });
    const createSourceBody = await createSourceServer.json();
    assert.equal(createSourceServer.status, 201);
    const sourceServer = createSourceBody.server;

    await fs.mkdir(path.join(sourceServer.path, "world", "data"), { recursive: true });
    await fs.writeFile(path.join(sourceServer.path, "server.properties"), "motd=Import Stream\n", "utf8");
    await fs.writeFile(path.join(sourceServer.path, "world", "data", "level.dat"), Buffer.from([11, 22, 33, 44]));

    const exportResponse = await fetch(`${app.baseUrl}/api/server/export/download`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-dsm-server-id": sourceServer.id,
      },
    });
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.headers.get("content-type"), "application/zip");
    const exportBytes = Buffer.from(await exportResponse.arrayBuffer());
    assert.equal(exportBytes.length > 0, true);

    const createImportUser = await fetch(`${app.baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "carl",
        password: "carl123",
        maxServers: 2,
      }),
    });
    assert.equal(createImportUser.status, 201);

    const carlLogin = await loginAs(app, "carl", "carl123");
    assert.equal(carlLogin.status, 200);

    const importResponse = await fetch(`${app.baseUrl}/api/home/servers/import/file`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${carlLogin.token}`,
        "content-type": "application/zip",
        "x-dsm-import-name": "import-test.dsmexport.zip",
      },
      body: exportBytes,
    });
    const importBody = await importResponse.json();
    assert.equal(importResponse.status, 201);
    assert.equal(importBody.ok, true);
    assert.equal(importBody.server.name, "Servidor Import via Download");

    const importedProperties = await fs.readFile(path.join(importBody.server.path, "server.properties"), "utf8");
    const importedLevel = await fs.readFile(path.join(importBody.server.path, "world", "data", "level.dat"));
    assert.equal(importedProperties.includes("motd=Import Stream"), true);
    assert.deepEqual(Array.from(importedLevel), [11, 22, 33, 44]);
  } finally {
    await app.stop();
  }
});

test("api auto-detects bungeecord server type when importing zip", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-export-bungee-zip-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders, token } = await setupApp({ dataDir, serverDir });
  try {
    const createSourceServer = await fetch(`${app.baseUrl}/api/home/servers`, {
      method: "POST",
      headers: {
        ...authHeaders({ "content-type": "application/json" }),
      },
      body: JSON.stringify({
        name: "Rede Bungee",
      }),
    });
    const createSourceBody = await createSourceServer.json();
    assert.equal(createSourceServer.status, 201);
    const sourceServer = createSourceBody.server;

    const sourceSubPath = path.join(sourceServer.path, "servers", "lobby");
    await fs.mkdir(sourceSubPath, { recursive: true });
    await fs.writeFile(path.join(sourceSubPath, "server.properties"), "server-port=25566\nmotd=Lobby\n", "utf8");
    await fs.writeFile(path.join(sourceServer.path, "config.yml"), "listeners:\nservers:\n", "utf8");
    await fs.writeFile(
      path.join(sourceServer.path, ".dsm-server.json"),
      JSON.stringify(
        {
          serverKind: "bungeecord",
          paperVersion: "bungeecord",
          bungee: {
            nextPort: 25567,
            subServers: [
              {
                id: "sub-lobby",
                name: "lobby",
                slug: "lobby",
                path: sourceSubPath,
                port: 25566,
                version: "1.21.4",
                createdAt: new Date().toISOString(),
              },
            ],
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const exportResponse = await fetch(`${app.baseUrl}/api/server/export/download`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-dsm-server-id": sourceServer.id,
      },
    });
    assert.equal(exportResponse.status, 200);
    const exportBytes = Buffer.from(await exportResponse.arrayBuffer());
    assert.equal(exportBytes.length > 0, true);

    const createImportUser = await fetch(`${app.baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "dani",
        password: "dani123",
        maxServers: 2,
      }),
    });
    assert.equal(createImportUser.status, 201);

    const daniLogin = await loginAs(app, "dani", "dani123");
    assert.equal(daniLogin.status, 200);

    const importResponse = await fetch(`${app.baseUrl}/api/home/servers/import/file`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${daniLogin.token}`,
        "content-type": "application/zip",
        "x-dsm-import-name": "rede-bungee.zip",
      },
      body: exportBytes,
    });
    const importBody = await importResponse.json();
    assert.equal(importResponse.status, 201);
    assert.equal(importBody.ok, true);

    const importedMetaRaw = await fs.readFile(path.join(importBody.server.path, ".dsm-server.json"), "utf8");
    const importedMeta = JSON.parse(importedMetaRaw);
    assert.equal(importedMeta.serverKind, "bungeecord");
    assert.equal(Array.isArray(importedMeta.bungee?.subServers), true);
    assert.equal(importedMeta.bungee.subServers.length > 0, true);
    const importedSubPath = String(importedMeta.bungee.subServers[0].path || "");
    assert.equal(importedSubPath.startsWith(importBody.server.path), true);
  } finally {
    await app.stop();
  }
});

test("api can create and list extensions", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-ext-"));
  const { app, authHeaders } = await setupApp({ dataDir });
  try {
    const createResponse = await fetch(`${app.baseUrl}/api/extensions`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        identifier: "dreamyone",
        name: "Dreamy One",
        version: "0.1.0",
        description: "test",
        target: "beta-2025-09",
        flags: "ignorePlaceholders",
      }),
    });
    assert.equal(createResponse.status, 201);

    const listResponse = await fetch(`${app.baseUrl}/api/extensions`, {
      headers: authHeaders(),
    });
    const listBody = await listResponse.json();
    assert.equal(Array.isArray(listBody.items), true);
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].identifier, "dreamyone");
  } finally {
    await app.stop();
  }
});

test("api exposes server files from server directory", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-files-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(path.join(serverDir, "logs"), { recursive: true });
  await fs.writeFile(path.join(serverDir, "eula.txt"), "eula=true\n", "utf8");

  const { app, authHeaders } = await setupApp({ dataDir, serverDir });
  try {
    const response = await fetch(`${app.baseUrl}/api/server/files`, {
      headers: authHeaders(),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.files.includes("eula.txt"), true);
    assert.equal(body.directories.includes("logs"), true);
  } finally {
    await app.stop();
  }
});

test("api ensures eula=true when starting a server", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-eula-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const fakeRuntime = {
    state: "offline",
    async start() {
      this.state = "running";
      return this.getStatus();
    },
    async stop() {
      this.state = "offline";
      return this.getStatus();
    },
    async restart() {
      this.state = "running";
      return this.getStatus();
    },
    getStatus() {
      return { state: this.state, pid: this.state === "running" ? 4242 : null };
    },
    sendCommand() {},
    getConsoleLines() {
      return [];
    },
  };

  const { app, authHeaders } = await setupApp({ dataDir, serverDir, runtimeManager: fakeRuntime });
  try {
    const eulaPath = path.join(serverDir, "eula.txt");
    await fs.rm(eulaPath, { force: true });

    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(startResponse.status, 200);

    const eulaContent = await fs.readFile(eulaPath, "utf8");
    assert.equal(eulaContent.trim(), "eula=true");
  } finally {
    await app.stop();
  }
});

test("api exposes paper versions and performs downloads", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-paper-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    downloadPaperVersion: async ({ destinationPath }) => {
      await fs.writeFile(destinationPath, "jar-bytes", "utf8");
      return { bytesWritten: 9 };
    },
  });
  try {
    const listResponse = await fetch(`${app.baseUrl}/api/paper/versions`, {
      headers: authHeaders(),
    });
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(Array.isArray(listBody.items), true);
    assert.equal(listBody.items.length > 10, true);

    const downloadResponse = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ version: "1.21.11" }),
    });
    const downloadBody = await downloadResponse.json();
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadBody.ok, true);
    assert.equal(downloadBody.fileName, "paper.jar");

    const infoResponse = await fetch(`${app.baseUrl}/api/server/info`, {
      headers: authHeaders(),
    });
    const infoBody = await infoResponse.json();
    assert.equal(infoResponse.status, 200);
    assert.equal(infoBody.paperVersion, "1.21.11");

    const filePath = path.join(serverDir, downloadBody.fileName);
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, true);
  } finally {
    await app.stop();
  }
});

test("api asks for install mode when replacing installed paper version", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-paper-mode-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.writeFile(destinationPath, `jar-${version}`, "utf8");
      return { bytesWritten: 9 };
    },
  });

  try {
    const firstInstall = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ version: "1.21.11" }),
    });
    assert.equal(firstInstall.status, 200);

    await fs.writeFile(path.join(serverDir, "keep.txt"), "keep", "utf8");

    const needsChoice = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ version: "1.21.10" }),
    });
    const needsChoiceBody = await needsChoice.json();
    assert.equal(needsChoice.status, 409);
    assert.equal(needsChoiceBody.actionRequired, "version_change");

    const replaceJar = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ version: "1.21.10", installMode: "replace_jar" }),
    });
    assert.equal(replaceJar.status, 200);
    const keepStillExists = await fs
      .access(path.join(serverDir, "keep.txt"))
      .then(() => true)
      .catch(() => false);
    assert.equal(keepStillExists, true);

    await fs.writeFile(path.join(serverDir, "remove-me.txt"), "remove", "utf8");
    const reinstall = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ version: "1.21.9", installMode: "reinstall" }),
    });
    const reinstallBody = await reinstall.json();
    assert.equal(reinstall.status, 200);
    assert.equal(reinstallBody.installModeApplied, "reinstall");

    const removedAfterReinstall = await fs
      .access(path.join(serverDir, "remove-me.txt"))
      .then(() => true)
      .catch(() => false);
    assert.equal(removedAfterReinstall, false);

    const eulaExists = await fs
      .access(path.join(serverDir, "eula.txt"))
      .then(() => true)
      .catch(() => false);
    assert.equal(eulaExists, true);
  } finally {
    await app.stop();
  }
});

test("api installs bungeecord and creates sub-servers without auto proxy config rewrites", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-bungee-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    downloadBinary: async ({ destinationPath }) => {
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 11 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    const installBody = await installBungee.json();
    assert.equal(installBungee.status, 200);
    assert.equal(installBody.serverKind, "bungeecord");

    const infoResponse = await fetch(`${app.baseUrl}/api/server/info`, {
      headers: authHeaders(),
    });
    const infoBody = await infoResponse.json();
    assert.equal(infoResponse.status, 200);
    assert.equal(infoBody.serverKind, "bungeecord");

    const createSub = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    const createSubBody = await createSub.json();
    assert.equal(createSub.status, 201);
    assert.equal(createSubBody.subServer.name, "lobby");
    assert.equal(createSubBody.subServer.port, 25566);

    const listSub = await fetch(`${app.baseUrl}/api/server/subservers`, {
      headers: authHeaders(),
    });
    const listSubBody = await listSub.json();
    assert.equal(listSub.status, 200);
    assert.equal(Array.isArray(listSubBody.items), true);
    assert.equal(listSubBody.items.length, 1);

    const subServerId = listSubBody.items[0].id;
    const listFiles = await fetch(
      `${app.baseUrl}/api/server/subservers/files?subServerId=${encodeURIComponent(subServerId)}`,
      { headers: authHeaders() }
    );
    const listFilesBody = await listFiles.json();
    assert.equal(listFiles.status, 200);
    assert.equal(listFilesBody.files.includes("paper.jar"), true);
    assert.equal(listFilesBody.files.includes("spigot.yml"), true);
    assert.equal(listFilesBody.files.includes("server.properties"), true);

    const readSubProperties = await fetch(
      `${app.baseUrl}/api/server/properties?subServerId=${encodeURIComponent(subServerId)}`,
      { headers: authHeaders() }
    );
    const readSubPropertiesBody = await readSubProperties.json();
    assert.equal(readSubProperties.status, 200);
    assert.equal(readSubPropertiesBody.subServerId, subServerId);
    assert.equal(readSubPropertiesBody.entries["server-port"], "25566");

    const writeSubProperties = await fetch(`${app.baseUrl}/api/server/properties`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        subServerId,
        entries: {
          motd: "Lobby Server",
          "max-players": "50",
        },
      }),
    });
    const writeSubPropertiesBody = await writeSubProperties.json();
    assert.equal(writeSubProperties.status, 200);
    assert.equal(writeSubPropertiesBody.subServerId, subServerId);

    const verifySubPropertiesRaw = await fs.readFile(path.join(createSubBody.subServer.path, "server.properties"), "utf8");
    assert.equal(verifySubPropertiesRaw.includes("motd=Lobby Server"), true);
    assert.equal(verifySubPropertiesRaw.includes("max-players=50"), true);

    const uploadToSub = await fetch(`${app.baseUrl}/api/server/subservers/files/upload`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        subServerId,
        directory: "plugins",
        files: [
          {
            name: "plugin.jar",
            relativePath: "custom/plugin.jar",
            contentBase64: Buffer.from("sub-plugin", "utf8").toString("base64"),
          },
        ],
      }),
    });
    assert.equal(uploadToSub.status, 200);

    const readSubNested = await fetch(
      `${app.baseUrl}/api/server/subservers/files/read?subServerId=${encodeURIComponent(subServerId)}&path=plugins/custom/plugin.jar`,
      {
        headers: authHeaders(),
      }
    );
    const readSubNestedBody = await readSubNested.json();
    assert.equal(readSubNested.status, 200);
    assert.equal(readSubNestedBody.content, "sub-plugin");

    const renameSubNested = await fetch(`${app.baseUrl}/api/server/subservers/files/rename`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        subServerId,
        path: "plugins/custom/plugin.jar",
        newName: "plugin-renamed.jar",
      }),
    });
    const renameSubNestedBody = await renameSubNested.json();
    assert.equal(renameSubNested.status, 200);
    assert.equal(renameSubNestedBody.path, "plugins/custom/plugin-renamed.jar");

    const readSubRenamed = await fetch(
      `${app.baseUrl}/api/server/subservers/files/read?subServerId=${encodeURIComponent(
        subServerId
      )}&path=plugins/custom/plugin-renamed.jar`,
      {
        headers: authHeaders(),
      }
    );
    const readSubRenamedBody = await readSubRenamed.json();
    assert.equal(readSubRenamed.status, 200);
    assert.equal(readSubRenamedBody.content, "sub-plugin");

    const subArchivePath = path.join(dataDir, "sub-archive.zip");
    await createZipFile(subArchivePath, [{ name: "nested/config.yml", content: "sub-extract" }]);
    const subArchiveBytes = await fs.readFile(subArchivePath);

    const uploadSubArchive = await fetch(`${app.baseUrl}/api/server/subservers/files/upload`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        subServerId,
        directory: "plugins/custom",
        files: [
          {
            name: "sub-archive.zip",
            contentBase64: subArchiveBytes.toString("base64"),
          },
        ],
      }),
    });
    assert.equal(uploadSubArchive.status, 200);

    const extractSubArchive = await fetch(`${app.baseUrl}/api/server/subservers/files/batch`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        subServerId,
        action: "extract",
        paths: ["plugins/custom/sub-archive.zip"],
      }),
    });
    assert.equal(extractSubArchive.status, 200);

    const readExtractedSub = await fetch(
      `${app.baseUrl}/api/server/subservers/files/read?subServerId=${encodeURIComponent(
        subServerId
      )}&path=plugins/custom/nested/config.yml`,
      {
        headers: authHeaders(),
      }
    );
    const readExtractedSubBody = await readExtractedSub.json();
    assert.equal(readExtractedSub.status, 200);
    assert.equal(readExtractedSubBody.content, "sub-extract");
  } finally {
    await app.stop();
  }
});

test("api deletes bungeecord sub-server without touching proxy config.yml", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-bungee-delete-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 11 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const createLobby = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    const createLobbyBody = await createLobby.json();
    assert.equal(createLobby.status, 201);

    const createSky = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "sky", version: "1.21.11" }),
    });
    const createSkyBody = await createSky.json();
    assert.equal(createSky.status, 201);

    const deleteResponse = await fetch(
      `${app.baseUrl}/api/server/subservers/${encodeURIComponent(createLobbyBody.subServer.id)}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      }
    );
    const deleteBody = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteBody.ok, true);

    const listSub = await fetch(`${app.baseUrl}/api/server/subservers`, {
      headers: authHeaders(),
    });
    const listSubBody = await listSub.json();
    assert.equal(listSub.status, 200);
    assert.equal(listSubBody.items.length, 1);
    assert.equal(listSubBody.items[0].id, createSkyBody.subServer.id);

    const lobbyExists = await fs
      .access(createLobbyBody.subServer.path)
      .then(() => true)
      .catch(() => false);
    const skyExists = await fs
      .access(createSkyBody.subServer.path)
      .then(() => true)
      .catch(() => false);
    assert.equal(lobbyExists, false);
    assert.equal(skyExists, true);

    const proxyConfigExists = await fs
      .access(path.join(serverDir, "config.yml"))
      .then(() => true)
      .catch(() => false);
    assert.equal(proxyConfigExists, false);

    const createArena = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "arena", version: "1.21.11" }),
    });
    const createArenaBody = await createArena.json();
    assert.equal(createArena.status, 201);
    assert.equal(createArenaBody.subServer.port, 25566);
  } finally {
    await app.stop();
  }
});

test("api searches and downloads plugins for selected source", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-plugins-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    searchPlugins: async ({ source, query, serverVersion }) => [
      {
        source,
        id: "plugin-1",
        title: `Plugin ${query}`,
        description: "plugin fake",
        versions: serverVersion ? [serverVersion] : [],
      },
    ],
    resolvePluginDownload: async ({ source, projectId, serverVersion }) => ({
      fileName: `${source}-${projectId}.jar`,
      downloadUrl: "https://example.com/plugin.jar",
      versionName: serverVersion || "",
      projectUrl: "https://example.com/plugin",
    }),
    getPluginDetails: async ({ source, projectId }) => ({
      title: `Plugin ${projectId}`,
      description: `Descricao completa ${source}:${projectId}`,
      projectUrl: "https://example.com/plugin",
    }),
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "plugin-bytes", "utf8");
      return { bytesWritten: 12 };
    },
  });

  try {
    const searchResponse = await fetch(
      `${app.baseUrl}/api/plugins/search?source=modrinth&query=Essentials&serverVersion=1.21.11`,
      { headers: authHeaders() }
    );
    const searchBody = await searchResponse.json();
    assert.equal(searchResponse.status, 200);
    assert.equal(Array.isArray(searchBody.items), true);
    assert.equal(searchBody.items.length, 1);
    assert.equal(searchBody.items[0].id, "plugin-1");

    const popularResponse = await fetch(`${app.baseUrl}/api/plugins/search?source=modrinth&serverVersion=1.21.11`, {
      headers: authHeaders(),
    });
    const popularBody = await popularResponse.json();
    assert.equal(popularResponse.status, 200);
    assert.equal(Array.isArray(popularBody.items), true);
    assert.equal(popularBody.items.length, 1);

    const detailsResponse = await fetch(
      `${app.baseUrl}/api/plugins/details?source=modrinth&projectId=plugin-1&serverVersion=1.21.11`,
      { headers: authHeaders() }
    );
    const detailsBody = await detailsResponse.json();
    assert.equal(detailsResponse.status, 200);
    assert.equal(detailsBody.description.includes("Descricao completa"), true);

    const downloadResponse = await fetch(`${app.baseUrl}/api/plugins/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        source: "modrinth",
        projectId: "plugin-1",
        serverVersion: "1.21.11",
      }),
    });
    const downloadBody = await downloadResponse.json();
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadBody.ok, true);
    assert.equal(downloadBody.fileName, "modrinth-plugin-1.jar");

    const pluginPath = path.join(serverDir, "plugins", "modrinth-plugin-1.jar");
    const exists = await fs
      .access(pluginPath)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, true);
  } finally {
    await app.stop();
  }
});

test("api installs plugin into selected bungeecord sub-server using sub-server version", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-plugins-bungee-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  let observedSearchVersion = "";
  let observedDownloadVersion = "";
  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    searchPlugins: async ({ source, query, serverVersion }) => {
      observedSearchVersion = String(serverVersion || "");
      return [
        {
          source,
          id: "plugin-sub",
          title: `Plugin ${query || "popular"}`,
          description: "plugin sub fake",
          versions: serverVersion ? [serverVersion] : [],
        },
      ];
    },
    resolvePluginDownload: async ({ source, projectId, serverVersion }) => {
      observedDownloadVersion = String(serverVersion || "");
      return {
        fileName: `${source}-${projectId}.jar`,
        downloadUrl: "https://example.com/plugin-sub.jar",
        versionName: serverVersion || "",
        projectUrl: "https://example.com/plugin-sub",
      };
    },
    getPluginDetails: async ({ source, projectId }) => ({
      title: `Plugin ${projectId}`,
      description: `Descricao completa ${source}:${projectId}`,
      projectUrl: "https://example.com/plugin-sub",
    }),
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bytes", "utf8");
      return { bytesWritten: 5 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 9 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const createSub = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    const createSubBody = await createSub.json();
    assert.equal(createSub.status, 201);
    const subServerId = createSubBody.subServer.id;
    const subServerPath = createSubBody.subServer.path;

    const searchResponse = await fetch(
      `${app.baseUrl}/api/plugins/search?source=modrinth&query=Lobby&subServerId=${encodeURIComponent(subServerId)}`,
      { headers: authHeaders() }
    );
    const searchBody = await searchResponse.json();
    assert.equal(searchResponse.status, 200);
    assert.equal(Array.isArray(searchBody.items), true);
    assert.equal(observedSearchVersion, "1.21.11");

    const downloadResponse = await fetch(`${app.baseUrl}/api/plugins/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        source: "modrinth",
        projectId: "plugin-sub",
        subServerId,
      }),
    });
    const downloadBody = await downloadResponse.json();
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadBody.ok, true);
    assert.equal(downloadBody.subServerId, subServerId);
    assert.equal(observedDownloadVersion, "1.21.11");

    const subPluginPath = path.join(subServerPath, "plugins", "modrinth-plugin-sub.jar");
    const rootPluginPath = path.join(serverDir, "plugins", "modrinth-plugin-sub.jar");
    const existsInSubServer = await fs
      .access(subPluginPath)
      .then(() => true)
      .catch(() => false);
    const existsInProxyRoot = await fs
      .access(rootPluginPath)
      .then(() => true)
      .catch(() => false);
    assert.equal(existsInSubServer, true);
    assert.equal(existsInProxyRoot, false);
  } finally {
    await app.stop();
  }
});

test("api controls server power and console", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-console-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const fakeRuntime = {
    state: "offline",
    commands: [],
    logs: [],
    async start() {
      this.state = "running";
      this.logs.push("[INFO] Server started");
      return this.getStatus();
    },
    async stop() {
      this.state = "offline";
      this.logs.push("[INFO] Server stopped");
      return this.getStatus();
    },
    async restart() {
      this.state = "running";
      this.logs.push("[INFO] Server restarted");
      return this.getStatus();
    },
    getStatus() {
      return { state: this.state, pid: this.state === "running" ? 9999 : null };
    },
    sendCommand(command) {
      this.commands.push(command);
      this.logs.push(`[CMD] ${command}`);
    },
    getConsoleLines() {
      return [...this.logs];
    },
  };

  const { app, authHeaders } = await setupApp({ dataDir, serverDir, runtimeManager: fakeRuntime });
  try {
    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(startResponse.status, 200);

    const commandResponse = await fetch(`${app.baseUrl}/api/server/command`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ command: "say Dreamy" }),
    });
    assert.equal(commandResponse.status, 200);

    const consoleResponse = await fetch(`${app.baseUrl}/api/server/console`, {
      headers: authHeaders(),
    });
    const consoleBody = await consoleResponse.json();
    assert.equal(consoleResponse.status, 200);
    assert.equal(consoleBody.lines.some((line) => line.includes("Dreamy")), true);

    const statusResponse = await fetch(`${app.baseUrl}/api/server/status`, {
      headers: authHeaders(),
    });
    const statusBody = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.state, "running");
  } finally {
    await app.stop();
  }
});

test("api groups debug errors by console session with timestamps", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-debug-logs-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const fakeRuntime = {
    state: "offline",
    logs: [],
    async start() {
      this.state = "running";
      this.logs.push("[INFO] Server boot");
      this.logs.push("[ERR] Failed to bind test port");
      return this.getStatus();
    },
    async stop() {
      this.state = "offline";
      this.logs.push("[ERR] Exception while stopping");
      return this.getStatus();
    },
    async restart() {
      await this.stop();
      return this.start();
    },
    getStatus() {
      return { state: this.state, pid: this.state === "running" ? 7777 : null };
    },
    sendCommand(command) {
      this.logs.push(`[CMD] ${command}`);
      this.logs.push("[OUT] java.lang.RuntimeException: synthetic crash");
    },
    getConsoleLines() {
      return [...this.logs];
    },
  };

  const { app, authHeaders } = await setupApp({ dataDir, serverDir, runtimeManager: fakeRuntime });
  try {
    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(startResponse.status, 200);

    const commandResponse = await fetch(`${app.baseUrl}/api/server/command`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ command: "debug-crash" }),
    });
    assert.equal(commandResponse.status, 200);

    const stopResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "stop" }),
    });
    assert.equal(stopResponse.status, 200);

    const debugResponse = await fetch(`${app.baseUrl}/api/server/debug/logs`, {
      headers: authHeaders(),
    });
    const debugBody = await debugResponse.json();
    assert.equal(debugResponse.status, 200);
    assert.equal(Array.isArray(debugBody.targets), true);

    const mainTarget = debugBody.targets.find((target) => target.targetType === "main");
    assert.equal(Boolean(mainTarget), true);
    assert.equal(Array.isArray(mainTarget.sessions), true);
    assert.equal(mainTarget.sessions.length > 0, true);
    assert.equal(typeof mainTarget.sessions[0].startedAt, "string");
    assert.equal(typeof mainTarget.sessions[0].stoppedAt, "string");

    const allErrors = mainTarget.sessions.flatMap((session) => session.errors || []);
    assert.equal(allErrors.length >= 3, true);
    assert.equal(allErrors.some((entry) => String(entry.line || "").includes("Failed to bind")), true);
    assert.equal(allErrors.some((entry) => String(entry.line || "").includes("RuntimeException")), true);
    assert.equal(allErrors.some((entry) => String(entry.line || "").includes("Exception while stopping")), true);
  } finally {
    await app.stop();
  }
});

test("api routes bungeecord console and command to selected target", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-bungee-console-target-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const runtimes = new Map();
  function getRuntime(label) {
    if (runtimes.has(label)) {
      return runtimes.get(label);
    }
    const runtime = {
      state: "offline",
      commands: [],
      async start() {
        this.state = "running";
        return this.getStatus();
      },
      async stop() {
        this.state = "offline";
        return this.getStatus();
      },
      async restart() {
        await this.stop();
        return this.start();
      },
      getStatus() {
        return { state: this.state, pid: this.state === "running" ? 4100 : null };
      },
      sendCommand(command) {
        this.commands.push(command);
      },
      getConsoleLines() {
        return [`[${label}] ready`];
      },
    };
    runtimes.set(label, runtime);
    return runtime;
  }

  const runtimeManager = ({ serverRole, subServer }) =>
    serverRole === "subserver" ? getRuntime(`sub:${subServer.name}`) : getRuntime("proxy");

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    runtimeManager,
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 11 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const createSub = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    const createSubBody = await createSub.json();
    assert.equal(createSub.status, 201);
    const subServerId = createSubBody.subServer.id;

    const targetConsole = await fetch(
      `${app.baseUrl}/api/server/console?subServerId=${encodeURIComponent(subServerId)}`,
      {
        headers: authHeaders(),
      }
    );
    const targetConsoleBody = await targetConsole.json();
    assert.equal(targetConsole.status, 200);
    assert.equal(targetConsoleBody.targetType, "subserver");
    assert.equal(targetConsoleBody.targetId, subServerId);
    assert.equal(targetConsoleBody.lines.some((line) => line.includes("sub:lobby")), true);

    const sendSubCommand = await fetch(`${app.baseUrl}/api/server/command`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ command: "say sub", subServerId }),
    });
    assert.equal(sendSubCommand.status, 200);
    assert.equal(getRuntime("sub:lobby").commands.includes("say sub"), true);
    assert.equal(getRuntime("proxy").commands.includes("say sub"), false);
  } finally {
    await app.stop();
  }
});

test("api starts bungeecord sub-servers before proxy runtime", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-bungee-power-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const startOrder = [];
  const runtimes = new Map();
  function getRuntime(label) {
    if (runtimes.has(label)) {
      return runtimes.get(label);
    }
    const runtime = {
      state: "offline",
      async start() {
        startOrder.push(label);
        this.state = "running";
        return this.getStatus();
      },
      async stop() {
        this.state = "offline";
        return this.getStatus();
      },
      async restart() {
        await this.stop();
        return this.start();
      },
      getStatus() {
        return { state: this.state, pid: this.state === "running" ? 2001 : null };
      },
      sendCommand() {},
      getConsoleLines() {
        return [];
      },
    };
    runtimes.set(label, runtime);
    return runtime;
  }

  const runtimeManager = ({ serverRole, subServer }) =>
    serverRole === "subserver" ? getRuntime(`sub:${subServer.name}`) : getRuntime("proxy");

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    runtimeManager,
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 11 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const createLobby = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    assert.equal(createLobby.status, 201);

    const createSurvival = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "survival", version: "1.21.11" }),
    });
    assert.equal(createSurvival.status, 201);

    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(startResponse.status, 200);
    assert.deepEqual(startOrder, ["sub:lobby", "sub:survival", "proxy"]);
  } finally {
    await app.stop();
  }
});

test("api starts bungeecord sub-servers before proxy runtime with relative sub-server paths", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-bungee-power-relative-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const startOrder = [];
  const runtimes = new Map();
  function getRuntime(label) {
    if (runtimes.has(label)) {
      return runtimes.get(label);
    }
    const runtime = {
      state: "offline",
      async start() {
        startOrder.push(label);
        this.state = "running";
        return this.getStatus();
      },
      async stop() {
        this.state = "offline";
        return this.getStatus();
      },
      async restart() {
        await this.stop();
        return this.start();
      },
      getStatus() {
        return { state: this.state, pid: this.state === "running" ? 2101 : null };
      },
      sendCommand() {},
      getConsoleLines() {
        return [];
      },
    };
    runtimes.set(label, runtime);
    return runtime;
  }

  const runtimeManager = ({ serverRole, subServer }) =>
    serverRole === "subserver" ? getRuntime(`sub:${subServer.name}`) : getRuntime("proxy");

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    runtimeManager,
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 11 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const createLobby = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    assert.equal(createLobby.status, 201);

    const createSurvival = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "survival", version: "1.21.11" }),
    });
    assert.equal(createSurvival.status, 201);

    const metaPath = path.join(serverDir, ".dsm-server.json");
    const metaRaw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw);
    const subServers = Array.isArray(meta?.bungee?.subServers) ? meta.bungee.subServers : [];
    for (const subServer of subServers) {
      subServer.path = path.relative(serverDir, subServer.path).replace(/\\/g, "/");
    }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");

    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(startResponse.status, 200);
    assert.deepEqual(startOrder, ["sub:lobby", "sub:survival", "proxy"]);
  } finally {
    await app.stop();
  }
});

test("api does not start bungeecord proxy without sub-servers configured", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-bungee-no-subservers-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const startOrder = [];
  const runtimes = new Map();
  function getRuntime(label) {
    if (runtimes.has(label)) {
      return runtimes.get(label);
    }
    const runtime = {
      state: "offline",
      async start() {
        startOrder.push(label);
        this.state = "running";
        return this.getStatus();
      },
      async stop() {
        this.state = "offline";
        return this.getStatus();
      },
      async restart() {
        await this.stop();
        return this.start();
      },
      getStatus() {
        return { state: this.state, pid: this.state === "running" ? 2201 : null };
      },
      sendCommand() {},
      getConsoleLines() {
        return [];
      },
    };
    runtimes.set(label, runtime);
    return runtime;
  }

  const runtimeManager = ({ serverRole, subServer }) =>
    serverRole === "subserver" ? getRuntime(`sub:${subServer.name}`) : getRuntime("proxy");

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    runtimeManager,
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    const startBody = await startResponse.json();
    assert.equal(startResponse.status, 500);
    assert.equal(String(startBody.error || "").includes("No sub-servers configured"), true);
    assert.deepEqual(startOrder, []);
  } finally {
    await app.stop();
  }
});

test("api preserves manual proxy config responsibility after sub-server file deletions", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-bungee-reconcile-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const startOrder = [];
  const runtimes = new Map();
  function getRuntime(label) {
    if (runtimes.has(label)) {
      return runtimes.get(label);
    }
    const runtime = {
      state: "offline",
      async start() {
        startOrder.push(label);
        this.state = "running";
        return this.getStatus();
      },
      async stop() {
        this.state = "offline";
        return this.getStatus();
      },
      async restart() {
        await this.stop();
        return this.start();
      },
      getStatus() {
        return { state: this.state, pid: this.state === "running" ? 3001 : null };
      },
      sendCommand() {},
      getConsoleLines() {
        return [];
      },
    };
    runtimes.set(label, runtime);
    return runtime;
  }

  const runtimeManager = ({ serverRole, subServer }) =>
    serverRole === "subserver" ? getRuntime(`sub:${subServer.name}`) : getRuntime("proxy");

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    runtimeManager,
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 11 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const createLobby = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    const createLobbyBody = await createLobby.json();
    assert.equal(createLobby.status, 201);

    const createSurvival = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "survival", version: "1.21.11" }),
    });
    const createSurvivalBody = await createSurvival.json();
    assert.equal(createSurvival.status, 201);

    await fs.rm(createLobbyBody.subServer.path, { recursive: true, force: true });
    await fs.rm(path.join(serverDir, "config.yml"), { force: true });
    await fs.rm(path.join(createSurvivalBody.subServer.path, "server.properties"), { force: true });
    await fs.rm(path.join(createSurvivalBody.subServer.path, "spigot.yml"), { force: true });

    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(startResponse.status, 200);
    assert.deepEqual(startOrder, ["sub:survival", "proxy"]);

    const proxyConfigExists = await fs
      .access(path.join(serverDir, "config.yml"))
      .then(() => true)
      .catch(() => false);
    assert.equal(proxyConfigExists, false);

    const recreatedProperties = await fs.readFile(path.join(createSurvivalBody.subServer.path, "server.properties"), "utf8");
    assert.equal(recreatedProperties.includes("server-port=25567"), true);
    assert.equal(recreatedProperties.includes("server-ip=127.0.0.1"), true);

    const recreatedSpigot = await fs.readFile(path.join(createSurvivalBody.subServer.path, "spigot.yml"), "utf8");
    assert.equal(recreatedSpigot.includes("bungeecord: true"), true);

    const listSubServers = await fetch(`${app.baseUrl}/api/server/subservers`, {
      headers: authHeaders(),
    });
    const listSubServersBody = await listSubServers.json();
    assert.equal(listSubServers.status, 200);
    assert.equal(listSubServersBody.items.length, 1);
    assert.equal(listSubServersBody.items[0].id, createSurvivalBody.subServer.id);
  } finally {
    await app.stop();
  }
});

test("api backs up legacy world players directory for bungeecord sub-servers", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-bungee-legacy-players-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const startOrder = [];
  const runtimes = new Map();
  function getRuntime(label) {
    if (runtimes.has(label)) {
      return runtimes.get(label);
    }
    const runtime = {
      state: "offline",
      async start() {
        startOrder.push(label);
        this.state = "running";
        return this.getStatus();
      },
      async stop() {
        this.state = "offline";
        return this.getStatus();
      },
      async restart() {
        await this.stop();
        return this.start();
      },
      getStatus() {
        return { state: this.state, pid: this.state === "running" ? 3101 : null };
      },
      sendCommand() {},
      getConsoleLines() {
        return [];
      },
    };
    runtimes.set(label, runtime);
    return runtime;
  }

  const runtimeManager = ({ serverRole, subServer }) =>
    serverRole === "subserver" ? getRuntime(`sub:${subServer.name}`) : getRuntime("proxy");

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    runtimeManager,
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 11 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const createSub = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    const createSubBody = await createSub.json();
    assert.equal(createSub.status, 201);
    const subPath = createSubBody.subServer.path;

    await fs.mkdir(path.join(subPath, "world", "playerdata"), { recursive: true });
    await fs.mkdir(path.join(subPath, "world", "players"), { recursive: true });
    await fs.writeFile(path.join(subPath, "world", "players", "OldPlayer.dat"), "legacy", "utf8");

    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(startResponse.status, 200);
    assert.deepEqual(startOrder, ["sub:lobby", "proxy"]);

    const worldEntries = await fs.readdir(path.join(subPath, "world"));
    assert.equal(worldEntries.includes("players"), false);
    const backupDirName = worldEntries.find((name) => name.startsWith("players.dsm-legacy-backup-"));
    assert.equal(Boolean(backupDirName), true);
    const backupFile = await fs.readFile(path.join(subPath, "world", backupDirName, "OldPlayer.dat"), "utf8");
    assert.equal(backupFile, "legacy");
  } finally {
    await app.stop();
  }
});

test("api exposes machine stats and server directory size", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-stats-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.writeFile(path.join(serverDir, "a.txt"), "12345", "utf8");

  const { app, authHeaders } = await setupApp({ dataDir, serverDir });
  try {
    const response = await fetch(`${app.baseUrl}/api/system/stats`, {
      headers: authHeaders(),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof body.cpuUsagePercent, "number");
    assert.equal(typeof body.memoryUsagePercent, "number");
    assert.equal(typeof body.serverMemoryBytes, "number");
    assert.equal(typeof body.serverMemoryGb, "number");
    assert.equal(typeof body.runtimeProcessCount, "number");
    assert.equal(body.serverDirectorySizeBytes >= 5, true);
  } finally {
    await app.stop();
  }
});

test("api system stats aggregates bungeecord proxy and sub-servers", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-stats-bungee-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const runtimes = new Map();
  function getRuntime(label) {
    if (runtimes.has(label)) {
      return runtimes.get(label);
    }
    const runtime = {
      state: "offline",
      async start() {
        this.state = "running";
        return this.getStatus();
      },
      async stop() {
        this.state = "offline";
        return this.getStatus();
      },
      async restart() {
        await this.stop();
        return this.start();
      },
      getStatus() {
        return { state: this.state, pid: this.state === "running" ? process.pid : null };
      },
      sendCommand() {},
      getConsoleLines() {
        return [];
      },
    };
    runtimes.set(label, runtime);
    return runtime;
  }

  const runtimeManager = ({ serverRole, subServer }) =>
    serverRole === "subserver" ? getRuntime(`sub:${subServer.name}`) : getRuntime("proxy");

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    runtimeManager,
    downloadBinary: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, "bungee-jar", "utf8");
      return { bytesWritten: 10 };
    },
    downloadPaperVersion: async ({ destinationPath, version }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, `paper-${version}`, "utf8");
      return { bytesWritten: 11 };
    },
  });

  try {
    const installBungee = await fetch(`${app.baseUrl}/api/paper/download`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ serverKind: "bungeecord", version: "ignored" }),
    });
    assert.equal(installBungee.status, 200);

    const createLobby = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "lobby", version: "1.21.11" }),
    });
    assert.equal(createLobby.status, 201);

    const createSky = await fetch(`${app.baseUrl}/api/server/subservers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "sky", version: "1.21.11" }),
    });
    assert.equal(createSky.status, 201);

    const startResponse = await fetch(`${app.baseUrl}/api/server/power`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(startResponse.status, 200);

    const statsResponse = await fetch(`${app.baseUrl}/api/system/stats`, {
      headers: authHeaders(),
    });
    const statsBody = await statsResponse.json();
    assert.equal(statsResponse.status, 200);
    assert.equal(statsBody.runtimeProcessCount, 3);
    assert.equal(typeof statsBody.cpuUsagePercent, "number");
    assert.equal(typeof statsBody.serverMemoryBytes, "number");
  } finally {
    await app.stop();
  }
});

test("api reads and writes server.properties entries", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-props-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });
  await fs.writeFile(path.join(serverDir, "server.properties"), "motd=Hello\nmax-players=20\n", "utf8");

  const { app, authHeaders } = await setupApp({ dataDir, serverDir });
  try {
    const getResponse = await fetch(`${app.baseUrl}/api/server/properties`, {
      headers: authHeaders(),
    });
    const getBody = await getResponse.json();
    assert.equal(getResponse.status, 200);
    assert.equal(getBody.entries.motd, "Hello");

    const setResponse = await fetch(`${app.baseUrl}/api/server/properties`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        entries: {
          motd: "Dreamy Network",
          "max-players": "100",
        },
      }),
    });
    assert.equal(setResponse.status, 200);

    const verifyResponse = await fetch(`${app.baseUrl}/api/server/properties`, {
      headers: authHeaders(),
    });
    const verifyBody = await verifyResponse.json();
    assert.equal(verifyBody.entries["max-players"], "100");
  } finally {
    await app.stop();
  }
});

test("api java manager reports and installs required java runtime", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-java-manager-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    downloadBinary: async ({ url, destinationPath }) => {
      const match = String(url || "").match(/\/latest\/(\d+)\/ga\//i);
      const major = Number(match?.[1] || 17);
      const javaBin = process.platform === "win32" ? "java.exe" : "java";
      await createZipFile(destinationPath, [{ name: `jdk-${major}/bin/${javaBin}`, content: `java-${major}` }]);
      const stat = await fs.stat(destinationPath);
      return { bytesWritten: stat.size };
    },
  });

  try {
    const statusBeforeResponse = await fetch(`${app.baseUrl}/api/java/manager/status`, {
      headers: authHeaders(),
    });
    const statusBeforeBody = await statusBeforeResponse.json();
    assert.equal(statusBeforeResponse.status, 200);
    assert.equal(statusBeforeBody.managerEnabled, true);
    assert.equal(Array.isArray(statusBeforeBody.requirements.requiredMajors), true);
    assert.equal(statusBeforeBody.requirements.requiredMajors.includes(17), true);

    const installResponse = await fetch(`${app.baseUrl}/api/java/manager/install`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ major: 17 }),
    });
    const installBody = await installResponse.json();
    assert.equal(installResponse.status, 200);
    assert.equal(installBody.ok, true);
    assert.equal(Array.isArray(installBody.installed), true);
    assert.equal(installBody.installed[0].major, 17);
    assert.equal(String(installBody.installed[0].javaPath || "").length > 0, true);

    const statusAfterResponse = await fetch(`${app.baseUrl}/api/java/manager/status`, {
      headers: authHeaders(),
    });
    const statusAfterBody = await statusAfterResponse.json();
    assert.equal(statusAfterResponse.status, 200);
    assert.equal(statusAfterBody.missingMajors.includes(17), false);

    const installMissingResponse = await fetch(`${app.baseUrl}/api/java/manager/install`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ installMissing: true }),
    });
    const installMissingBody = await installMissingResponse.json();
    assert.equal(installMissingResponse.status, 200);
    assert.equal(installMissingBody.ok, true);
  } finally {
    await app.stop();
  }
});

test("api java manager installs Java through Termux pkg on Android", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-java-termux-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(serverDir, { recursive: true });

  let javaInstalled = false;
  const commands = [];
  const commandRunner = async (command, args = []) => {
    commands.push([command, ...args].join(" "));
    if (command === "sh" && args.join(" ") === "-c command -v java") {
      if (!javaInstalled) {
        const error = new Error("java not found");
        error.code = 127;
        throw error;
      }
      return { stdout: "/data/data/com.termux/files/usr/bin/java\n", stderr: "" };
    }
    if (command === "sh" && args.join(" ") === "-c command -v pkg") {
      return { stdout: "/data/data/com.termux/files/usr/bin/pkg\n", stderr: "" };
    }
    if (command === "pkg" && args.join(" ") === "install -y openjdk-21") {
      javaInstalled = true;
      return { stdout: "installed openjdk-21\n", stderr: "" };
    }
    if (command === "/data/data/com.termux/files/usr/bin/java" && args.join(" ") === "-version") {
      return { stdout: "", stderr: 'openjdk version "21.0.7" 2026-04-15\n' };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };

  const { app, authHeaders } = await setupApp({
    dataDir,
    serverDir,
    commandRunner,
    runtimePlatform: "android",
    runtimeArch: "arm64",
    runtimeEnv: { PREFIX: "/data/data/com.termux/files/usr" },
  });

  try {
    const installResponse = await fetch(`${app.baseUrl}/api/java/manager/install`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ major: 21 }),
    });
    const installBody = await installResponse.json();
    assert.equal(installResponse.status, 200);
    assert.equal(installBody.ok, true);
    assert.equal(installBody.installed[0].javaPath, "/data/data/com.termux/files/usr/bin/java");
    assert.equal(installBody.installed[0].installedMajor, 21);
    assert.equal(commands.includes("pkg install -y openjdk-21"), true);

    const statusResponse = await fetch(`${app.baseUrl}/api/java/manager/status`, {
      headers: authHeaders(),
    });
    const statusBody = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.installed.find((item) => item.major === 21).packageManager, "termux");
  } finally {
    await app.stop();
  }
});

test("api supports file upload, read/write and batch operations", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-fileops-"));
  const serverDir = path.join(dataDir, "server");
  await fs.mkdir(path.join(serverDir, "plugins"), { recursive: true });
  const archivePath = path.join(dataDir, "plugins-extract.zip");
  await createZipFile(archivePath, [{ name: "unzipped/readme.txt", content: "from-zip" }]);
  const archiveBytes = await fs.readFile(archivePath);

  const { app, authHeaders } = await setupApp({ dataDir, serverDir });
  try {
    const uploadResponse = await fetch(`${app.baseUrl}/api/server/files/upload`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        directory: "plugins",
        files: [
          {
            name: "A.txt",
            contentBase64: Buffer.from("alpha", "utf8").toString("base64"),
          },
          {
            name: "B.txt",
            contentBase64: Buffer.from("beta", "utf8").toString("base64"),
          },
          {
            name: "region.txt",
            relativePath: "world/region/region.txt",
            contentBase64: Buffer.from("nested", "utf8").toString("base64"),
          },
          {
            name: "bundle.zip",
            contentBase64: archiveBytes.toString("base64"),
          },
        ],
      }),
    });
    assert.equal(uploadResponse.status, 200);

    const readResponse = await fetch(`${app.baseUrl}/api/server/files/read?path=plugins/A.txt`, {
      headers: authHeaders(),
    });
    const readBody = await readResponse.json();
    assert.equal(readBody.content, "alpha");

    const nestedReadResponse = await fetch(`${app.baseUrl}/api/server/files/read?path=plugins/world/region/region.txt`, {
      headers: authHeaders(),
    });
    const nestedReadBody = await nestedReadResponse.json();
    assert.equal(nestedReadResponse.status, 200);
    assert.equal(nestedReadBody.content, "nested");

    const writeResponse = await fetch(`${app.baseUrl}/api/server/files/write`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ path: "plugins/A.txt", content: "alpha-updated" }),
    });
    assert.equal(writeResponse.status, 200);

    const renameResponse = await fetch(`${app.baseUrl}/api/server/files/rename`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ path: "plugins/A.txt", newName: "A-renamed.txt" }),
    });
    const renameBody = await renameResponse.json();
    assert.equal(renameResponse.status, 200);
    assert.equal(renameBody.path, "plugins/A-renamed.txt");

    const copyResponse = await fetch(`${app.baseUrl}/api/server/files/batch`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        action: "copy",
        paths: ["plugins/A-renamed.txt", "plugins/B.txt"],
        destinationDirectory: "",
      }),
    });
    assert.equal(copyResponse.status, 200);

    const moveResponse = await fetch(`${app.baseUrl}/api/server/files/batch`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        action: "move",
        paths: ["A-renamed.txt"],
        destinationDirectory: "plugins",
      }),
    });
    assert.equal(moveResponse.status, 200);

    const deleteResponse = await fetch(`${app.baseUrl}/api/server/files/batch`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        action: "delete",
        paths: ["plugins/B.txt"],
      }),
    });
    assert.equal(deleteResponse.status, 200);

    const extractResponse = await fetch(`${app.baseUrl}/api/server/files/batch`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({
        action: "extract",
        paths: ["plugins/bundle.zip"],
      }),
    });
    assert.equal(extractResponse.status, 200);

    const extractedReadResponse = await fetch(`${app.baseUrl}/api/server/files/read?path=plugins/unzipped/readme.txt`, {
      headers: authHeaders(),
    });
    const extractedReadBody = await extractedReadResponse.json();
    assert.equal(extractedReadResponse.status, 200);
    assert.equal(extractedReadBody.content, "from-zip");

    const listingResponse = await fetch(`${app.baseUrl}/api/server/files?directory=plugins`, {
      headers: authHeaders(),
    });
    const listingBody = await listingResponse.json();
    assert.equal(listingBody.files.includes("plugins/A-renamed.txt"), true);
    assert.equal(listingBody.files.includes("plugins/B.txt"), false);

    const downloadResponse = await fetch(`${app.baseUrl}/api/server/files/download?path=plugins/A-renamed.txt`, {
      headers: authHeaders(),
    });
    assert.equal(downloadResponse.status, 200);
    const downloadedText = await downloadResponse.text();
    assert.equal(downloadedText, "alpha-updated");
  } finally {
    await app.stop();
  }
});

test("admin can manage users and server limits are enforced", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-admin-"));
  const { app, authHeaders } = await setupApp({ dataDir });
  try {
    const createUserResponse = await fetch(`${app.baseUrl}/api/admin/users`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ username: "user1", password: "pass1", maxServers: 1 }),
    });
    assert.equal(createUserResponse.status, 201);

    const loginUserResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "user1", password: "pass1" }),
    });
    const loginUserBody = await loginUserResponse.json();
    assert.equal(loginUserResponse.status, 200);

    const userToken = loginUserBody.token;
    const userHeaders = (extra = {}) => ({
      authorization: `Bearer ${userToken}`,
      ...extra,
    });

    const createServer1 = await fetch(`${app.baseUrl}/api/home/servers`, {
      method: "POST",
      headers: { ...userHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "Meu Server 1" }),
    });
    assert.equal(createServer1.status, 201);

    const createServer2 = await fetch(`${app.baseUrl}/api/home/servers`, {
      method: "POST",
      headers: { ...userHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "Meu Server 2" }),
    });
    assert.equal(createServer2.status, 500);
  } finally {
    await app.stop();
  }
});

test("user can delete own server", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsm-api-delete-server-"));
  const { app, authHeaders } = await setupApp({ dataDir });
  try {
    const createResponse = await fetch(`${app.baseUrl}/api/home/servers`, {
      method: "POST",
      headers: { ...authHeaders({ "content-type": "application/json" }) },
      body: JSON.stringify({ name: "Server Temporario" }),
    });
    assert.equal(createResponse.status, 201);
    const createBody = await createResponse.json();
    const createdServer = createBody.server;
    assert.equal(typeof createdServer.id, "string");

    const deleteResponse = await fetch(`${app.baseUrl}/api/home/servers/${encodeURIComponent(createdServer.id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(deleteResponse.status, 200);
    const deleteBody = await deleteResponse.json();
    assert.equal(deleteBody.deleted, true);

    const listResponse = await fetch(`${app.baseUrl}/api/home/servers`, {
      headers: authHeaders(),
    });
    const listBody = await listResponse.json();
    assert.equal(listBody.servers.some((server) => server.id === createdServer.id), false);

    const deletedFromDisk = await fs
      .access(createdServer.path)
      .then(() => false)
      .catch(() => true);
    assert.equal(deletedFromDisk, true);
  } finally {
    await app.stop();
  }
});

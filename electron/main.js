const path = require("node:path");
const { app, BrowserWindow, dialog, shell } = require("electron");
const { createServer } = require("../src/server");

let mainWindow = null;
let dsmServer = null;
let isShuttingDown = false;

function getStorageRoot() {
  if (app.isPackaged) {
    return app.getPath("userData");
  }
  return process.cwd();
}

async function startBackend() {
  if (dsmServer) {
    return dsmServer;
  }
  const storageRoot = getStorageRoot();
  dsmServer = createServer({
    dataDir: path.join(storageRoot, "data"),
    serverDir: path.join(storageRoot, "server"),
  });
  await dsmServer.start(3000);
  return dsmServer;
}

async function stopBackend() {
  if (!dsmServer) {
    return;
  }
  await dsmServer.stop();
  dsmServer = null;
}

async function createMainWindow() {
  const backend = await startBackend();
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(backend.baseUrl);
}

function registerCrashHandlers() {
  process.on("uncaughtException", (error) => {
    const message = error?.stack || error?.message || String(error);
    dialog.showErrorBox("Erro inesperado no DSM", message);
  });

  process.on("unhandledRejection", (reason) => {
    const message = reason?.stack || reason?.message || String(reason);
    dialog.showErrorBox("Promessa não tratada no DSM", message);
  });
}

app.whenReady().then(async () => {
  registerCrashHandlers();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  event.preventDefault();
  stopBackend()
    .catch((error) => {
      const message = error?.stack || error?.message || String(error);
      dialog.showErrorBox("Falha ao encerrar DSM", message);
    })
    .finally(() => {
      app.exit(0);
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

# Electron Portable Executable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Dreamy Server Manager as one portable Windows `.exe` that stores all persistent application data beside the executable.

**Architecture:** Put storage-path selection in a pure CommonJS helper so it can be tested without loading Electron. The Electron main process will create that root, start the existing loopback backend on a Windows-assigned free port, and load its URL. Electron Builder will use its official `portable` target and expose `PORTABLE_EXECUTABLE_DIR` to locate the executable directory.

**Tech Stack:** Node.js CommonJS, Electron 31, Electron Builder 24, `node:test`, PowerShell

---

## File Structure

- Create `electron/portable-paths.js`: pure packaged/development storage-root resolution.
- Create `tests/electron-portable.test.js`: path-resolution and dynamic loopback-port coverage.
- Modify `electron/main.js`: initialize portable storage, request port `0`, and terminate cleanly after startup failure.
- Modify `package.json`: switch the Windows artifact from NSIS installer to portable x64 executable.
- Modify `README.md`: document desktop development and portable build commands and data location.

### Task 1: Portable Storage Path Resolver

**Files:**
- Create: `electron/portable-paths.js`
- Create: `tests/electron-portable.test.js`

- [ ] **Step 1: Write failing path-resolution tests**

Create `tests/electron-portable.test.js` with development, Electron Builder environment, and packaged fallback cases:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveStorageRoot } = require("../electron/portable-paths");

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
```

- [ ] **Step 2: Run the path tests and verify failure**

Run: `node --test --test-isolation=none tests/electron-portable.test.js`

Expected: FAIL with `Cannot find module '../electron/portable-paths'`.

- [ ] **Step 3: Implement the pure resolver**

Create `electron/portable-paths.js`:

```js
const path = require("node:path");

const PORTABLE_DATA_DIRECTORY_NAME = "Dreamy Server Manager Data";

function resolveStorageRoot({
  isPackaged,
  cwd = process.cwd(),
  execPath = process.execPath,
  portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR,
} = {}) {
  if (!isPackaged) {
    return path.resolve(cwd);
  }

  const executableDirectory = portableExecutableDir
    ? path.resolve(portableExecutableDir)
    : path.dirname(path.resolve(execPath));
  return path.join(executableDirectory, PORTABLE_DATA_DIRECTORY_NAME);
}

module.exports = {
  PORTABLE_DATA_DIRECTORY_NAME,
  resolveStorageRoot,
};
```

- [ ] **Step 4: Run the path tests and verify success**

Run: `node --test --test-isolation=none tests/electron-portable.test.js`

Expected: 3 tests pass.

- [ ] **Step 5: Commit the resolver**

```powershell
git add -- electron/portable-paths.js tests/electron-portable.test.js
git commit -m "Add portable Electron storage paths"
```

### Task 2: Dynamic Loopback Backend Startup

**Files:**
- Modify: `tests/electron-portable.test.js`
- Modify: `electron/main.js`

- [ ] **Step 1: Write a failing desktop backend startup test**

Append this test and its required imports to `tests/electron-portable.test.js`:

```js
const os = require("node:os");
const fs = require("node:fs/promises");
const { createServer } = require("../src/server");

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
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    await backend.stop();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused tests and establish backend behavior**

Run: `node --test --test-isolation=none tests/electron-portable.test.js`

Expected: all 4 tests pass, proving the existing backend already supports a free loopback port. The Electron integration remains incomplete because `electron/main.js` still requests fixed port `3000` and uses Electron `userData` when packaged.

- [ ] **Step 3: Connect portable storage and port allocation to Electron**

Update the imports and startup functions in `electron/main.js` to use the resolver, create the storage root, and request a free loopback port:

```js
const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog, shell } = require("electron");
const { createServer } = require("../src/server");
const { resolveStorageRoot } = require("./portable-paths");

async function startBackend() {
  if (dsmServer) {
    return dsmServer;
  }

  const storageRoot = resolveStorageRoot({ isPackaged: app.isPackaged });
  await fs.mkdir(storageRoot, { recursive: true });
  dsmServer = createServer({
    dataDir: path.join(storageRoot, "data"),
    serverDir: path.join(storageRoot, "server"),
  });
  await dsmServer.start(0, "127.0.0.1");
  return dsmServer;
}
```

Remove the old `getStorageRoot()` function.

- [ ] **Step 4: Handle startup failure explicitly**

Replace the unguarded ready callback with a helper that displays the error and exits:

```js
async function startDesktop() {
  registerCrashHandlers();
  try {
    await createMainWindow();
  } catch (error) {
    const message = error?.stack || error?.message || String(error);
    dialog.showErrorBox("Falha ao iniciar DSM", message);
    app.exit(1);
  }
}

app.whenReady().then(startDesktop);
```

Keep the existing `activate`, `before-quit`, and `window-all-closed` behavior, placing the `activate` listener inside `startDesktop()` after successful window creation.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-isolation=none tests/electron-portable.test.js`

Expected: 4 tests pass.

Run: `npm test`

Expected: complete suite passes with zero failures.

- [ ] **Step 6: Commit Electron startup changes**

```powershell
git add -- electron/main.js tests/electron-portable.test.js
git commit -m "Use portable data and dynamic desktop port"
```

### Task 3: Portable Build Configuration And Documentation

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add a configuration assertion**

Append this test to `tests/electron-portable.test.js`:

```js
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
```

- [ ] **Step 2: Run the configuration test and verify failure**

Run: `node --test --test-isolation=none tests/electron-portable.test.js`

Expected: FAIL because `dist:win` and `build.win.target` still use `nsis`.

- [ ] **Step 3: Configure the portable artifact**

Change the relevant `package.json` values to:

```json
{
  "scripts": {
    "dist:win": "electron-builder --win portable"
  },
  "build": {
    "win": {
      "signAndEditExecutable": false,
      "artifactName": "Dreamy Server Manager.${ext}",
      "target": [
        {
          "target": "portable",
          "arch": ["x64"]
        }
      ]
    },
    "portable": {
      "requestExecutionLevel": "user"
    }
  }
}
```

Remove the obsolete `nsis` block. Preserve every unrelated package field and dependency.

- [ ] **Step 4: Document desktop usage**

Add a `Desktop Electron` section to `README.md` containing:

````markdown
## Desktop Electron

Para abrir em modo de desenvolvimento:

```powershell
npm run desktop
```

Para gerar o executavel portatil de Windows x64:

```powershell
npm run dist:win
```

O arquivo final fica em `dist-electron/Dreamy Server Manager.exe`. Ao abrir, o DSM cria `Dreamy Server Manager Data` ao lado do executavel para guardar contas, configuracoes, servidores e Java gerenciado. Mova o `.exe` e essa pasta juntos para preservar os dados.
````

- [ ] **Step 5: Run focused tests and validate package syntax**

Run: `node --test --test-isolation=none tests/electron-portable.test.js`

Expected: 5 tests pass.

Run: `node -e "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')); console.log('package.json ok')"`

Expected: prints `package.json ok`.

- [ ] **Step 6: Commit build configuration**

```powershell
git add -- package.json README.md tests/electron-portable.test.js
git commit -m "Configure portable Windows executable"
```

### Task 4: Build And Verify The Portable Executable

**Files:**
- Verify: `dist-electron/Dreamy Server Manager.exe`

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Check source and configuration diffs**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Build the Windows portable executable**

Run: `npm run dist:win`

Expected: Electron Builder completes successfully and creates `dist-electron/Dreamy Server Manager.exe`.

- [ ] **Step 4: Launch the artifact from a clean verification directory**

Copy the artifact into a temporary directory, launch it, and wait for portable storage creation:

```powershell
$verifyDir = Join-Path $env:TEMP 'dsm-portable-verification'
Remove-Item -LiteralPath $verifyDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $verifyDir | Out-Null
Copy-Item -LiteralPath 'dist-electron\Dreamy Server Manager.exe' -Destination $verifyDir
$exe = Join-Path $verifyDir 'Dreamy Server Manager.exe'
$process = Start-Process -FilePath $exe -PassThru
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  $dataPath = Join-Path $verifyDir 'Dreamy Server Manager Data'
} until ((Test-Path -LiteralPath $dataPath) -or (Get-Date) -gt $deadline -or $process.HasExited)
if (-not (Test-Path -LiteralPath $dataPath)) { throw 'Portable data directory was not created' }
if ($process.HasExited) { throw "Portable app exited early with code $($process.ExitCode)" }
Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
Write-Output $dataPath
```

Expected: prints the temporary `Dreamy Server Manager Data` path while the portable process remains running until the verification script closes it.

- [ ] **Step 5: Inspect the final artifact**

Run:

```powershell
Get-Item 'dist-electron\Dreamy Server Manager.exe' | Select-Object FullName, Length, LastWriteTime
git status --short
```

Expected: artifact metadata is displayed. Source files are clean; ignored build output may be absent from Git status.

- [ ] **Step 6: Commit any verification-only documentation correction if required**

If verification required no source correction, do not create an empty commit. If a command or output path in `README.md` was corrected, run:

```powershell
git add -- README.md
git commit -m "Correct portable build documentation"
```

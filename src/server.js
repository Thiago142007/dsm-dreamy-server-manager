const http = require("node:http");
const { execFile } = require("node:child_process");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { promisify } = require("node:util");
const { pipeline } = require("node:stream/promises");
const { URL } = require("node:url");
const archiver = require("archiver");
const unzipper = require("unzipper");
const { createRegistry } = require("./lib/registry");
const { createServerRuntime } = require("./lib/server-runtime");
const {
  MANAGED_JAVA_MAJORS,
  resolveJavaMajorForPaperVersion,
  resolveJavaMajorForServer,
} = require("./lib/java-manager");
const { listPaperVersions, getPaperVersionUrl } = require("./lib/paper-versions");
const { createAccountManager, COWORK_PERMISSION_KEYS } = require("./lib/account-manager");
const {
  searchPlugins: defaultSearchPlugins,
  resolvePluginDownload: defaultResolvePluginDownload,
  getPluginDetails: defaultGetPluginDetails,
} = require("./lib/plugin-sources");

const execFileAsync = promisify(execFile);
const BUNGEECORD_JAR_URL =
  "https://hub.spigotmc.org/jenkins/job/BungeeCord/2064/artifact/bootstrap/target/BungeeCord.jar";
const BUNGEECORD_DOWNLOAD_URL =
  "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar";
const SERVER_EXPORT_FORMAT = "dsm-server-export-v1";

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function textResponse(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function resolveServerPath(serverDir, requestedPath = "") {
  const cleaned = String(requestedPath).replace(/\\/g, "/").replace(/^\/+/, "");
  const absolute = path.resolve(serverDir, cleaned);
  if (absolute !== serverDir && !absolute.startsWith(`${serverDir}${path.sep}`)) {
    throw new Error("Invalid directory path");
  }
  return absolute;
}

function normalizeUploadPath(value) {
  const raw = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  const segments = raw
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== "." && item !== "..");
  return segments.join("/");
}

async function listServerDirectory(serverDir, directory = "") {
  const targetDir = resolveServerPath(serverDir, directory);
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const files = [];
  const directories = [];

  for (const entry of entries) {
    const relative = path.relative(serverDir, path.join(targetDir, entry.name)).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      directories.push(relative);
    } else {
      files.push(relative);
    }
  }

  files.sort();
  directories.sort();
  return { files, directories };
}

async function getDirectorySizeBytes(directoryPath) {
  let entries = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }

  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySizeBytes(fullPath);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      total += stat.size;
    }
  }
  return total;
}

function sanitizeExportFileName(name) {
  const safe = String(name || "servidor")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return safe || "servidor";
}

function normalizeArchiveEntryPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

async function collectServerArchiveEntries(serverDir, relativeDir = "") {
  const archiveEntries = [];
  for await (const entry of iterateServerArchiveEntries(serverDir, relativeDir)) {
    archiveEntries.push(entry);
  }
  return archiveEntries;
}

async function* iterateServerArchiveEntries(serverDir, relativeDir = "") {
  const targetDir = resolveServerPath(serverDir, relativeDir);
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolutePath = path.join(targetDir, entry.name);
    const relativePath = normalizeArchiveEntryPath(path.relative(serverDir, absolutePath));
    if (!relativePath) continue;
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      yield {
        type: "directory",
        path: relativePath,
      };
      yield* iterateServerArchiveEntries(serverDir, relativePath);
      continue;
    }
    if (entry.isFile()) {
      const bytes = await fs.readFile(absolutePath);
      yield {
        type: "file",
        path: relativePath,
        contentBase64: bytes.toString("base64"),
      };
    }
  }
}

async function writeHttpChunk(res, chunk) {
  if (res.writableEnded || res.destroyed) return;
  if (res.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("error", onError);
    };
    res.on("drain", onDrain);
    res.on("error", onError);
  });
}

async function streamServerArchiveJson({ res, serverDir, serverName, serverKind = "paper", paperVersion = "" }) {
  const header = {
    format: SERVER_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    server: {
      name: String(serverName || "Servidor"),
      serverKind: String(serverKind || "paper"),
      paperVersion: String(paperVersion || ""),
    },
  };

  await writeHttpChunk(
    res,
    `{"format":${JSON.stringify(header.format)},"exportedAt":${JSON.stringify(header.exportedAt)},"server":${JSON.stringify(header.server)},"entries":[`
  );

  let firstEntry = true;
  for await (const entry of iterateServerArchiveEntries(serverDir)) {
    const serialized = JSON.stringify(entry);
    await writeHttpChunk(res, firstEntry ? serialized : `,${serialized}`);
    firstEntry = false;
  }
  await writeHttpChunk(res, "]}");
}

function normalizeImportedServerKind(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bungeecord") return "bungeecord";
  if (normalized === "paper") return "paper";
  return "";
}

function normalizeArchiveServerInfo(rawServer) {
  const server = rawServer && typeof rawServer === "object" ? rawServer : {};
  return {
    name: String(server.name || "").trim() || "Servidor Importado",
    serverKind: normalizeImportedServerKind(server.serverKind || server.serverType || ""),
    paperVersion: String(server.paperVersion || "").trim(),
  };
}

function buildArchiveManifest({ serverName, serverKind = "paper", paperVersion = "" }) {
  return {
    format: SERVER_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    server: {
      name: String(serverName || "Servidor"),
      serverKind: normalizeImportedServerKind(serverKind) || "paper",
      paperVersion: String(paperVersion || ""),
    },
  };
}

async function streamServerArchiveZip({ res, serverDir, serverName, serverKind = "paper", paperVersion = "" }) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const manifest = buildArchiveManifest({ serverName, serverKind, paperVersion });

  const completion = new Promise((resolve, reject) => {
    archive.on("warning", (error) => {
      if (error && error.code === "ENOENT") {
        return;
      }
      reject(error);
    });
    archive.on("error", reject);
    res.on("error", reject);
    res.on("finish", resolve);
    res.on("close", resolve);
  });

  archive.pipe(res);
  archive.append(JSON.stringify(manifest, null, 2), { name: "dsm-export.json" });
  archive.directory(serverDir, "server");
  await archive.finalize();
  await completion;
}

function normalizeZipEntryPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function resolveZipRootPrefix(paths = []) {
  const normalizedPaths = paths
    .map((item) => normalizeZipEntryPath(item))
    .filter((item) => item && !item.startsWith("__MACOSX/") && item !== "dsm-export.json");

  if (!normalizedPaths.length) {
    return "";
  }

  const [firstPath] = normalizedPaths;
  const slashIndex = firstPath.indexOf("/");
  if (slashIndex <= 0) {
    return "";
  }

  const firstSegment = firstPath.slice(0, slashIndex);
  const candidatePrefix = `${firstSegment}/`;
  const allWithSamePrefix = normalizedPaths.every((item) => item.startsWith(candidatePrefix));
  return allWithSamePrefix ? candidatePrefix : "";
}

function isExtractableArchivePath(value) {
  const lowered = String(value || "").trim().toLowerCase();
  return lowered.endsWith(".zip");
}

async function extractZipArchive(serverDir, archivePath) {
  const safeArchivePath = String(archivePath || "").trim();
  if (!safeArchivePath) {
    throw new Error("Invalid archive path");
  }
  if (!isExtractableArchivePath(safeArchivePath)) {
    throw new Error("Only .zip files are supported for extract");
  }

  const archiveAbsolute = resolveServerPath(serverDir, safeArchivePath);
  const archiveStat = await fs.stat(archiveAbsolute);
  if (!archiveStat.isFile()) {
    throw new Error("Selected archive is not a file");
  }

  const destinationRelativeRaw = path.dirname(safeArchivePath).replace(/\\/g, "/");
  const destinationRelative = destinationRelativeRaw === "." ? "" : destinationRelativeRaw;
  const destinationAbsolute = resolveServerPath(serverDir, destinationRelative);
  const zipDirectory = await unzipper.Open.file(archiveAbsolute);

  let extractedEntries = 0;
  let extractedFiles = 0;
  let extractedDirectories = 0;

  for (const entry of Array.isArray(zipDirectory?.files) ? zipDirectory.files : []) {
    const entryPath = normalizeZipEntryPath(entry?.path);
    if (!entryPath || entryPath.startsWith("__MACOSX/")) continue;

    const targetAbsolute = resolveServerPath(destinationAbsolute, entryPath);
    if (entry.type === "Directory") {
      await fs.mkdir(targetAbsolute, { recursive: true });
      extractedEntries += 1;
      extractedDirectories += 1;
      continue;
    }
    if (entry.type !== "File") {
      continue;
    }

    await fs.mkdir(path.dirname(targetAbsolute), { recursive: true });
    await pipeline(entry.stream(), fsSync.createWriteStream(targetAbsolute));
    extractedEntries += 1;
    extractedFiles += 1;
  }

  return {
    path: safeArchivePath,
    status: "extracted",
    destination: destinationRelative,
    extractedEntries,
    extractedFiles,
    extractedDirectories,
  };
}

function normalizeArchiveHeaderPayload(rawArchive) {
  const archive = rawArchive && typeof rawArchive === "object" ? rawArchive : {};
  if (String(archive.format || "") !== SERVER_EXPORT_FORMAT) {
    throw new Error("Invalid export format");
  }
  const server = normalizeArchiveServerInfo(archive.server);
  return {
    format: SERVER_EXPORT_FORMAT,
    exportedAt: String(archive.exportedAt || ""),
    server,
  };
}

function normalizeArchiveEntryPayload(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }
  const entryPath = normalizeArchiveEntryPath(rawEntry.path);
  if (!entryPath) {
    return null;
  }
  return {
    type: rawEntry.type === "directory" ? "directory" : "file",
    path: entryPath,
    contentBase64: String(rawEntry.contentBase64 || ""),
  };
}

function normalizeArchivePayload(rawArchive) {
  const archive = rawArchive && typeof rawArchive === "object" ? rawArchive : {};
  const header = normalizeArchiveHeaderPayload(archive);
  const entries = Array.isArray(archive.entries) ? archive.entries : [];
  return {
    ...header,
    entries: entries.map((entry) => normalizeArchiveEntryPayload(entry)).filter(Boolean),
  };
}

function createArchiveRestoreStats(importedName) {
  return {
    restoredEntries: 0,
    restoredFiles: 0,
    restoredDirectories: 0,
    importedName: String(importedName || "").trim() || "Servidor Importado",
  };
}

async function restoreArchiveEntry(serverDir, entry, restoreStats) {
  if (!entry || !entry.path) {
    return;
  }
  if (entry.type === "directory") {
    const absoluteDir = resolveServerPath(serverDir, entry.path);
    await fs.mkdir(absoluteDir, { recursive: true });
    restoreStats.restoredEntries += 1;
    restoreStats.restoredDirectories += 1;
    return;
  }

  const absoluteFile = resolveServerPath(serverDir, entry.path);
  await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
  const bytes = Buffer.from(String(entry.contentBase64 || ""), "base64");
  await fs.writeFile(absoluteFile, bytes);
  restoreStats.restoredEntries += 1;
  restoreStats.restoredFiles += 1;
}

async function restoreServerFromArchive(serverDir, archivePayload) {
  const archive = normalizeArchivePayload(archivePayload);
  const restoreStats = createArchiveRestoreStats(archive.server.name);
  const directoryEntries = archive.entries.filter((entry) => entry.type === "directory");
  const fileEntries = archive.entries.filter((entry) => entry.type === "file");

  directoryEntries.sort((a, b) => a.path.length - b.path.length);
  for (const entry of directoryEntries) {
    await restoreArchiveEntry(serverDir, entry, restoreStats);
  }
  for (const entry of fileEntries) {
    await restoreArchiveEntry(serverDir, entry, restoreStats);
  }
  return restoreStats;
}

async function importArchiveFromJsonStream(req, { onHeader, onEntry }) {
  const decoder = new TextDecoder("utf-8");
  const markerPattern = /"entries"\s*:\s*\[/;
  let receivedBytes = 0;
  let headerParsed = false;
  let sawArrayEnd = false;
  let headerBuffer = "";
  const entryState = {
    mode: "await_entry",
    braceDepth: 0,
    inString: false,
    escapeNext: false,
    currentEntry: "",
  };

  async function processEntriesText(text) {
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (entryState.mode === "after_array") {
        if (char === "}" || /\s/.test(char)) {
          continue;
        }
        throw new Error("Invalid export file");
      }

      if (entryState.mode === "await_entry") {
        if (char === "," || /\s/.test(char)) {
          continue;
        }
        if (char === "]") {
          sawArrayEnd = true;
          entryState.mode = "after_array";
          continue;
        }
        if (char === "{") {
          entryState.mode = "inside_entry";
          entryState.currentEntry = "{";
          entryState.braceDepth = 1;
          entryState.inString = false;
          entryState.escapeNext = false;
          continue;
        }
        throw new Error("Invalid export file");
      }

      entryState.currentEntry += char;
      if (entryState.inString) {
        if (entryState.escapeNext) {
          entryState.escapeNext = false;
          continue;
        }
        if (char === "\\") {
          entryState.escapeNext = true;
          continue;
        }
        if (char === "\"") {
          entryState.inString = false;
        }
        continue;
      }

      if (char === "\"") {
        entryState.inString = true;
        continue;
      }
      if (char === "{") {
        entryState.braceDepth += 1;
        continue;
      }
      if (char === "}") {
        entryState.braceDepth -= 1;
        if (entryState.braceDepth < 0) {
          throw new Error("Invalid export file");
        }
        if (entryState.braceDepth === 0) {
          let parsedEntry;
          try {
            parsedEntry = JSON.parse(entryState.currentEntry);
          } catch {
            throw new Error("Invalid export file");
          }
          const normalizedEntry = normalizeArchiveEntryPayload(parsedEntry);
          if (normalizedEntry) {
            await onEntry(normalizedEntry);
          }
          entryState.mode = "await_entry";
          entryState.currentEntry = "";
          entryState.inString = false;
          entryState.escapeNext = false;
        }
      }
    }
  }

  async function processText(text) {
    if (!text) {
      return;
    }
    if (!headerParsed) {
      headerBuffer += text;
      if (headerBuffer.length > 1024 * 1024) {
        throw new Error("Invalid export file");
      }
      const markerMatch = markerPattern.exec(headerBuffer);
      if (!markerMatch) {
        return;
      }
      let headerPayload;
      try {
        const headerPrefix = headerBuffer.slice(0, markerMatch.index);
        const headerAsJson = `${headerPrefix}"entries":[]}`;
        headerPayload = normalizeArchiveHeaderPayload(JSON.parse(headerAsJson));
      } catch {
        throw new Error("Invalid export file");
      }
      await onHeader(headerPayload);
      headerParsed = true;
      const remainder = headerBuffer.slice(markerMatch.index + markerMatch[0].length);
      headerBuffer = "";
      await processEntriesText(remainder);
      return;
    }
    await processEntriesText(text);
  }

  for await (const chunk of req) {
    receivedBytes += chunk.length;
    const decodedChunk = decoder.decode(chunk, { stream: true });
    await processText(decodedChunk);
  }
  await processText(decoder.decode());

  if (receivedBytes === 0) {
    throw new Error("Export file is required");
  }
  if (!headerParsed || !sawArrayEnd || entryState.mode === "inside_entry") {
    throw new Error("Invalid export file");
  }
}

function parsePropertiesContent(raw) {
  const entries = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      continue;
    }
    const separatorIndex = Math.max(trimmed.indexOf("="), trimmed.indexOf(":"));
    if (separatorIndex === -1) {
      entries[trimmed] = "";
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }
  return entries;
}

function stringifyPropertiesEntries(entries) {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function sanitizeSubServerName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim();
}

function getNextAvailableSubServerPort(subServers = [], startPort = 25566, preferredPort = 0) {
  const safeStart = Math.max(1, Number(startPort || 25566));
  const usedPorts = new Set(
    (Array.isArray(subServers) ? subServers : [])
      .map((item) => Number(item?.port || 0))
      .filter((port) => Number.isFinite(port) && port > 0)
      .map((port) => Math.floor(port))
  );

  const preferred = Number(preferredPort || 0);
  if (Number.isFinite(preferred) && preferred >= safeStart && !usedPorts.has(Math.floor(preferred))) {
    return Math.floor(preferred);
  }

  let candidate = safeStart;
  while (usedPorts.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

function toSafeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBungeeMeta(meta) {
  const source = meta && typeof meta === "object" ? meta : {};
  const bungee = source.bungee && typeof source.bungee === "object" ? source.bungee : {};
  const subServers = Array.isArray(bungee.subServers)
    ? bungee.subServers
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: String(item.id || "").trim(),
          name: String(item.name || "").trim(),
          slug: String(item.slug || "").trim(),
          path: String(item.path || "").trim(),
          port: Number(item.port || 0),
          version: String(item.version || "").trim(),
          createdAt: String(item.createdAt || ""),
        }))
        .filter((item) => item.id && item.name && item.path && Number.isFinite(item.port) && item.port > 0)
    : [];

  const nextPortCandidate = Number(bungee.nextPort || 0);
  const nextPort = getNextAvailableSubServerPort(subServers, 25566, nextPortCandidate);

  return {
    ...source,
    serverKind: String(source.serverKind || "paper").toLowerCase() === "bungeecord" ? "bungeecord" : "paper",
    bungee: {
      nextPort,
      subServers,
    },
  };
}

function buildBungeeConfigContent(subServers = []) {
  const list = Array.isArray(subServers) ? subServers : [];
  const firstServer = list[0]?.name || "lobby";
  const priorities = list.length ? list.map((item) => item.name) : ["lobby"];
  const serverLines = list.length
    ? list
        .map(
          (item) =>
            `  ${item.name}:\n    motd: '&a${item.name}'\n    address: 127.0.0.1:${item.port}\n    restricted: false`
        )
        .join("\n")
    : "  lobby:\n    motd: '&aLobby'\n    address: 127.0.0.1:25566\n    restricted: false";

  const prioritiesLines = priorities.map((name) => `  - ${name}`).join("\n");

  return [
    "ip_forward: true",
    "network_compression_threshold: 256",
    "groups:",
    "  md_5:",
    "  - admin",
    "listeners:",
    "- query_port: 25577",
    "  motd: '&1DSM BungeeCord'",
    "  tab_list: GLOBAL_PING",
    "  query_enabled: false",
    "  proxy_protocol: false",
    "  forced_hosts:",
    `    pvp.md-5.net: ${firstServer}`,
    "  ping_passthrough: false",
    "  priorities:",
    prioritiesLines,
    "  bind_local_address: true",
    "  host: 0.0.0.0:25565",
    "  max_players: 1",
    "  tab_size: 60",
    "  force_default_server: false",
    "remote_ping_cache: -1",
    "forge_support: false",
    "disabled_commands:",
    "- disabledcommandhere",
    "timeout: 30000",
    "player_limit: -1",
    "servers:",
    serverLines,
    "online_mode: true",
    "log_commands: false",
    "",
  ].join("\n");
}

function parseAuthToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return String(req.headers["x-dsm-token"] || "").trim();
}

async function defaultPaperDownloader({ url, destinationPath }) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, bytes);
  return { bytesWritten: bytes.length };
}

async function defaultBinaryDownloader({ url, destinationPath }) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, bytes);
  return { bytesWritten: bytes.length };
}

function normalizeJavaZipEntryPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

async function extractZipToDirectory(zipPath, destinationDir) {
  const zipDirectory = await unzipper.Open.file(zipPath);
  const files = Array.isArray(zipDirectory?.files) ? zipDirectory.files : [];
  for (const entry of files) {
    const relativePath = normalizeJavaZipEntryPath(entry?.path);
    if (!relativePath || relativePath.startsWith("__MACOSX/")) continue;
    const targetPath = resolveServerPath(destinationDir, relativePath);
    if (entry.type === "Directory") {
      await fs.mkdir(targetPath, { recursive: true });
      continue;
    }
    if (entry.type !== "File") {
      continue;
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(entry.stream(), fsSync.createWriteStream(targetPath));
  }
}

function getJavaBinaryName() {
  return process.platform === "win32" ? "java.exe" : "java";
}

function resolveAdoptiumPlatform() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  if (process.platform === "linux") return "linux";
  return "";
}

function resolveAdoptiumArch() {
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "aarch64";
  return "";
}

function buildManagedJavaDownloadUrl(major) {
  const platformName = resolveAdoptiumPlatform();
  const archName = resolveAdoptiumArch();
  if (!platformName || !archName) {
    throw new Error(`Java Manager does not support this platform yet (${process.platform}/${process.arch}).`);
  }
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${platformName}/${archName}/jre/hotspot/normal/eclipse`;
}

async function findJavaExecutableInDirectory(rootDir) {
  const javaBinary = getJavaBinaryName().toLowerCase();
  const queue = [rootDir];
  while (queue.length) {
    const currentDir = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (String(entry.name || "").toLowerCase() !== javaBinary) continue;
      const parentDirName = path.basename(path.dirname(absolutePath)).toLowerCase();
      if (parentDirName !== "bin") continue;
      return absolutePath;
    }
  }
  return "";
}

function sanitizeDownloadedFileName(fileName, fallbackName = "plugin.jar") {
  const raw = String(fileName || fallbackName).trim();
  const withoutQuery = raw.split("?")[0];
  const base = path.basename(withoutQuery);
  if (!base) return fallbackName;
  return base.endsWith(".jar") ? base : `${base}.jar`;
}

function getServerMetaPath(serverDir) {
  return path.join(serverDir, ".dsm-server.json");
}

async function remapImportedBungeeMetaPaths(serverDir) {
  const meta = normalizeBungeeMeta(await readServerMeta(serverDir));
  if (meta.serverKind !== "bungeecord") {
    return;
  }

  const remappedSubServers = (meta.bungee?.subServers || []).map((item) => {
    const normalizedPath = String(item.path || "").replace(/\\/g, "/");
    let relativePath = "";

    if (normalizedPath) {
      if (path.isAbsolute(normalizedPath)) {
        const marker = "/servers/";
        const markerIndex = normalizedPath.lastIndexOf(marker);
        if (markerIndex >= 0) {
          relativePath = normalizedPath.slice(markerIndex + 1);
        } else {
          relativePath = `servers/${path.basename(normalizedPath)}`;
        }
      } else {
        relativePath = normalizedPath.replace(/^\/+/, "");
      }
    }

    if (!relativePath) {
      const safeSlug = toSafeSlug(item.slug || item.name || item.id || "server");
      relativePath = `servers/${safeSlug}-${item.id || "sub"}`;
    }

    return {
      ...item,
      path: resolveServerPath(serverDir, relativePath),
    };
  });

  await patchServerMeta(serverDir, {
    serverKind: "bungeecord",
    bungee: {
      nextPort: Number(meta.bungee?.nextPort || 25566),
      subServers: remappedSubServers,
    },
  });
}

async function readServerMeta(serverDir) {
  const filePath = getServerMetaPath(serverDir);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function patchServerMeta(serverDir, patch) {
  const current = await readServerMeta(serverDir);
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const filePath = getServerMetaPath(serverDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function resolveImportPayloadType(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const fileName = String(req.headers["x-dsm-import-name"] || "").toLowerCase();
  if (contentType.includes("zip") || fileName.endsWith(".zip")) {
    return "zip";
  }
  return "json";
}

async function streamRequestToFile(req, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const output = fsSync.createWriteStream(destinationPath);
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (!output.write(chunk)) {
      await once(output, "drain");
    }
  }
  await new Promise((resolve, reject) => {
    output.end((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return totalBytes;
}

async function loadArchiveHeaderFromZipDirectory(zipDirectory) {
  const files = Array.isArray(zipDirectory?.files) ? zipDirectory.files : [];
  const manifestEntry = files.find((entry) => normalizeZipEntryPath(entry?.path) === "dsm-export.json");
  if (!manifestEntry) {
    return {
      format: SERVER_EXPORT_FORMAT,
      exportedAt: "",
      server: {
        name: "Servidor Importado",
        serverKind: "",
        paperVersion: "",
      },
    };
  }

  try {
    const manifestRaw = await manifestEntry.buffer();
    const parsed = JSON.parse(manifestRaw.toString("utf8"));
    return normalizeArchiveHeaderPayload(parsed);
  } catch {
    return {
      format: SERVER_EXPORT_FORMAT,
      exportedAt: "",
      server: {
        name: "Servidor Importado",
        serverKind: "",
        paperVersion: "",
      },
    };
  }
}

async function discoverBungeeSubServersFromDirectory(serverDir) {
  const serversDir = path.join(serverDir, "servers");
  let entries = [];
  try {
    entries = await fs.readdir(serversDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const subServers = [];
  let autoPort = 25566;
  const sortedEntries = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sortedEntries) {
    const absoluteDir = path.join(serversDir, entry.name);
    const propertiesPath = path.join(absoluteDir, "server.properties");
    let port = 0;
    let version = "";
    try {
      const rawProperties = await fs.readFile(propertiesPath, "utf8");
      const parsed = parsePropertiesContent(rawProperties);
      port = Number(parsed["server-port"] || 0);
      version = String(parsed["minecraft-version"] || "").trim();
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    if (!Number.isFinite(port) || port <= 0) {
      port = autoPort;
    }
    autoPort = Math.max(autoPort + 1, port + 1);

    const displayName = entry.name.replace(/[-_]+/g, " ").trim() || entry.name;
    const slug = toSafeSlug(entry.name) || `sub-${subServers.length + 1}`;
    subServers.push({
      id: `sub-${slug}-${subServers.length + 1}`,
      name: displayName,
      slug,
      path: absoluteDir,
      port,
      version,
      createdAt: new Date().toISOString(),
    });
  }
  return subServers;
}

async function detectImportedServerKind(serverDir, archiveServer = {}) {
  const archiveHint = normalizeImportedServerKind(archiveServer.serverKind);
  if (archiveHint) {
    return archiveHint;
  }

  const meta = await readServerMeta(serverDir);
  const metaKind = normalizeImportedServerKind(meta.serverKind);
  if (metaKind) {
    return metaKind;
  }

  const configPath = path.join(serverDir, "config.yml");
  if (await pathExists(configPath)) {
    const raw = await fs.readFile(configPath, "utf8").catch(() => "");
    if (/^\s*listeners\s*:/im.test(raw) && /^\s*servers\s*:/im.test(raw)) {
      return "bungeecord";
    }
  }

  const serversDir = path.join(serverDir, "servers");
  if (await pathExists(serversDir)) {
    const entries = await fs.readdir(serversDir, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isDirectory())) {
      return "bungeecord";
    }
  }

  return "paper";
}

async function ensureImportedServerConfiguration(serverDir, archiveServer = {}) {
  const serverKind = await detectImportedServerKind(serverDir, archiveServer);
  const existingMeta = await readServerMeta(serverDir);
  const normalizedMeta = normalizeBungeeMeta(existingMeta);
  const archivePaperVersion = String(archiveServer.paperVersion || "").trim();

  if (serverKind === "bungeecord") {
    let subServers = Array.isArray(normalizedMeta.bungee?.subServers) ? normalizedMeta.bungee.subServers : [];
    if (!subServers.length) {
      subServers = await discoverBungeeSubServersFromDirectory(serverDir);
    }
    await patchServerMeta(serverDir, {
      serverKind: "bungeecord",
      paperVersion: String(normalizedMeta.paperVersion || archivePaperVersion || "bungeecord"),
      bungee: {
        nextPort: getNextAvailableSubServerPort(subServers, 25566),
        subServers,
      },
    });
    await remapImportedBungeeMetaPaths(serverDir);
    return "bungeecord";
  }

  await patchServerMeta(serverDir, {
    serverKind: "paper",
    paperVersion: String(normalizedMeta.paperVersion || archivePaperVersion || ""),
    bungee: {
      nextPort: 25566,
      subServers: [],
    },
  });
  return "paper";
}

async function ensureEulaAccepted(serverDir) {
  const eulaPath = path.join(serverDir, "eula.txt");
  await fs.mkdir(path.dirname(eulaPath), { recursive: true });
  await fs.writeFile(eulaPath, "eula=true\n", "utf8");
}

function normalizeServerType(value) {
  return String(value || "").trim().toLowerCase() === "bungeecord" ? "bungeecord" : "paper";
}

function toSafeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSubServers(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const name = String(item.name || "").trim();
      const slug = toSafeSlug(item.slug || name);
      const version = String(item.version || "").trim();
      const port = Number(item.port || 0);
      const directory = String(item.directory || `subservers/${slug || "server"}`).replace(/\\/g, "/");
      return {
        id: String(item.id || slug || name),
        name,
        slug,
        version,
        port: Number.isFinite(port) ? Math.max(1, Math.floor(port)) : 25565,
        directory,
      };
    })
    .filter((item) => item.name && item.slug);
}

function buildBungeeConfig({ subServers }) {
  const list = normalizeSubServers(subServers);
  const priorities = list.length ? list.map((item) => item.name) : [];
  const serverSection = list.length
    ? list
        .map(
          (item) =>
            `  ${item.name}:\n    motd: '&1${item.name}'\n    address: 127.0.0.1:${item.port}\n    restricted: false`
        )
        .join("\n")
    : "  fallback:\n    motd: '&1Fallback'\n    address: 127.0.0.1:25566\n    restricted: false";
  const prioritiesList = priorities.length ? priorities.join(", ") : "fallback";

  return `ip_forward: true
network_compression_threshold: 256
connection_throttle: 4000
prevent_proxy_connections: false
servers:
${serverSection}
listeners:
- query_port: 25577
  motd: '&1DSM Bungeecord'
  tab_list: GLOBAL_PING
  query_enabled: false
  proxy_protocol: false
  forced_hosts:
    pvp.md-5.net: pvp
  ping_passthrough: false
  priorities: [${prioritiesList}]
  bind_local_address: true
  host: 0.0.0.0:25577
  max_players: 1
  tab_size: 60
  force_default_server: false
online_mode: true
disabled_commands:
- disabledcommandhere
timeout: 30000
stats: ''
player_limit: -1
`;
}

async function ensureBungeeConfig(serverDir, subServers) {
  const configPath = path.join(serverDir, "config.yml");
  const raw = buildBungeeConfig({ subServers });
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, raw, "utf8");
}

async function ensureSubServerProperties(subServerDir, port) {
  const propertiesPath = path.join(subServerDir, "server.properties");
  const existing = parsePropertiesContent(
    await fs.readFile(propertiesPath, "utf8").catch((error) => (error.code === "ENOENT" ? "" : Promise.reject(error)))
  );
  const next = {
    ...existing,
    "server-port": String(port),
    "server-ip": "127.0.0.1",
    "online-mode": "false",
  };
  const raw = stringifyPropertiesEntries(next);
  await fs.mkdir(path.dirname(propertiesPath), { recursive: true });
  await fs.writeFile(propertiesPath, raw.endsWith("\n") ? raw : `${raw}\n`, "utf8");
}

async function ensureSpigotBungee(subServerDir) {
  const spigotPath = path.join(subServerDir, "spigot.yml");
  const raw = `settings:
  bungeecord: true
`;
  await fs.mkdir(path.dirname(spigotPath), { recursive: true });
  await fs.writeFile(spigotPath, raw, "utf8");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function backupLegacyPlayersDirectoryIfNeeded(serverDir) {
  const worldDir = path.join(serverDir, "world");
  const playerDataDir = path.join(worldDir, "playerdata");
  const legacyPlayersDir = path.join(worldDir, "players");
  const hasLegacyPlayers = await pathExists(legacyPlayersDir);
  if (!hasLegacyPlayers) return "";

  const hasPlayerData = await pathExists(playerDataDir);
  if (!hasPlayerData) {
    return "";
  }

  const backupName = `players.dsm-legacy-backup-${Date.now()}`;
  const backupPath = path.join(worldDir, backupName);
  await fs.rename(legacyPlayersDir, backupPath);
  return backupName;
}

async function wipeDirectoryContents(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directoryPath, entry.name);
    await fs.rm(absolute, { recursive: true, force: true });
  }
}

async function ensureBungeeConfig(serverDir, subServers = []) {
  const configPath = path.join(serverDir, "config.yml");
  const configContent = buildBungeeConfigContent(subServers);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, configContent, "utf8");
}

async function getProcessMemoryBytes(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return 0;
  }

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", `(Get-Process -Id ${Math.floor(numericPid)}).WorkingSet64`],
        { windowsHide: true, timeout: 3000 }
      );
      const value = Number(String(stdout || "").trim());
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  if (process.platform === "linux") {
    try {
      const raw = await fs.readFile(`/proc/${Math.floor(numericPid)}/status`, "utf8");
      const match = raw.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      if (!match) return 0;
      return Number(match[1]) * 1024;
    } catch {
      return 0;
    }
  }

  return 0;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

async function canConnectLocalPort(port, timeoutMs = 800) {
  const numericPort = Number(port);
  if (!Number.isFinite(numericPort) || numericPort <= 0) {
    return false;
  }
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: Math.floor(numericPort),
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(result);
    };

    socket.setTimeout(Math.max(200, Number(timeoutMs) || 800));
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForLocalPortReady({ name, port, timeoutMs = 90000, pollIntervalMs = 500 }) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 90000);
  while (Date.now() < deadline) {
    const ready = await canConnectLocalPort(port, 900);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, Math.max(100, Number(pollIntervalMs) || 500)));
  }
  throw new Error(`Sub-server ${name || "unknown"} did not open port ${port} in time`);
}

async function getProcessCpuUsagePercent({ pid, previousSnapshot = null }) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return { percent: 0, snapshot: null };
  }

  if (process.platform !== "win32") {
    try {
      const { stdout } = await execFileAsync("ps", ["-p", String(Math.floor(numericPid)), "-o", "%cpu="], {
        timeout: 3000,
      });
      const value = Number(String(stdout || "").trim().replace(",", "."));
      return {
        percent: clampPercent(value),
        snapshot: null,
      };
    } catch {
      return { percent: 0, snapshot: null };
    }
  }

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-Process -Id ${Math.floor(numericPid)}).CPU`],
      { windowsHide: true, timeout: 3000 }
    );
    const cpuSeconds = Number(String(stdout || "").trim().replace(",", "."));
    if (!Number.isFinite(cpuSeconds) || cpuSeconds < 0) {
      return { percent: 0, snapshot: null };
    }

    const currentSnapshot = {
      pid: Math.floor(numericPid),
      cpuMs: cpuSeconds * 1000,
      timestampMs: Date.now(),
    };
    if (
      !previousSnapshot ||
      previousSnapshot.pid !== currentSnapshot.pid ||
      !Number.isFinite(previousSnapshot.cpuMs) ||
      !Number.isFinite(previousSnapshot.timestampMs)
    ) {
      return { percent: 0, snapshot: currentSnapshot };
    }

    const deltaCpuMs = currentSnapshot.cpuMs - previousSnapshot.cpuMs;
    const deltaWallMs = currentSnapshot.timestampMs - previousSnapshot.timestampMs;
    if (deltaCpuMs <= 0 || deltaWallMs <= 0) {
      return { percent: 0, snapshot: currentSnapshot };
    }

    const logicalCpus = Math.max(1, os.cpus().length);
    const percent = (deltaCpuMs / (deltaWallMs * logicalCpus)) * 100;
    return {
      percent: clampPercent(percent),
      snapshot: currentSnapshot,
    };
  } catch {
    return { percent: 0, snapshot: null };
  }
}

async function getRuntimeResourceUsage({ runtime, previousSnapshot = null }) {
  const status = runtime && typeof runtime.getStatus === "function" ? runtime.getStatus() : {};
  const pid = Number(status?.pid);
  const safePid = Number.isFinite(pid) && pid > 0 ? Math.floor(pid) : null;
  const cpuUsage = await getProcessCpuUsagePercent({
    pid: safePid,
    previousSnapshot,
  });
  const memoryBytes = await getProcessMemoryBytes(safePid);
  return {
    pid: safePid,
    cpuPercent: Number.isFinite(cpuUsage.percent) ? cpuUsage.percent : 0,
    memoryBytes: Number.isFinite(memoryBytes) ? memoryBytes : 0,
    snapshot: cpuUsage.snapshot || null,
  };
}

async function applyBatchFileAction(serverDir, action, paths, destinationDirectory = "") {
  const cleanedPaths = Array.isArray(paths) ? paths.map((item) => String(item || "")).filter(Boolean) : [];
  if (!cleanedPaths.length) {
    throw new Error("No files selected");
  }

  const results = [];
  if (action === "extract") {
    for (const relPath of cleanedPaths) {
      const extracted = await extractZipArchive(serverDir, relPath);
      results.push(extracted);
    }
    return results;
  }

  if (action === "delete") {
    for (const relPath of cleanedPaths) {
      const absolute = resolveServerPath(serverDir, relPath);
      await fs.rm(absolute, { recursive: true, force: true });
      results.push({ path: relPath, status: "deleted" });
    }
    return results;
  }

  if (!["copy", "move"].includes(action)) {
    throw new Error("Invalid batch action");
  }

  const destination = resolveServerPath(serverDir, destinationDirectory);
  await fs.mkdir(destination, { recursive: true });

  for (const relPath of cleanedPaths) {
    const source = resolveServerPath(serverDir, relPath);
    const target = path.join(destination, path.basename(source));
    await fs.rm(target, { recursive: true, force: true });

    if (action === "copy") {
      const stat = await fs.stat(source);
      if (stat.isDirectory()) {
        await fs.cp(source, target, { recursive: true, force: true });
      } else {
        await fs.copyFile(source, target);
      }
      results.push({ path: relPath, status: "copied", destination: path.relative(serverDir, target).replace(/\\/g, "/") });
      continue;
    }

    try {
      await fs.rename(source, target);
    } catch (error) {
      if (error.code === "EXDEV") {
        const stat = await fs.stat(source);
        if (stat.isDirectory()) {
          await fs.cp(source, target, { recursive: true, force: true });
          await fs.rm(source, { recursive: true, force: true });
        } else {
          await fs.copyFile(source, target);
          await fs.rm(source, { force: true });
        }
      } else {
        throw error;
      }
    }
    results.push({ path: relPath, status: "moved", destination: path.relative(serverDir, target).replace(/\\/g, "/") });
  }

  return results;
}

function sanitizeRenameTargetName(value) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  if (!raw) return "";
  if (raw.includes("/")) return "";
  if (raw === "." || raw === "..") return "";
  return raw;
}

async function renameServerEntry(serverDir, sourcePath, newName) {
  const sourceRelative = String(sourcePath || "").trim();
  if (!sourceRelative) {
    throw new Error("Invalid source path");
  }
  const safeName = sanitizeRenameTargetName(newName);
  if (!safeName) {
    throw new Error("Invalid new name");
  }

  const sourceAbsolute = resolveServerPath(serverDir, sourceRelative);
  const sourceDirectoryRelative = path.dirname(sourceRelative).replace(/\\/g, "/");
  const parentAbsolute = resolveServerPath(serverDir, sourceDirectoryRelative === "." ? "" : sourceDirectoryRelative);
  const targetAbsolute = resolveServerPath(parentAbsolute, safeName);
  const targetRelative = path.relative(serverDir, targetAbsolute).replace(/\\/g, "/");

  if (targetAbsolute === sourceAbsolute) {
    return { oldPath: sourceRelative, path: targetRelative };
  }

  const targetExists = await fs
    .access(targetAbsolute)
    .then(() => true)
    .catch((error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  if (targetExists) {
    throw new Error("Target name already exists");
  }

  await fs.rename(sourceAbsolute, targetAbsolute);
  return {
    oldPath: sourceRelative,
    path: targetRelative,
  };
}

function createServer({
  dataDir = path.resolve(process.cwd(), "data"),
  serverDir = path.resolve(process.cwd(), "server"),
  runtimeManager,
  downloadPaperVersion = defaultPaperDownloader,
  downloadBinary = defaultBinaryDownloader,
  searchPlugins = defaultSearchPlugins,
  resolvePluginDownload = defaultResolvePluginDownload,
  getPluginDetails = defaultGetPluginDetails,
} = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  const resolvedServerDir = path.resolve(serverDir);
  const registry = createRegistry({ rootDir: resolvedDataDir });
  const accountManager = createAccountManager({ dataDir: resolvedDataDir, defaultServerDir: resolvedServerDir });
  const publicDir = path.resolve(__dirname, "..", "public");
  const sessions = new Map();
  const runtimeStateByServerId = new Map();
  const playersByServerId = new Map();
  const debugHistoryByServerId = new Map();
  const debugCursorByRuntime = new WeakMap();
  const javaInstallPromisesByMajor = new Map();
  const useManagedJavaRuntimes = !runtimeManager;
  let server;
  let baseUrl = "";

  function sanitizePlayerLogLine(value) {
    return String(value || "")
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/§[0-9A-FK-OR]/gi, "");
  }

  function parsePlayerNames(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .map((item) => item.replace(/\(.*?\)/g, "").trim())
      .filter((item) => /^[A-Za-z0-9_]{1,16}$/.test(item));
  }

  function parsePlayerEvents(serverId, line) {
    const players = playersByServerId.get(serverId) || new Set();
    const normalizedLine = sanitizePlayerLogLine(line);

    const joined = normalizedLine.match(/\b([A-Za-z0-9_]{1,16}) joined the game\b/i);
    if (joined) {
      players.add(joined[1]);
    }
    const left = normalizedLine.match(/\b([A-Za-z0-9_]{1,16}) left the game\b/i);
    if (left) {
      players.delete(left[1]);
    }

    const listPatterns = [
      /players online:\s*(.*)$/i,
      /online players\s*(?:\(\d+\))?\s*:\s*(.*)$/i,
      /connected players:\s*(.*)$/i,
      /there are\s+\d+\s+of a max(?:imum)?\s+of\s+\d+\s+players online:?\s*(.*)$/i,
    ];
    for (const pattern of listPatterns) {
      const match = normalizedLine.match(pattern);
      if (!match) continue;
      players.clear();
      for (const name of parsePlayerNames(match[1])) {
        players.add(name);
      }
      playersByServerId.set(serverId, players);
      return;
    }

    if (/there are\s+0\s+of a max(?:imum)?\s+of\s+\d+\s+players online/i.test(normalizedLine)) {
      players.clear();
    }

    playersByServerId.set(serverId, players);
  }

  function parseFormattedConsoleLine(value) {
    const formatted = String(value || "").trim();
    if (!formatted) {
      return { stream: "", line: "", formatted: "" };
    }
    const match = formatted.match(/^\[([A-Za-z0-9_]+)\]\s*(.*)$/);
    if (!match) {
      return {
        stream: "",
        line: formatted,
        formatted,
      };
    }
    return {
      stream: String(match[1] || "").toUpperCase(),
      line: String(match[2] || ""),
      formatted,
    };
  }

  function shouldStoreDebugError({ stream = "", line = "", formatted = "" } = {}) {
    const normalizedStream = String(stream || "").trim().toUpperCase();
    if (normalizedStream === "ERR") {
      return true;
    }
    const normalizedText = `${line} ${formatted}`.toLowerCase();
    if (!normalizedText.trim()) return false;
    if (!/(exception|error|failed|fatal|severe|traceback)/i.test(normalizedText)) {
      return false;
    }
    if (/\bno errors?\b/i.test(normalizedText)) {
      return false;
    }
    return true;
  }

  function createDebugSession(startedAt = new Date().toISOString()) {
    return {
      id: `debug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt,
      stoppedAt: null,
      errors: [],
    };
  }

  function createDebugTargetState({ targetType, targetId = "", targetName = "", targetPort = 0 }) {
    return {
      targetType: targetType === "subserver" ? "subserver" : "main",
      targetId: String(targetId || ""),
      targetName: String(targetName || ""),
      targetPort: Number(targetPort || 0),
      activeSessionId: "",
      sessions: [],
    };
  }

  function ensureDebugServerState(serverId) {
    const safeServerId = String(serverId || "");
    let state = debugHistoryByServerId.get(safeServerId);
    if (!state) {
      state = {
        main: createDebugTargetState({ targetType: "main", targetId: "", targetName: "proxy", targetPort: 0 }),
        subById: new Map(),
      };
      debugHistoryByServerId.set(safeServerId, state);
    }
    return state;
  }

  function ensureDebugTargetState({
    serverId,
    targetType,
    targetId = "",
    targetName = "",
    targetPort = 0,
  }) {
    const state = ensureDebugServerState(serverId);
    if (targetType !== "subserver") {
      state.main.targetType = "main";
      state.main.targetId = "";
      if (targetName) state.main.targetName = String(targetName);
      if (Number.isFinite(Number(targetPort)) && Number(targetPort) > 0) {
        state.main.targetPort = Number(targetPort);
      }
      if (!state.main.targetName) {
        state.main.targetName = "proxy";
      }
      return state.main;
    }

    const safeTargetId = String(targetId || "");
    let targetState = state.subById.get(safeTargetId);
    if (!targetState) {
      targetState = createDebugTargetState({
        targetType: "subserver",
        targetId: safeTargetId,
        targetName,
        targetPort,
      });
      state.subById.set(safeTargetId, targetState);
    } else {
      targetState.targetType = "subserver";
      targetState.targetId = safeTargetId;
      if (targetName) targetState.targetName = String(targetName);
      if (Number.isFinite(Number(targetPort)) && Number(targetPort) > 0) {
        targetState.targetPort = Number(targetPort);
      }
    }
    if (!targetState.targetName) {
      targetState.targetName = safeTargetId || "subserver";
    }
    return targetState;
  }

  function getActiveDebugSession(targetState) {
    if (!targetState || !targetState.activeSessionId) return null;
    return targetState.sessions.find((session) => session.id === targetState.activeSessionId && !session.stoppedAt) || null;
  }

  function trimDebugSessions(targetState) {
    if (!targetState || !Array.isArray(targetState.sessions)) return;
    const maxSessions = 40;
    while (targetState.sessions.length > maxSessions) {
      if (targetState.sessions[0]?.id === targetState.activeSessionId) {
        break;
      }
      targetState.sessions.shift();
    }
  }

  function ensureDebugSessionStarted({
    serverId,
    targetType = "main",
    targetId = "",
    targetName = "",
    targetPort = 0,
    startedAt = new Date().toISOString(),
  }) {
    const targetState = ensureDebugTargetState({
      serverId,
      targetType,
      targetId,
      targetName,
      targetPort,
    });
    const activeSession = getActiveDebugSession(targetState);
    if (activeSession) {
      return activeSession;
    }
    const session = createDebugSession(startedAt);
    targetState.sessions.push(session);
    targetState.activeSessionId = session.id;
    trimDebugSessions(targetState);
    return session;
  }

  function markDebugSessionStopped({
    serverId,
    targetType = "main",
    targetId = "",
    targetName = "",
    targetPort = 0,
    stoppedAt = new Date().toISOString(),
  }) {
    const targetState = ensureDebugTargetState({
      serverId,
      targetType,
      targetId,
      targetName,
      targetPort,
    });
    let session = getActiveDebugSession(targetState);
    if (!session) {
      session = createDebugSession(stoppedAt);
      targetState.sessions.push(session);
      targetState.activeSessionId = session.id;
    }
    if (!session.stoppedAt) {
      session.stoppedAt = stoppedAt;
    }
    targetState.activeSessionId = "";
    trimDebugSessions(targetState);
    return session;
  }

  function storeDebugErrorLine({
    serverId,
    targetType = "main",
    targetId = "",
    targetName = "",
    targetPort = 0,
    stream = "",
    line = "",
    formatted = "",
    at = new Date().toISOString(),
  }) {
    if (!shouldStoreDebugError({ stream, line, formatted })) {
      return false;
    }
    const session = ensureDebugSessionStarted({
      serverId,
      targetType,
      targetId,
      targetName,
      targetPort,
      startedAt: at,
    });
    session.errors.push({
      at,
      stream: String(stream || "").toUpperCase(),
      line: String(line || ""),
      formatted: String(formatted || ""),
    });
    const maxErrorsPerSession = 800;
    if (session.errors.length > maxErrorsPerSession) {
      session.errors.splice(0, session.errors.length - maxErrorsPerSession);
    }
    return true;
  }

  function syncRuntimeCursorToTail(runtime) {
    if (!runtime || typeof runtime.getConsoleLines !== "function") return;
    const lines = runtime.getConsoleLines();
    const safeLength = Array.isArray(lines) ? lines.length : 0;
    debugCursorByRuntime.set(runtime, safeLength);
  }

  function harvestRuntimeDebugErrors({
    serverId,
    targetType = "main",
    targetId = "",
    targetName = "",
    targetPort = 0,
    runtime,
  }) {
    if (!runtime || runtime.__dsmDefaultRuntime || typeof runtime.getConsoleLines !== "function") {
      return 0;
    }
    const lines = runtime.getConsoleLines();
    const safeLines = Array.isArray(lines) ? lines : [];
    let cursor = Number(debugCursorByRuntime.get(runtime) || 0);
    if (!Number.isFinite(cursor) || cursor < 0 || cursor > safeLines.length) {
      cursor = 0;
    }
    let captured = 0;
    for (let index = cursor; index < safeLines.length; index += 1) {
      const parsed = parseFormattedConsoleLine(safeLines[index]);
      if (
        storeDebugErrorLine({
          serverId,
          targetType,
          targetId,
          targetName,
          targetPort,
          stream: parsed.stream,
          line: parsed.line,
          formatted: parsed.formatted,
        })
      ) {
        captured += 1;
      }
    }
    debugCursorByRuntime.set(runtime, safeLines.length);
    return captured;
  }

  function getDebugTargetDescriptor({ serverRecord, targetType = "main", subServer = null }) {
    if (targetType === "subserver") {
      return {
        serverId: serverRecord.id,
        targetType: "subserver",
        targetId: String(subServer?.id || ""),
        targetName: String(subServer?.name || subServer?.id || "subserver"),
        targetPort: Number(subServer?.port || 0),
      };
    }
    const mainLabel = String(serverRecord?.name || "Servidor principal").trim() || "Servidor principal";
    return {
      serverId: serverRecord.id,
      targetType: "main",
      targetId: "",
      targetName: mainLabel,
      targetPort: 0,
    };
  }

  function captureRuntimeDebugLine({ serverRecord, targetType = "main", subServer = null, stream = "", line = "", formatted = "" }) {
    const descriptor = getDebugTargetDescriptor({ serverRecord, targetType, subServer });
    storeDebugErrorLine({
      ...descriptor,
      stream,
      line,
      formatted,
    });
  }

  function cloneDebugSessionForResponse(session) {
    const safeErrors = Array.isArray(session?.errors)
      ? session.errors.map((error) => ({
          at: error?.at || null,
          stream: error?.stream || "",
          line: error?.line || "",
          formatted: error?.formatted || "",
        }))
      : [];
    return {
      sessionId: String(session?.id || ""),
      startedAt: session?.startedAt || null,
      stoppedAt: session?.stoppedAt || null,
      errorCount: safeErrors.length,
      errors: safeErrors,
    };
  }

  function compareDebugTargets(left, right) {
    const leftType = String(left?.targetType || "");
    const rightType = String(right?.targetType || "");
    if (leftType !== rightType) {
      if (leftType === "main") return -1;
      if (rightType === "main") return 1;
    }
    const leftPort = Number(left?.targetPort || 0);
    const rightPort = Number(right?.targetPort || 0);
    const leftHasPort = Number.isFinite(leftPort) && leftPort > 0;
    const rightHasPort = Number.isFinite(rightPort) && rightPort > 0;
    if (leftHasPort && rightHasPort && leftPort !== rightPort) {
      return leftPort - rightPort;
    }
    if (leftHasPort !== rightHasPort) {
      return leftHasPort ? -1 : 1;
    }
    const leftName = String(left?.targetName || left?.targetId || "").toLowerCase();
    const rightName = String(right?.targetName || right?.targetId || "").toLowerCase();
    return leftName.localeCompare(rightName);
  }

  function getDebugTargetsForServer(serverId) {
    const state = debugHistoryByServerId.get(String(serverId || ""));
    if (!state) return [];
    const items = [];
    if (state.main) {
      items.push(state.main);
    }
    items.push(...Array.from(state.subById.values()));
    items.sort(compareDebugTargets);
    return items.map((targetState) => {
      const sessions = Array.isArray(targetState.sessions)
        ? targetState.sessions
            .map((session) => cloneDebugSessionForResponse(session))
            .sort((left, right) => {
              const leftTime = new Date(left.startedAt || 0).getTime();
              const rightTime = new Date(right.startedAt || 0).getTime();
              return rightTime - leftTime;
            })
        : [];
      const errorCount = sessions.reduce((count, session) => count + Number(session.errorCount || 0), 0);
      return {
        targetType: targetState.targetType,
        targetId: targetState.targetId,
        targetName: targetState.targetName,
        targetPort: targetState.targetPort,
        sessionCount: sessions.length,
        errorCount,
        sessions,
      };
    });
  }

  function getJavaManagerRootDir() {
    return path.join(resolvedDataDir, "runtime", "java");
  }

  function getManagedJavaVersionDir(major) {
    return path.join(getJavaManagerRootDir(), `java-${Math.floor(Number(major || 0))}`);
  }

  async function inspectManagedJavaRuntime(major) {
    const safeMajor = Math.floor(Number(major || 0));
    const runtimeDir = getManagedJavaVersionDir(safeMajor);
    const javaPath = await findJavaExecutableInDirectory(runtimeDir);
    if (!javaPath) {
      return null;
    }
    return {
      major: safeMajor,
      runtimeDir,
      javaPath,
      managed: true,
    };
  }

  async function ensureManagedJavaRuntime(major) {
    const safeMajor = Math.floor(Number(major || 0));
    if (!MANAGED_JAVA_MAJORS.includes(safeMajor)) {
      throw new Error(`Unsupported Java version requested: ${safeMajor}`);
    }

    const existing = await inspectManagedJavaRuntime(safeMajor);
    if (existing) {
      return existing;
    }

    const inFlight = javaInstallPromisesByMajor.get(safeMajor);
    if (inFlight) {
      return inFlight;
    }

    const installPromise = (async () => {
      const preInstalled = await inspectManagedJavaRuntime(safeMajor);
      if (preInstalled) return preInstalled;

      const runtimeDir = getManagedJavaVersionDir(safeMajor);
      const tempZipPath = path.join(
        os.tmpdir(),
        `dsm-java-${safeMajor}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}.zip`
      );

      try {
        await fs.mkdir(getJavaManagerRootDir(), { recursive: true });
        await downloadBinary({
          url: buildManagedJavaDownloadUrl(safeMajor),
          destinationPath: tempZipPath,
        });
        await fs.rm(runtimeDir, { recursive: true, force: true });
        await fs.mkdir(runtimeDir, { recursive: true });
        await extractZipToDirectory(tempZipPath, runtimeDir);
        const installed = await inspectManagedJavaRuntime(safeMajor);
        if (!installed) {
          throw new Error(`Java ${safeMajor} downloaded, but executable was not found.`);
        }
        return installed;
      } catch (error) {
        throw new Error(`Failed to install Java ${safeMajor}: ${error.message}`);
      } finally {
        await fs.unlink(tempZipPath).catch(() => {});
      }
    })();

    javaInstallPromisesByMajor.set(safeMajor, installPromise);
    try {
      return await installPromise;
    } finally {
      javaInstallPromisesByMajor.delete(safeMajor);
    }
  }

  async function listManagedJavaRuntimes(requiredMajors = []) {
    const requiredSet = new Set(
      (Array.isArray(requiredMajors) ? requiredMajors : [])
        .map((item) => Math.floor(Number(item || 0)))
        .filter((item) => Number.isFinite(item) && item > 0)
    );
    const candidates = Array.from(new Set([...MANAGED_JAVA_MAJORS, ...requiredSet]));
    candidates.sort((a, b) => a - b);

    const items = [];
    for (const major of candidates) {
      const installed = await inspectManagedJavaRuntime(major);
      items.push({
        major,
        installed: Boolean(installed),
        javaPath: installed?.javaPath || "",
        runtimeDir: installed?.runtimeDir || getManagedJavaVersionDir(major),
      });
    }
    return items;
  }

  function getJavaRequirementsFromMeta(meta) {
    const normalizedMeta = meta && typeof meta === "object" ? meta : {};
    const main = {
      serverKind: String(normalizedMeta.serverKind || "paper"),
      paperVersion: String(normalizedMeta.paperVersion || ""),
      requiredJavaMajor: resolveJavaMajorForServer({
        serverKind: normalizedMeta.serverKind || "paper",
        paperVersion: normalizedMeta.paperVersion || "",
      }),
    };

    const subServers = Array.isArray(normalizedMeta.bungee?.subServers)
      ? normalizedMeta.bungee.subServers.map((sub) => ({
          id: String(sub.id || ""),
          name: String(sub.name || ""),
          version: String(sub.version || ""),
          requiredJavaMajor: resolveJavaMajorForPaperVersion(sub.version || ""),
        }))
      : [];

    const requiredMajors = new Set([main.requiredJavaMajor]);
    for (const sub of subServers) {
      requiredMajors.add(sub.requiredJavaMajor);
    }

    return {
      main,
      subServers,
      requiredMajors: Array.from(requiredMajors).sort((a, b) => a - b),
    };
  }

  function createMainServerRuntime(serverRecord, javaExecutable = "java") {
    return createServerRuntime({
      serverDir: serverRecord.path,
      javaExecutable,
      onLine: ({ stream, line, formatted }) => {
        parsePlayerEvents(serverRecord.id, line);
        captureRuntimeDebugLine({
          serverRecord,
          targetType: "main",
          stream,
          line,
          formatted,
        });
      },
    });
  }

  async function ensureMainRuntimeJava({ serverRecord, runtimeState, meta }) {
    if (!useManagedJavaRuntimes || !runtimeState?.runtime?.__dsmDefaultRuntime) {
      return null;
    }

    const requiredMajor = resolveJavaMajorForServer({
      serverKind: meta?.serverKind || "paper",
      paperVersion: meta?.paperVersion || "",
    });
    const javaRuntime = await ensureManagedJavaRuntime(requiredMajor);
    const shouldReplaceRuntime =
      runtimeState.mainJavaMajor !== requiredMajor || runtimeState.mainJavaPath !== javaRuntime.javaPath;

    if (!shouldReplaceRuntime) {
      return {
        requiredMajor,
        javaPath: javaRuntime.javaPath,
      };
    }

    const status = runtimeState.runtime.getStatus?.();
    if (status?.state === "running") {
      return {
        requiredMajor,
        javaPath: runtimeState.mainJavaPath || javaRuntime.javaPath,
      };
    }

    runtimeState.runtime = createMainServerRuntime(serverRecord, javaRuntime.javaPath);
    syncRuntimeCursorToTail(runtimeState.runtime);
    runtimeState.mainJavaMajor = requiredMajor;
    runtimeState.mainJavaPath = javaRuntime.javaPath;
    return {
      requiredMajor,
      javaPath: javaRuntime.javaPath,
    };
  }

  function getOrCreateRuntimeState(serverRecord) {
    const mainDescriptor = getDebugTargetDescriptor({ serverRecord, targetType: "main" });
    ensureDebugTargetState(mainDescriptor);
    let state = runtimeStateByServerId.get(serverRecord.id);
    if (state) {
      if (!state.subRuntimeById) {
        state.subRuntimeById = new Map();
      }
      if (!Object.prototype.hasOwnProperty.call(state, "mainJavaMajor")) {
        state.mainJavaMajor = 0;
      }
      if (!Object.prototype.hasOwnProperty.call(state, "mainJavaPath")) {
        state.mainJavaPath = "";
      }
      return state;
    }

    const runtime =
      typeof runtimeManager === "function"
        ? runtimeManager({ serverRecord, serverRole: "main", subServer: null })
        : runtimeManager;
    const mainRuntime = runtime || createMainServerRuntime(serverRecord);

    state = {
      runtime: mainRuntime,
      processCpuSnapshot: null,
      subRuntimeById: new Map(),
      mainJavaMajor: 0,
      mainJavaPath: "",
    };
    runtimeStateByServerId.set(serverRecord.id, state);
    syncRuntimeCursorToTail(mainRuntime);
    if (!playersByServerId.has(serverRecord.id)) {
      playersByServerId.set(serverRecord.id, new Set());
    }
    return state;
  }

  function createSubServerRuntime(serverRecord, subServer, { javaExecutable = "java" } = {}) {
    const customRuntime =
      typeof runtimeManager === "function"
        ? runtimeManager({ serverRecord, serverRole: "subserver", subServer })
        : null;
    if (customRuntime) {
      return customRuntime;
    }
    return createServerRuntime({
      serverDir: subServer.path,
      javaExecutable,
      onLine: ({ stream, line, formatted }) => {
        captureRuntimeDebugLine({
          serverRecord,
          targetType: "subserver",
          subServer,
          stream,
          line,
          formatted,
        });
      },
    });
  }

  async function stopRuntime(runtime) {
    if (!runtime || typeof runtime.stop !== "function") return;
    try {
      await runtime.stop();
    } catch {}
  }

  async function stopAllSubRuntimes(runtimeState, serverRecord = null) {
    if (!runtimeState?.subRuntimeById) return;
    for (const entry of runtimeState.subRuntimeById.values()) {
      let descriptor = null;
      if (serverRecord && entry?.subServer) {
        descriptor = getDebugTargetDescriptor({
          serverRecord,
          targetType: "subserver",
          subServer: entry.subServer,
        });
        harvestRuntimeDebugErrors({
          ...descriptor,
          runtime: entry?.runtime,
        });
      }
      await stopRuntime(entry?.runtime);
      if (descriptor) {
        harvestRuntimeDebugErrors({
          ...descriptor,
          runtime: entry?.runtime,
        });
        markDebugSessionStopped(descriptor);
      }
    }
    runtimeState.subRuntimeById.clear();
  }

  function subServerExists(serverRecord, subServerPath) {
    const absoluteSubPath = resolveSubServerPath(serverRecord, subServerPath);
    return fs
      .access(absoluteSubPath)
      .then(() => true)
      .catch((error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
  }

  function areSameSubServerList(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      const a = left[index];
      const b = right[index];
      if (!a || !b) return false;
      if (String(a.id || "") !== String(b.id || "")) return false;
      if (String(a.name || "") !== String(b.name || "")) return false;
      if (String(a.slug || "") !== String(b.slug || "")) return false;
      if (String(a.path || "") !== String(b.path || "")) return false;
      if (Number(a.port || 0) !== Number(b.port || 0)) return false;
      if (String(a.version || "") !== String(b.version || "")) return false;
    }
    return true;
  }

  async function reconcileBungeeServerState(serverRecord) {
    const meta = await readNormalizedServerMeta(serverRecord.path);
    if (meta.serverKind !== "bungeecord") {
      return meta;
    }

    const currentSubServers = Array.isArray(meta.bungee?.subServers) ? meta.bungee.subServers : [];
    const existingSubServers = [];
    for (const subServer of currentSubServers) {
      const exists = await subServerExists(serverRecord, subServer.path);
      if (!exists) {
        continue;
      }
      const absoluteSubPath = resolveSubServerPath(serverRecord, subServer.path);
      const normalizedSubServer = { ...subServer, path: absoluteSubPath };
      await backupLegacyPlayersDirectoryIfNeeded(absoluteSubPath);
      existingSubServers.push(normalizedSubServer);
      await ensureSubServerProperties(absoluteSubPath, normalizedSubServer.port);
      await ensureSpigotBungee(absoluteSubPath);
    }

    const nextPort = getNextAvailableSubServerPort(existingSubServers, 25566, Number(meta.bungee?.nextPort || 0));
    const needsPatch =
      !areSameSubServerList(currentSubServers, existingSubServers) || Number(meta.bungee?.nextPort || 0) !== nextPort;
    if (needsPatch) {
      await patchServerMeta(serverRecord.path, {
        serverKind: "bungeecord",
        bungee: {
          nextPort,
          subServers: existingSubServers,
        },
      });
    }

    return {
      ...meta,
      bungee: {
        nextPort,
        subServers: existingSubServers,
      },
    };
  }

  async function syncSubRuntimeMap({ serverRecord, runtimeState, subServers }) {
    if (!runtimeState?.subRuntimeById) {
      runtimeState.subRuntimeById = new Map();
    }

    const expectedPathsById = new Map();
    for (const subServer of subServers) {
      expectedPathsById.set(subServer.id, resolveSubServerPath(serverRecord, subServer.path));
    }

    for (const [subId, runtimeEntry] of runtimeState.subRuntimeById.entries()) {
      const expectedPath = expectedPathsById.get(subId);
      if (expectedPath && runtimeEntry?.path === expectedPath) continue;
      let descriptor = null;
      if (runtimeEntry?.subServer) {
        descriptor = getDebugTargetDescriptor({
          serverRecord,
          targetType: "subserver",
          subServer: runtimeEntry.subServer,
        });
        harvestRuntimeDebugErrors({
          ...descriptor,
          runtime: runtimeEntry?.runtime,
        });
      }
      await stopRuntime(runtimeEntry?.runtime);
      if (descriptor) {
        harvestRuntimeDebugErrors({
          ...descriptor,
          runtime: runtimeEntry?.runtime,
        });
        markDebugSessionStopped(descriptor);
      }
      runtimeState.subRuntimeById.delete(subId);
    }
  }

  async function getOrCreateSubRuntime({ serverRecord, runtimeState, subServer, requiredJavaMajor = 17 }) {
    if (!runtimeState.subRuntimeById) {
      runtimeState.subRuntimeById = new Map();
    }
    const absoluteSubPath = resolveSubServerPath(serverRecord, subServer.path);
    const existing = runtimeState.subRuntimeById.get(subServer.id);
    const sameJava =
      !existing?.runtime?.__dsmDefaultRuntime || Number(existing?.javaMajor || 0) === Number(requiredJavaMajor || 0);
    if (existing && existing.path === absoluteSubPath && sameJava) {
      return existing.runtime;
    }
    if (existing) {
      const existingDescriptor = getDebugTargetDescriptor({
        serverRecord,
        targetType: "subserver",
        subServer: existing.subServer || subServer,
      });
      harvestRuntimeDebugErrors({
        ...existingDescriptor,
        runtime: existing.runtime,
      });
      await stopRuntime(existing.runtime);
      harvestRuntimeDebugErrors({
        ...existingDescriptor,
        runtime: existing.runtime,
      });
      markDebugSessionStopped(existingDescriptor);
      runtimeState.subRuntimeById.delete(subServer.id);
    }

    let javaPath = "java";
    if (useManagedJavaRuntimes) {
      const javaRuntime = await ensureManagedJavaRuntime(requiredJavaMajor);
      javaPath = javaRuntime.javaPath;
    }

    const runtime = createSubServerRuntime(serverRecord, { ...subServer, path: absoluteSubPath }, { javaExecutable: javaPath });
    runtimeState.subRuntimeById.set(subServer.id, {
      runtime,
      path: absoluteSubPath,
      processCpuSnapshot: null,
      javaMajor: Number(requiredJavaMajor || 0),
      javaPath,
      subServer: {
        id: subServer.id,
        name: subServer.name,
        port: Number(subServer.port || 0),
      },
    });
    syncRuntimeCursorToTail(runtime);
    return runtime;
  }

  async function startBungeeStack(serverRecord, runtimeState) {
    const meta = await reconcileBungeeServerState(serverRecord);
    const subServers = meta.serverKind === "bungeecord" ? meta.bungee?.subServers || [] : [];
    if (!subServers.length) {
      throw new Error("No sub-servers configured. Create at least one sub-server before starting BungeeCord.");
    }
    await syncSubRuntimeMap({ serverRecord, runtimeState, subServers });
    await ensureMainRuntimeJava({ serverRecord, runtimeState, meta });

    try {
      for (const subServer of subServers) {
        const absoluteSubPath = resolveSubServerPath(serverRecord, subServer.path);
        await ensureEulaAccepted(absoluteSubPath);
        const requiredJavaMajor = resolveJavaMajorForPaperVersion(subServer.version || "");
        const subRuntime = await getOrCreateSubRuntime({
          serverRecord,
          runtimeState,
          subServer: { ...subServer, path: absoluteSubPath },
          requiredJavaMajor,
        });
        const subDescriptor = getDebugTargetDescriptor({
          serverRecord,
          targetType: "subserver",
          subServer,
        });
        ensureDebugSessionStarted(subDescriptor);
        await subRuntime.start();
        harvestRuntimeDebugErrors({
          ...subDescriptor,
          runtime: subRuntime,
        });
        if (subRuntime?.__dsmDefaultRuntime) {
          await waitForLocalPortReady({
            name: subServer.name,
            port: subServer.port,
            timeoutMs: 90000,
            pollIntervalMs: 500,
          });
        }
      }
    } catch (error) {
      await stopAllSubRuntimes(runtimeState, serverRecord);
      throw error;
    }

    await ensureEulaAccepted(serverRecord.path);
    const mainDescriptor = getDebugTargetDescriptor({ serverRecord, targetType: "main" });
    ensureDebugSessionStarted(mainDescriptor);
    const status = await runtimeState.runtime.start();
    harvestRuntimeDebugErrors({
      ...mainDescriptor,
      runtime: runtimeState.runtime,
    });
    return status;
  }

  async function stopBungeeStack(serverRecord, runtimeState) {
    const mainDescriptor = getDebugTargetDescriptor({ serverRecord, targetType: "main" });
    harvestRuntimeDebugErrors({
      ...mainDescriptor,
      runtime: runtimeState.runtime,
    });
    const status = await runtimeState.runtime.stop();
    harvestRuntimeDebugErrors({
      ...mainDescriptor,
      runtime: runtimeState.runtime,
    });
    markDebugSessionStopped(mainDescriptor);
    await stopAllSubRuntimes(runtimeState, serverRecord);
    return status;
  }

  async function resolveAuthUser(req) {
    const token = parseAuthToken(req);
    if (!token) {
      return null;
    }
    const username = sessions.get(token);
    if (!username) {
      return null;
    }
    return accountManager.getUser(username);
  }

  async function requireAuth(req, res) {
    const user = await resolveAuthUser(req);
    if (!user) {
      jsonResponse(res, 401, { error: "Authentication required" });
      return null;
    }
    return user;
  }

  async function resolveServerForRequest({ req, user, body = null, url }) {
    const headerServerId = String(req.headers["x-dsm-server-id"] || "").trim();
    const bodyServerId = body && typeof body.serverId === "string" ? body.serverId.trim() : "";
    const queryServerId = url.searchParams.get("serverId") || "";
    const serverId = headerServerId || bodyServerId || queryServerId;
    const serverRecord = await accountManager.resolveServerForUser({ username: user.username, serverId });
    await fs.mkdir(serverRecord.path, { recursive: true });
    return serverRecord;
  }

  function hasServerPermission(serverRecord, permissionKey) {
    if (!permissionKey) {
      return true;
    }
    if (serverRecord?.accessType === "owner" || serverRecord?.accessType === "admin") {
      return true;
    }
    if (!COWORK_PERMISSION_KEYS.includes(permissionKey)) {
      return false;
    }
    return Boolean(serverRecord?.permissions?.[permissionKey]);
  }

  function requireServerPermission(res, serverRecord, permissionKey) {
    if (hasServerPermission(serverRecord, permissionKey)) {
      return true;
    }
    jsonResponse(res, 403, { error: "Permission denied" });
    return false;
  }

  function canManageCowork(user, serverRecord) {
    if (!user || !serverRecord) return false;
    return Boolean(user.isAdmin || serverRecord.ownerUsername === user.username);
  }

  function canUseExportImport(user, serverRecord) {
    if (!user || !serverRecord) return false;
    return Boolean(user.isAdmin || serverRecord.ownerUsername === user.username);
  }

  async function importServerForUser({ user, archivePayload }) {
    const normalizedArchive = normalizeArchivePayload(archivePayload);
    const importedName = String(normalizedArchive.server?.name || "").trim() || "Servidor Importado";
    let importedServer = null;
    try {
      importedServer = await accountManager.createServerForUser(user.username, importedName);
      const restoreStats = await restoreServerFromArchive(importedServer.path, normalizedArchive);
      await ensureImportedServerConfiguration(importedServer.path, normalizedArchive.server);
      return {
        ok: true,
        server: importedServer,
        importedName: restoreStats.importedName,
        restoredEntries: restoreStats.restoredEntries,
        restoredFiles: restoreStats.restoredFiles,
        restoredDirectories: restoreStats.restoredDirectories,
      };
    } catch (error) {
      if (importedServer?.id) {
        await accountManager.deleteServerForUser(user.username, importedServer.id).catch(() => {});
      }
      throw error;
    }
  }

  async function importServerForUserFromZip({ user, req }) {
    const tempZipPath = path.join(
      os.tmpdir(),
      `dsm-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.zip`
    );
    let importedServer = null;
    let restoreStats = null;

    try {
      const bytesRead = await streamRequestToFile(req, tempZipPath);
      if (!bytesRead) {
        throw new Error("Export file is required");
      }

      const zipDirectory = await unzipper.Open.file(tempZipPath);
      const files = Array.isArray(zipDirectory.files) ? zipDirectory.files : [];
      if (!files.length) {
        throw new Error("Invalid export file");
      }

      const archiveHeader = await loadArchiveHeaderFromZipDirectory(zipDirectory);
      importedServer = await accountManager.createServerForUser(user.username, archiveHeader.server.name);
      restoreStats = createArchiveRestoreStats(archiveHeader.server.name);

      const zipPaths = files.map((entry) => normalizeZipEntryPath(entry?.path));
      const zipRootPrefix = resolveZipRootPrefix(zipPaths);

      for (const entry of files) {
        const originalPath = normalizeZipEntryPath(entry?.path);
        if (!originalPath || originalPath.startsWith("__MACOSX/") || originalPath === "dsm-export.json") {
          continue;
        }

        let entryPath = originalPath;
        if (zipRootPrefix && entryPath.startsWith(zipRootPrefix)) {
          entryPath = entryPath.slice(zipRootPrefix.length);
        }
        entryPath = normalizeArchiveEntryPath(entryPath);
        if (!entryPath) {
          continue;
        }

        if (String(entry?.type || "").toLowerCase() === "directory") {
          await restoreArchiveEntry(
            importedServer.path,
            {
              type: "directory",
              path: entryPath,
            },
            restoreStats
          );
          continue;
        }

        const absoluteFile = resolveServerPath(importedServer.path, entryPath);
        await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
        await pipeline(entry.stream(), fsSync.createWriteStream(absoluteFile));
        restoreStats.restoredEntries += 1;
        restoreStats.restoredFiles += 1;
      }

      await ensureImportedServerConfiguration(importedServer.path, archiveHeader.server);
      return {
        ok: true,
        server: importedServer,
        importedName: restoreStats.importedName,
        restoredEntries: restoreStats.restoredEntries,
        restoredFiles: restoreStats.restoredFiles,
        restoredDirectories: restoreStats.restoredDirectories,
      };
    } catch (error) {
      if (importedServer?.id) {
        await accountManager.deleteServerForUser(user.username, importedServer.id).catch(() => {});
      }
      throw error;
    } finally {
      await fs.unlink(tempZipPath).catch(() => {});
    }
  }

  async function importServerForUserFromStream({ user, req }) {
    let importedServer = null;
    let restoreStats = null;
    let archiveHeader = null;
    try {
      await importArchiveFromJsonStream(req, {
        onHeader: async (headerPayload) => {
          const importedName = String(headerPayload?.server?.name || "").trim() || "Servidor Importado";
          archiveHeader = headerPayload;
          importedServer = await accountManager.createServerForUser(user.username, importedName);
          restoreStats = createArchiveRestoreStats(importedName);
        },
        onEntry: async (entry) => {
          if (!importedServer || !restoreStats) {
            throw new Error("Invalid export file");
          }
          await restoreArchiveEntry(importedServer.path, entry, restoreStats);
        },
      });

      if (!importedServer || !restoreStats) {
        throw new Error("Invalid export file");
      }

      await ensureImportedServerConfiguration(importedServer.path, archiveHeader?.server || {});
      return {
        ok: true,
        server: importedServer,
        importedName: restoreStats.importedName,
        restoredEntries: restoreStats.restoredEntries,
        restoredFiles: restoreStats.restoredFiles,
        restoredDirectories: restoreStats.restoredDirectories,
      };
    } catch (error) {
      if (importedServer?.id) {
        await accountManager.deleteServerForUser(user.username, importedServer.id).catch(() => {});
      }
      throw error;
    }
  }

  async function readNormalizedServerMeta(serverDir) {
    const meta = await readServerMeta(serverDir);
    return normalizeBungeeMeta(meta);
  }

  function resolveSubServerPath(serverRecord, subServerPath) {
    const serverRoot = path.resolve(serverRecord.path);
    const rawPath = String(subServerPath || "").trim();
    if (!rawPath) {
      throw new Error("Invalid sub-server path");
    }
    const normalizedPath = rawPath.replace(/\\/g, "/");
    const absoluteSubPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(serverRoot, normalizedPath.replace(/^\/+/, ""));
    if (absoluteSubPath !== serverRoot && !absoluteSubPath.startsWith(`${serverRoot}${path.sep}`)) {
      throw new Error("Invalid sub-server path");
    }
    return absoluteSubPath;
  }

  async function getSubServerContext({ req, body = null, url, serverRecord }) {
    const headerSubServerId = String(req.headers["x-dsm-sub-server-id"] || "").trim();
    const bodySubServerId = body && typeof body.subServerId === "string" ? body.subServerId.trim() : "";
    const querySubServerId = String(url.searchParams.get("subServerId") || "").trim();
    const subServerId = headerSubServerId || bodySubServerId || querySubServerId;
    if (!subServerId) {
      throw new Error("Sub-server id is required");
    }

    const meta = await readNormalizedServerMeta(serverRecord.path);
    if (meta.serverKind !== "bungeecord") {
      throw new Error("Current server is not bungeecord");
    }
    const subServer = (meta.bungee?.subServers || []).find((item) => item.id === subServerId);
    if (!subServer) {
      throw new Error("Sub-server not found");
    }
    const absoluteSubPath = resolveSubServerPath(serverRecord, subServer.path);

    return {
      meta,
      subServer,
      subServerId,
      targetDir: absoluteSubPath,
    };
  }

  async function getConsoleRuntimeContext({ req, body = null, url, serverRecord, runtimeState }) {
    const headerSubServerId = String(req.headers["x-dsm-sub-server-id"] || "").trim();
    const bodySubServerId = body && typeof body.subServerId === "string" ? body.subServerId.trim() : "";
    const querySubServerId = String(url.searchParams.get("subServerId") || "").trim();
    const subServerId = headerSubServerId || bodySubServerId || querySubServerId;

    if (!subServerId) {
      return {
        runtime: runtimeState.runtime,
        targetType: "main",
        targetId: "",
        targetName: "proxy",
      };
    }

    const meta = await readNormalizedServerMeta(serverRecord.path);
    if (meta.serverKind !== "bungeecord") {
      throw new Error("Current server is not bungeecord");
    }
    const subServers = Array.isArray(meta.bungee?.subServers) ? meta.bungee.subServers : [];
    const subServer = subServers.find((item) => item.id === subServerId);
    if (!subServer) {
      throw new Error("Sub-server not found");
    }

    await syncSubRuntimeMap({ serverRecord, runtimeState, subServers });
    const runtime = await getOrCreateSubRuntime({
      serverRecord,
      runtimeState,
      subServer,
      requiredJavaMajor: resolveJavaMajorForPaperVersion(subServer.version || ""),
    });
    return {
      runtime,
      targetType: "subserver",
      targetId: subServer.id,
      targetName: subServer.name,
    };
  }

  function getDebugDescriptorFromConsoleContext({ serverRecord, runtimeState, context }) {
    if (context?.targetType === "subserver") {
      const subServer = runtimeState?.subRuntimeById?.get(context.targetId)?.subServer || {
        id: context?.targetId || "",
        name: context?.targetName || "",
        port: 0,
      };
      return getDebugTargetDescriptor({
        serverRecord,
        targetType: "subserver",
        subServer,
      });
    }
    return getDebugTargetDescriptor({ serverRecord, targetType: "main" });
  }

  function toServerErrorStatus(error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("not found")) return 404;
    if (message.includes("required") || message.includes("invalid") || message.includes("cannot")) return 400;
    return 500;
  }

  async function resolvePluginContext({
    serverRecord,
    requestedVersion = "",
    requestedSubServerId = "",
    requireSubServer = false,
  }) {
    const meta = await readNormalizedServerMeta(serverRecord.path);
    const cleanedVersion = String(requestedVersion || "").trim();
    const cleanedSubServerId = String(requestedSubServerId || "").trim();

    if (meta.serverKind !== "bungeecord") {
      return {
        meta,
        serverVersion: cleanedVersion || String(meta.paperVersion || "").trim(),
        subServerId: "",
        subServerName: "",
        destinationDir: path.join(serverRecord.path, "plugins"),
      };
    }

    const subServers = Array.isArray(meta.bungee?.subServers) ? meta.bungee.subServers : [];
    if (requireSubServer && !cleanedSubServerId) {
      throw new Error("Sub-server id is required");
    }

    const subServerId = cleanedSubServerId || subServers[0]?.id || "";
    const subServer = subServers.find((item) => item.id === subServerId) || null;
    if (requireSubServer && !subServer) {
      throw new Error("Sub-server not found");
    }

    const selectedVersion = subServer ? String(subServer.version || "").trim() : "";
    const serverVersion = cleanedVersion || selectedVersion;
    const destinationRoot = subServer ? resolveSubServerPath(serverRecord, subServer.path) : serverRecord.path;
    return {
      meta,
      serverVersion,
      subServerId: subServer?.id || "",
      subServerName: subServer?.name || "",
      destinationDir: path.join(destinationRoot, "plugins"),
    };
  }

  async function getServerProfile(serverRecord) {
    const meta = await readServerMeta(serverRecord.path);
    return {
      meta,
      serverType: normalizeServerType(meta.serverType || "paper"),
      subServers: normalizeSubServers(meta.subServers),
    };
  }

  async function handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse(res, 200, { status: "ok", app: "DSM" });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const user = await accountManager.authenticate(body.username, body.password);
      if (!user) {
        return jsonResponse(res, 401, { error: "Invalid credentials" });
      }
      const token = accountManager.createSessionToken();
      sessions.set(token, user.username);
      return jsonResponse(res, 200, { token, user });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = parseAuthToken(req);
      if (token) {
        sessions.delete(token);
      }
      return jsonResponse(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const user = await requireAuth(req, res);
      if (!user) return true;
      return jsonResponse(res, 200, { user });
    }

    const user = await requireAuth(req, res);
    if (!user) {
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/home/servers") {
      const [servers, ownServers] = await Promise.all([
        accountManager.listAccessibleServers(user.username),
        accountManager.listServers(user.username),
      ]);
      return jsonResponse(res, 200, {
        servers,
        maxServers: user.maxServers,
        ownServersCount: ownServers.length,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/home/servers/import") {
      const body = await readJsonBody(req);
      const archiveBase64 = String(body.archiveBase64 || "").trim();
      if (!archiveBase64) {
        return jsonResponse(res, 400, { error: "Export file is required" });
      }

      let archivePayload;
      try {
        const decoded = Buffer.from(archiveBase64, "base64");
        archivePayload = JSON.parse(decoded.toString("utf8"));
      } catch {
        return jsonResponse(res, 400, { error: "Invalid export file" });
      }

      try {
        const payload = await importServerForUser({ user, archivePayload });
        return jsonResponse(res, 201, payload);
      } catch (error) {
        const status = /invalid export|export file is required/i.test(String(error?.message || ""))
          ? 400
          : toServerErrorStatus(error);
        return jsonResponse(res, status, { error: error.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/home/servers/import/file") {
      try {
        const importType = resolveImportPayloadType(req);
        const payload =
          importType === "zip"
            ? await importServerForUserFromZip({ user, req })
            : await importServerForUserFromStream({ user, req });
        return jsonResponse(res, 201, payload);
      } catch (error) {
        const status = /invalid export|export file is required/i.test(String(error?.message || ""))
          ? 400
          : toServerErrorStatus(error);
        return jsonResponse(res, status, { error: error.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/server/export/download") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!canUseExportImport(user, serverRecord)) {
        return jsonResponse(res, 403, { error: "Owner/Admin only" });
      }
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const meta = await readNormalizedServerMeta(serverRecord.path);
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `${sanitizeExportFileName(serverRecord.name)}-${stamp}.dsmexport.zip`;

      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${fileName}"`,
      });
      try {
        await streamServerArchiveZip({
          res,
          serverDir: serverRecord.path,
          serverName: serverRecord.name,
          serverKind: meta.serverKind || "paper",
          paperVersion: String(meta.paperVersion || ""),
        });
      } catch {
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {}
        }
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/home/servers") {
      const body = await readJsonBody(req);
      const serverRecord = await accountManager.createServerForUser(user.username, body.name);
      return jsonResponse(res, 201, { server: serverRecord });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/home/servers/")) {
      const serverId = decodeURIComponent(url.pathname.replace("/api/home/servers/", ""));
      let serverRecord;
      try {
        serverRecord = await accountManager.resolveServerForUser({ username: user.username, serverId });
      } catch (error) {
        if (String(error.message || "").toLowerCase().includes("not found")) {
          return jsonResponse(res, 404, { error: "Server not found" });
        }
        throw error;
      }
      const canDelete = Boolean(user.isAdmin || serverRecord.ownerUsername === user.username);
      if (!canDelete) {
        return jsonResponse(res, 403, { error: "Permission denied" });
      }
      const result = await accountManager.deleteServerForUser(serverRecord.ownerUsername || user.username, serverId);
      if (!result.deleted) {
        return jsonResponse(res, 404, { error: "Server not found" });
      }

      const runtimeState = runtimeStateByServerId.get(serverId);
      if (runtimeState?.runtime && typeof runtimeState.runtime.stop === "function") {
        const mainDescriptor = getDebugTargetDescriptor({ serverRecord, targetType: "main" });
        harvestRuntimeDebugErrors({
          ...mainDescriptor,
          runtime: runtimeState.runtime,
        });
        try {
          await runtimeState.runtime.stop();
        } catch {}
        harvestRuntimeDebugErrors({
          ...mainDescriptor,
          runtime: runtimeState.runtime,
        });
        markDebugSessionStopped(mainDescriptor);
      }
      await stopAllSubRuntimes(runtimeState, serverRecord);
      runtimeStateByServerId.delete(serverId);
      playersByServerId.delete(serverId);
      debugHistoryByServerId.delete(serverId);
      return jsonResponse(res, 200, { deleted: true, serverId });
    }

    if (req.method === "GET" && url.pathname === "/api/server/cowork") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!canManageCowork(user, serverRecord)) {
        return jsonResponse(res, 403, { error: "Permission denied" });
      }
      const [coworkers, usernames] = await Promise.all([
        accountManager.listCoworkAccess({
          ownerUsername: serverRecord.ownerUsername || user.username,
          serverId: serverRecord.id,
        }),
        accountManager.listUsernames(),
      ]);
      return jsonResponse(res, 200, {
        ownerUsername: serverRecord.ownerUsername || user.username,
        users: usernames.filter((name) => name !== (serverRecord.ownerUsername || user.username)),
        coworkers,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/server/cowork") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!canManageCowork(user, serverRecord)) {
        return jsonResponse(res, 403, { error: "Permission denied" });
      }
      try {
        const cowork = await accountManager.setCoworkAccess({
          ownerUsername: serverRecord.ownerUsername || user.username,
          serverId: serverRecord.id,
          targetUsername: body.targetUsername,
          permissions: body.permissions,
        });
        return jsonResponse(res, 200, { ok: true, cowork });
      } catch (error) {
        return jsonResponse(res, toServerErrorStatus(error), { error: error.message });
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/server/cowork/")) {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!canManageCowork(user, serverRecord)) {
        return jsonResponse(res, 403, { error: "Permission denied" });
      }
      const targetUsername = decodeURIComponent(url.pathname.replace("/api/server/cowork/", ""));
      try {
        const deleted = await accountManager.removeCoworkAccess({
          ownerUsername: serverRecord.ownerUsername || user.username,
          serverId: serverRecord.id,
          targetUsername,
        });
        return jsonResponse(res, 200, { deleted });
      } catch (error) {
        return jsonResponse(res, toServerErrorStatus(error), { error: error.message });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/admin/users") {
      if (!user.isAdmin) {
        return jsonResponse(res, 403, { error: "Admin only" });
      }
      const users = await accountManager.listUsers();
      return jsonResponse(res, 200, { users });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/users") {
      if (!user.isAdmin) {
        return jsonResponse(res, 403, { error: "Admin only" });
      }
      const body = await readJsonBody(req);
      const created = await accountManager.createUser({
        username: body.username,
        password: body.password,
        maxServers: body.maxServers,
      });
      return jsonResponse(res, 201, { user: created });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/users/")) {
      if (!user.isAdmin) {
        return jsonResponse(res, 403, { error: "Admin only" });
      }
      const username = decodeURIComponent(url.pathname.replace("/api/admin/users/", ""));
      const deleted = await accountManager.deleteUser(username);
      return jsonResponse(res, 200, { deleted });
    }

    if (req.method === "GET" && url.pathname === "/api/extensions") {
      const items = await registry.listExtensions();
      return jsonResponse(res, 200, { items });
    }

    if (req.method === "POST" && url.pathname === "/api/extensions") {
      const body = await readJsonBody(req);
      const created = await registry.installExtension(body);
      return jsonResponse(res, 201, created);
    }

    if (req.method === "GET" && url.pathname === "/api/system/stats") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      const meta = await readNormalizedServerMeta(serverRecord.path);
      const memoryTotalBytes = os.totalmem();
      const memoryFreeBytes = os.freemem();
      const memoryUsedBytes = memoryTotalBytes - memoryFreeBytes;
      const serverDirectorySizeBytes = await getDirectorySizeBytes(serverRecord.path);
      const runtimeState = getOrCreateRuntimeState(serverRecord);
      const { runtime } = runtimeState;
      const mainUsage = await getRuntimeResourceUsage({
        runtime,
        previousSnapshot: runtimeState.processCpuSnapshot,
      });
      runtimeState.processCpuSnapshot = mainUsage.snapshot;

      const usageSamples = [mainUsage];
      if (meta.serverKind === "bungeecord" && runtimeState?.subRuntimeById?.size) {
        for (const runtimeEntry of runtimeState.subRuntimeById.values()) {
          if (!runtimeEntry?.runtime) continue;
          const subUsage = await getRuntimeResourceUsage({
            runtime: runtimeEntry.runtime,
            previousSnapshot: runtimeEntry.processCpuSnapshot || null,
          });
          runtimeEntry.processCpuSnapshot = subUsage.snapshot;
          usageSamples.push(subUsage);
        }
      }

      const cpuUsagePercent = clampPercent(
        usageSamples.reduce((total, sample) => total + (Number(sample.cpuPercent) || 0), 0)
      );
      const serverMemoryBytes = usageSamples.reduce((total, sample) => total + (Number(sample.memoryBytes) || 0), 0);
      const serverMemoryGb = Number((serverMemoryBytes / (1024 * 1024 * 1024)).toFixed(2));
      const runtimeProcessCount = usageSamples.reduce(
        (count, sample) => (Number.isFinite(sample.pid) && sample.pid > 0 ? count + 1 : count),
        0
      );

      return jsonResponse(res, 200, {
        cpuUsagePercent: Number(cpuUsagePercent.toFixed(1)),
        memoryUsagePercent: Number(((memoryUsedBytes / memoryTotalBytes) * 100).toFixed(1)),
        memoryUsedBytes,
        memoryTotalBytes,
        serverMemoryBytes,
        serverMemoryGb,
        runtimeProcessCount,
        serverDirectorySizeBytes,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/server/status") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      const runtimeState = getOrCreateRuntimeState(serverRecord);
      const context = await getConsoleRuntimeContext({ req, url, serverRecord, runtimeState });
      return jsonResponse(res, 200, {
        ...context.runtime.getStatus(),
        targetType: context.targetType,
        targetId: context.targetId,
        targetName: context.targetName,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/server/info") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      const meta = await readNormalizedServerMeta(serverRecord.path);
      const propertiesPath = path.join(serverRecord.path, "server.properties");
      let propertiesRaw = "";
      try {
        propertiesRaw = await fs.readFile(propertiesPath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const propertiesEntries = parsePropertiesContent(propertiesRaw);
      const serverIp = String(propertiesEntries["server-ip"] || "").trim() || "0.0.0.0";
      const serverPort = String(propertiesEntries["server-port"] || "").trim() || "25565";
      return jsonResponse(res, 200, {
        paperVersion: typeof meta.paperVersion === "string" ? meta.paperVersion : "",
        updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : null,
        serverKind: meta.serverKind || "paper",
        bungeeSubServerCount: Array.isArray(meta.bungee?.subServers) ? meta.bungee.subServers.length : 0,
        serverIp,
        serverPort,
        serverAddress: `${serverIp}:${serverPort}`,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/java/manager/status") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const meta = await readNormalizedServerMeta(serverRecord.path);
      const requirements = getJavaRequirementsFromMeta(meta);
      const installed = useManagedJavaRuntimes ? await listManagedJavaRuntimes(requirements.requiredMajors) : [];
      const installedMajors = new Set(installed.filter((item) => item.installed).map((item) => item.major));
      const missingMajors = requirements.requiredMajors.filter((major) => !installedMajors.has(major));
      return jsonResponse(res, 200, {
        managerEnabled: useManagedJavaRuntimes,
        requirements,
        installed,
        missingMajors,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/java/manager/install") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "powerStart")) return true;
      if (!useManagedJavaRuntimes) {
        return jsonResponse(res, 400, { error: "Java Manager is disabled for custom runtime mode." });
      }

      const installMissing = Boolean(body.installMissing);
      const requestedMajor = Math.floor(Number(body.major || 0));
      const majorsToInstall = [];

      if (installMissing) {
        const meta = await readNormalizedServerMeta(serverRecord.path);
        const requirements = getJavaRequirementsFromMeta(meta);
        const installed = await listManagedJavaRuntimes(requirements.requiredMajors);
        for (const item of installed) {
          if (requirements.requiredMajors.includes(item.major) && !item.installed) {
            majorsToInstall.push(item.major);
          }
        }
      } else {
        if (!MANAGED_JAVA_MAJORS.includes(requestedMajor)) {
          return jsonResponse(res, 400, { error: `Unsupported Java version: ${requestedMajor}` });
        }
        majorsToInstall.push(requestedMajor);
      }

      const installedRuntimes = [];
      for (const major of majorsToInstall) {
        const runtime = await ensureManagedJavaRuntime(major);
        installedRuntimes.push({
          major: runtime.major,
          javaPath: runtime.javaPath,
          runtimeDir: runtime.runtimeDir,
        });
      }

      return jsonResponse(res, 200, {
        ok: true,
        installed: installedRuntimes,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/server/export") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!canUseExportImport(user, serverRecord)) {
        return jsonResponse(res, 403, { error: "Owner/Admin only" });
      }
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const meta = await readNormalizedServerMeta(serverRecord.path);
      const archive = {
        format: SERVER_EXPORT_FORMAT,
        exportedAt: new Date().toISOString(),
        server: {
          name: String(serverRecord.name || "Servidor"),
          serverKind: meta.serverKind || "paper",
          paperVersion: String(meta.paperVersion || ""),
        },
        entries: await collectServerArchiveEntries(serverRecord.path),
      };
      const json = JSON.stringify(archive);
      const stamp = new Date().toISOString().slice(0, 10);
      return jsonResponse(res, 200, {
        ok: true,
        fileName: `${sanitizeExportFileName(serverRecord.name)}-${stamp}.dsmexport.json`,
        sizeBytes: Buffer.byteLength(json),
        archive,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/server/console") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      const runtimeState = getOrCreateRuntimeState(serverRecord);
      const context = await getConsoleRuntimeContext({ req, url, serverRecord, runtimeState });
      const debugDescriptor = getDebugDescriptorFromConsoleContext({
        serverRecord,
        runtimeState,
        context,
      });
      harvestRuntimeDebugErrors({
        ...debugDescriptor,
        runtime: context.runtime,
      });
      return jsonResponse(res, 200, {
        lines: context.runtime.getConsoleLines(),
        status: context.runtime.getStatus(),
        targetType: context.targetType,
        targetId: context.targetId,
        targetName: context.targetName,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/server/debug/logs") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;

      const runtimeState = getOrCreateRuntimeState(serverRecord);
      const meta = await readNormalizedServerMeta(serverRecord.path);

      const mainDescriptor = getDebugTargetDescriptor({ serverRecord, targetType: "main" });
      ensureDebugTargetState(mainDescriptor);
      harvestRuntimeDebugErrors({
        ...mainDescriptor,
        runtime: runtimeState.runtime,
      });

      if (meta.serverKind === "bungeecord") {
        const subServers = Array.isArray(meta.bungee?.subServers) ? meta.bungee.subServers : [];
        for (const subServer of subServers) {
          const descriptor = getDebugTargetDescriptor({
            serverRecord,
            targetType: "subserver",
            subServer,
          });
          ensureDebugTargetState(descriptor);
          const runtimeEntry = runtimeState.subRuntimeById?.get(subServer.id);
          harvestRuntimeDebugErrors({
            ...descriptor,
            runtime: runtimeEntry?.runtime,
          });
        }
      }

      return jsonResponse(res, 200, {
        generatedAt: new Date().toISOString(),
        targets: getDebugTargetsForServer(serverRecord.id),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/server/players") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      const players = Array.from(playersByServerId.get(serverRecord.id) || []);
      return jsonResponse(res, 200, {
        onlineCount: players.length,
        players: players.map((name) => ({
          name,
          headUrl: `https://mc-heads.net/avatar/${encodeURIComponent(name)}/32`,
          nameMcUrl: `https://namemc.com/profile/${encodeURIComponent(name)}`,
        })),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/server/command") {
      const body = await readJsonBody(req);
      const command = String(body.command || "").trim();
      if (!command) {
        return jsonResponse(res, 400, { error: "Command is required" });
      }
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "consoleCommand")) return true;
      const runtimeState = getOrCreateRuntimeState(serverRecord);
      const context = await getConsoleRuntimeContext({ req, body, url, serverRecord, runtimeState });
      context.runtime.sendCommand(command);
      const debugDescriptor = getDebugDescriptorFromConsoleContext({
        serverRecord,
        runtimeState,
        context,
      });
      harvestRuntimeDebugErrors({
        ...debugDescriptor,
        runtime: context.runtime,
      });
      return jsonResponse(res, 200, {
        ok: true,
        targetType: context.targetType,
        targetId: context.targetId,
        targetName: context.targetName,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/server/power") {
      const body = await readJsonBody(req);
      const action = String(body.action || "").trim().toLowerCase();
      if (!["start", "stop", "restart"].includes(action)) {
        return jsonResponse(res, 400, { error: "Invalid power action" });
      }
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (action === "start" && !requireServerPermission(res, serverRecord, "powerStart")) return true;
      if (["stop", "restart"].includes(action) && !requireServerPermission(res, serverRecord, "powerStopRestart")) {
        return true;
      }
      const runtimeState = getOrCreateRuntimeState(serverRecord);
      const meta = await readNormalizedServerMeta(serverRecord.path);
      const isBungee = meta.serverKind === "bungeecord";
      const mainDescriptor = getDebugTargetDescriptor({ serverRecord, targetType: "main" });
      let status;
      if (action === "start") {
        if (isBungee) {
          status = await startBungeeStack(serverRecord, runtimeState);
        } else {
          await ensureMainRuntimeJava({ serverRecord, runtimeState, meta });
          await stopAllSubRuntimes(runtimeState, serverRecord);
          await ensureEulaAccepted(serverRecord.path);
          ensureDebugSessionStarted(mainDescriptor);
          status = await runtimeState.runtime.start();
          harvestRuntimeDebugErrors({
            ...mainDescriptor,
            runtime: runtimeState.runtime,
          });
        }
      }
      if (action === "stop") {
        if (isBungee) {
          status = await stopBungeeStack(serverRecord, runtimeState);
        } else {
          harvestRuntimeDebugErrors({
            ...mainDescriptor,
            runtime: runtimeState.runtime,
          });
          status = await runtimeState.runtime.stop();
          harvestRuntimeDebugErrors({
            ...mainDescriptor,
            runtime: runtimeState.runtime,
          });
          markDebugSessionStopped(mainDescriptor);
          await stopAllSubRuntimes(runtimeState, serverRecord);
        }
        playersByServerId.set(serverRecord.id, new Set());
      }
      if (action === "restart") {
        if (isBungee) {
          await stopBungeeStack(serverRecord, runtimeState);
          status = await startBungeeStack(serverRecord, runtimeState);
        } else {
          await ensureMainRuntimeJava({ serverRecord, runtimeState, meta });
          await stopAllSubRuntimes(runtimeState, serverRecord);
          await ensureEulaAccepted(serverRecord.path);
          harvestRuntimeDebugErrors({
            ...mainDescriptor,
            runtime: runtimeState.runtime,
          });
          markDebugSessionStopped(mainDescriptor);
          status = await runtimeState.runtime.restart();
          ensureDebugSessionStarted(mainDescriptor);
          harvestRuntimeDebugErrors({
            ...mainDescriptor,
            runtime: runtimeState.runtime,
          });
        }
        playersByServerId.set(serverRecord.id, new Set());
      }
      return jsonResponse(res, 200, status);
    }

    if (req.method === "GET" && url.pathname === "/api/server/files") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const directory = url.searchParams.get("directory") || "";
      const listing = await listServerDirectory(serverRecord.path, directory);
      return jsonResponse(res, 200, listing);
    }

    if (req.method === "GET" && url.pathname === "/api/server/files/read") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const filePath = url.searchParams.get("path") || "";
      const absolute = resolveServerPath(serverRecord.path, filePath);
      const content = await fs.readFile(absolute, "utf8");
      return jsonResponse(res, 200, { path: filePath, content });
    }

    if (req.method === "POST" && url.pathname === "/api/server/files/write") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesEdit")) return true;
      const filePath = String(body.path || "");
      const content = String(body.content || "");
      const absolute = resolveServerPath(serverRecord.path, filePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
      return jsonResponse(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/server/files/rename") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesEdit")) return true;
      const sourcePath = String(body.path || "");
      const newName = String(body.newName || "");
      const result = await renameServerEntry(serverRecord.path, sourcePath, newName);
      return jsonResponse(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && url.pathname === "/api/server/files/upload") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesUpload")) return true;
      const directory = String(body.directory || "");
      const destinationDir = resolveServerPath(serverRecord.path, directory);
      await fs.mkdir(destinationDir, { recursive: true });
      const files = Array.isArray(body.files) ? body.files : [];
      let uploadedCount = 0;
      for (const file of files) {
        const relativePath = normalizeUploadPath(file.relativePath || file.name);
        if (!relativePath) continue;
        const absolute = resolveServerPath(destinationDir, relativePath);
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        const bytes = Buffer.from(String(file.contentBase64 || ""), "base64");
        await fs.writeFile(absolute, bytes);
        uploadedCount += 1;
      }
      return jsonResponse(res, 200, { ok: true, uploaded: uploadedCount });
    }

    if (req.method === "POST" && url.pathname === "/api/server/files/batch") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      const action = String(body.action || "");
      if (action === "delete" && !requireServerPermission(res, serverRecord, "filesDelete")) return true;
      if (["copy", "move", "extract"].includes(action) && !requireServerPermission(res, serverRecord, "filesEdit")) {
        return true;
      }
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const destinationDirectory = String(body.destinationDirectory || "");
      const results = await applyBatchFileAction(serverRecord.path, action, paths, destinationDirectory);
      return jsonResponse(res, 200, { ok: true, results });
    }

    if (req.method === "GET" && url.pathname === "/api/server/files/download") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const relPath = String(url.searchParams.get("path") || "");
      const absolute = resolveServerPath(serverRecord.path, relPath);
      const data = await fs.readFile(absolute);
      const fileName = path.basename(absolute);
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${fileName}"`,
        "content-length": data.length,
      });
      res.end(data);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/server/files/download-links") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const links = paths.map(
        (item) =>
          `/api/server/files/download?serverId=${encodeURIComponent(serverRecord.id)}&path=${encodeURIComponent(item)}`
      );
      return jsonResponse(res, 200, { links });
    }

    if (req.method === "GET" && url.pathname === "/api/server/subservers") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const meta = await reconcileBungeeServerState(serverRecord);
      if (meta.serverKind !== "bungeecord") {
        return jsonResponse(res, 400, { error: "Current server is not bungeecord" });
      }
      return jsonResponse(res, 200, {
        items: (meta.bungee?.subServers || []).map((item) => ({
          id: item.id,
          name: item.name,
          slug: item.slug,
          version: item.version || "",
          port: item.port,
          createdAt: item.createdAt || "",
        })),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/server/subservers") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesUpload")) return true;
      const meta = await readNormalizedServerMeta(serverRecord.path);
      if (meta.serverKind !== "bungeecord") {
        return jsonResponse(res, 400, { error: "Current server is not bungeecord" });
      }

      const name = sanitizeSubServerName(body.name);
      const version = String(body.version || "").trim();
      if (!name) {
        return jsonResponse(res, 400, { error: "Sub-server name is required" });
      }
      const versionUrl = getPaperVersionUrl(version);
      if (!versionUrl) {
        return jsonResponse(res, 404, { error: "Paper version not found" });
      }

      const existingNames = new Set((meta.bungee?.subServers || []).map((item) => item.name.toLowerCase()));
      if (existingNames.has(name.toLowerCase())) {
        return jsonResponse(res, 409, { error: "Sub-server with this name already exists" });
      }

      const nextPort = getNextAvailableSubServerPort(meta.bungee?.subServers || [], 25566);
      const id = `sub-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const slug = toSafeSlug(name) || id;
      const subServerPath = path.join(serverRecord.path, "servers", `${slug}-${id}`);
      await fs.mkdir(subServerPath, { recursive: true });
      await ensureEulaAccepted(subServerPath);
      await fs.writeFile(
        path.join(subServerPath, "server.properties"),
        [
          "motd=DSM Sub-Server",
          "online-mode=false",
          "server-ip=127.0.0.1",
          `server-port=${nextPort}`,
          "enable-query=false",
          "",
        ].join("\n"),
        "utf8"
      );
      await fs.writeFile(path.join(subServerPath, "spigot.yml"), "settings:\n  bungeecord: true\n", "utf8");
      await downloadPaperVersion({
        version,
        url: versionUrl,
        fileName: "paper.jar",
        destinationPath: path.join(subServerPath, "paper.jar"),
      });

      const newSubServer = {
        id,
        name,
        slug,
        path: subServerPath,
        port: nextPort,
        version,
        createdAt: new Date().toISOString(),
      };
      const nextSubServers = [...(meta.bungee?.subServers || []), newSubServer];
      await patchServerMeta(serverRecord.path, {
        serverKind: "bungeecord",
        bungee: {
          nextPort: getNextAvailableSubServerPort(nextSubServers, 25566),
          subServers: nextSubServers,
        },
      });
      return jsonResponse(res, 201, { subServer: newSubServer });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/server/subservers/")) {
      const subServerId = decodeURIComponent(url.pathname.replace("/api/server/subservers/", "")).trim();
      if (!subServerId) {
        return jsonResponse(res, 400, { error: "Sub-server id is required" });
      }

      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesDelete")) return true;
      const meta = await readNormalizedServerMeta(serverRecord.path);
      if (meta.serverKind !== "bungeecord") {
        return jsonResponse(res, 400, { error: "Current server is not bungeecord" });
      }

      const currentSubServers = Array.isArray(meta.bungee?.subServers) ? meta.bungee.subServers : [];
      const targetSubServer = currentSubServers.find((item) => item.id === subServerId);
      if (!targetSubServer) {
        return jsonResponse(res, 404, { error: "Sub-server not found" });
      }

      const runtimeState = runtimeStateByServerId.get(serverRecord.id);
      const subRuntimeEntry = runtimeState?.subRuntimeById?.get(subServerId);
      if (subRuntimeEntry) {
        const subDescriptor = getDebugTargetDescriptor({
          serverRecord,
          targetType: "subserver",
          subServer: subRuntimeEntry.subServer || targetSubServer,
        });
        harvestRuntimeDebugErrors({
          ...subDescriptor,
          runtime: subRuntimeEntry.runtime,
        });
        await stopRuntime(subRuntimeEntry.runtime);
        harvestRuntimeDebugErrors({
          ...subDescriptor,
          runtime: subRuntimeEntry.runtime,
        });
        markDebugSessionStopped(subDescriptor);
        runtimeState.subRuntimeById.delete(subServerId);
      }

      const subServerPath = resolveSubServerPath(serverRecord, targetSubServer.path);
      await fs.rm(subServerPath, { recursive: true, force: true });

      const nextSubServers = currentSubServers.filter((item) => item.id !== subServerId);
      const nextPort = getNextAvailableSubServerPort(nextSubServers, 25566);

      await patchServerMeta(serverRecord.path, {
        serverKind: "bungeecord",
        bungee: {
          nextPort,
          subServers: nextSubServers,
        },
      });
      return jsonResponse(res, 200, {
        ok: true,
        deletedSubServerId: subServerId,
        deletedSubServerName: targetSubServer.name,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/server/subservers/files") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const { targetDir } = await getSubServerContext({ req, url, serverRecord });
      const directory = url.searchParams.get("directory") || "";
      const listing = await listServerDirectory(targetDir, directory);
      return jsonResponse(res, 200, listing);
    }

    if (req.method === "GET" && url.pathname === "/api/server/subservers/files/read") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const { targetDir } = await getSubServerContext({ req, url, serverRecord });
      const filePath = url.searchParams.get("path") || "";
      const absolute = resolveServerPath(targetDir, filePath);
      const content = await fs.readFile(absolute, "utf8");
      return jsonResponse(res, 200, { path: filePath, content });
    }

    if (req.method === "POST" && url.pathname === "/api/server/subservers/files/write") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesEdit")) return true;
      const { targetDir } = await getSubServerContext({ req, body, url, serverRecord });
      const filePath = String(body.path || "");
      const content = String(body.content || "");
      const absolute = resolveServerPath(targetDir, filePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
      return jsonResponse(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/server/subservers/files/rename") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesEdit")) return true;
      const { targetDir } = await getSubServerContext({ req, body, url, serverRecord });
      const sourcePath = String(body.path || "");
      const newName = String(body.newName || "");
      const result = await renameServerEntry(targetDir, sourcePath, newName);
      return jsonResponse(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && url.pathname === "/api/server/subservers/files/upload") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesUpload")) return true;
      const { targetDir } = await getSubServerContext({ req, body, url, serverRecord });
      const directory = String(body.directory || "");
      const destinationDir = resolveServerPath(targetDir, directory);
      await fs.mkdir(destinationDir, { recursive: true });
      const files = Array.isArray(body.files) ? body.files : [];
      let uploadedCount = 0;
      for (const file of files) {
        const relativePath = normalizeUploadPath(file.relativePath || file.name);
        if (!relativePath) continue;
        const absolute = resolveServerPath(destinationDir, relativePath);
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        const bytes = Buffer.from(String(file.contentBase64 || ""), "base64");
        await fs.writeFile(absolute, bytes);
        uploadedCount += 1;
      }
      return jsonResponse(res, 200, { ok: true, uploaded: uploadedCount });
    }

    if (req.method === "POST" && url.pathname === "/api/server/subservers/files/batch") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      const action = String(body.action || "");
      if (action === "delete" && !requireServerPermission(res, serverRecord, "filesDelete")) return true;
      if (["copy", "move", "extract"].includes(action) && !requireServerPermission(res, serverRecord, "filesEdit")) {
        return true;
      }
      const { targetDir } = await getSubServerContext({ req, body, url, serverRecord });
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const destinationDirectory = String(body.destinationDirectory || "");
      const results = await applyBatchFileAction(targetDir, action, paths, destinationDirectory);
      return jsonResponse(res, 200, { ok: true, results });
    }

    if (req.method === "GET" && url.pathname === "/api/server/subservers/files/download") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const { targetDir, subServerId } = await getSubServerContext({ req, url, serverRecord });
      const relPath = String(url.searchParams.get("path") || "");
      const absolute = resolveServerPath(targetDir, relPath);
      const data = await fs.readFile(absolute);
      const fileName = path.basename(absolute);
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${fileName}"`,
        "x-dsm-sub-server-id": subServerId,
        "content-length": data.length,
      });
      res.end(data);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/server/subservers/files/download-links") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const { subServerId } = await getSubServerContext({ req, body, url, serverRecord });
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const links = paths.map(
        (item) =>
          `/api/server/subservers/files/download?serverId=${encodeURIComponent(serverRecord.id)}&subServerId=${encodeURIComponent(subServerId)}&path=${encodeURIComponent(item)}`
      );
      return jsonResponse(res, 200, { links });
    }

    if (req.method === "GET" && url.pathname === "/api/server/properties") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      if (!requireServerPermission(res, serverRecord, "filesRead")) return true;
      const requestedSubServerId = String(url.searchParams.get("subServerId") || "").trim();
      let targetDir = serverRecord.path;
      let subServerId = "";
      if (requestedSubServerId) {
        const context = await getSubServerContext({ req, url, serverRecord });
        targetDir = context.targetDir;
        subServerId = context.subServerId;
      }
      const propertiesPath = path.join(targetDir, "server.properties");
      let raw = "";
      try {
        raw = await fs.readFile(propertiesPath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return jsonResponse(res, 200, { raw, entries: parsePropertiesContent(raw), subServerId });
    }

    if (req.method === "POST" && url.pathname === "/api/server/properties") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesEdit")) return true;
      const raw =
        typeof body.raw === "string"
          ? body.raw
          : stringifyPropertiesEntries(body.entries && typeof body.entries === "object" ? body.entries : {});
      const requestedSubServerId = String(body.subServerId || "").trim();
      let targetDir = serverRecord.path;
      let subServerId = "";
      if (requestedSubServerId) {
        const context = await getSubServerContext({ req, body, url, serverRecord });
        targetDir = context.targetDir;
        subServerId = context.subServerId;
      }
      const propertiesPath = path.join(targetDir, "server.properties");
      await fs.mkdir(path.dirname(propertiesPath), { recursive: true });
      await fs.writeFile(propertiesPath, raw.endsWith("\n") ? raw : `${raw}\n`, "utf8");
      return jsonResponse(res, 200, { ok: true, subServerId });
    }

    if (req.method === "GET" && url.pathname === "/api/plugins/search") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      const source = String(url.searchParams.get("source") || "");
      const query = String(url.searchParams.get("query") || "");
      const sort = String(url.searchParams.get("sort") || "");
      const limit = Number(url.searchParams.get("limit") || 20);
      const page = Number(url.searchParams.get("page") || 1);
      const requestedVersion = String(url.searchParams.get("serverVersion") || "").trim();
      const requestedSubServerId = String(url.searchParams.get("subServerId") || "").trim();
      const pluginContext = await resolvePluginContext({
        serverRecord,
        requestedVersion,
        requestedSubServerId,
      });
      const serverVersion = pluginContext.serverVersion;
      const result = await searchPlugins({
        source,
        query,
        sort,
        serverVersion,
        limit,
        page,
      });
      const normalized = Array.isArray(result)
        ? {
            items: result,
            totalHits: result.length,
            page,
            pageSize: limit,
            pageCount: 1,
          }
        : result;
      return jsonResponse(res, 200, {
        source,
        query,
        sort,
        serverVersion,
        subServerId: pluginContext.subServerId,
        ...normalized,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/plugins/details") {
      const serverRecord = await resolveServerForRequest({ req, user, url });
      const source = String(url.searchParams.get("source") || "");
      const projectId = String(url.searchParams.get("projectId") || "");
      const requestedVersion = String(url.searchParams.get("serverVersion") || "").trim();
      const requestedSubServerId = String(url.searchParams.get("subServerId") || "").trim();
      const pluginContext = await resolvePluginContext({
        serverRecord,
        requestedVersion,
        requestedSubServerId,
      });
      const serverVersion = pluginContext.serverVersion;
      const details = await getPluginDetails({
        source,
        projectId,
        serverVersion,
      });
      return jsonResponse(res, 200, {
        source,
        projectId,
        serverVersion,
        subServerId: pluginContext.subServerId,
        ...details,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/plugins/download") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesUpload")) return true;
      const source = String(body.source || "").trim().toLowerCase();
      const projectId = String(body.projectId || "").trim();
      const requestedVersion = String(body.serverVersion || "").trim();
      const requestedSubServerId = String(body.subServerId || "").trim();
      const pluginContext = await resolvePluginContext({
        serverRecord,
        requestedVersion,
        requestedSubServerId,
        requireSubServer: true,
      });
      const serverVersion = pluginContext.serverVersion;

      const resolved = await resolvePluginDownload({
        source,
        projectId,
        serverVersion,
      });

      const derivedName = sanitizeDownloadedFileName(
        resolved.fileName,
        `${source}-${projectId}.jar`
      );
      const destinationDir = pluginContext.destinationDir;
      const destinationPath = path.join(destinationDir, derivedName);
      const downloadMeta = await downloadBinary({
        url: resolved.downloadUrl,
        destinationPath,
      });

      return jsonResponse(res, 200, {
        ok: true,
        source,
        projectId,
        serverVersion,
        fileName: derivedName,
        bytesWritten: Number(downloadMeta.bytesWritten || 0),
        projectUrl: resolved.projectUrl || "",
        versionName: resolved.versionName || "",
        subServerId: pluginContext.subServerId,
        subServerName: pluginContext.subServerName,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/paper/versions") {
      return jsonResponse(res, 200, { items: listPaperVersions() });
    }

    if (req.method === "POST" && url.pathname === "/api/paper/download") {
      const body = await readJsonBody(req);
      const serverRecord = await resolveServerForRequest({ req, user, body, url });
      if (!requireServerPermission(res, serverRecord, "filesUpload")) return true;
      const targetKind = String(body.serverKind || "paper").trim().toLowerCase() === "bungeecord" ? "bungeecord" : "paper";
      const version = String(body.version || "").trim();
      const requestedInstallMode = String(body.installMode || "").trim().toLowerCase();
      const installMode = requestedInstallMode || "";
      if (installMode && !["replace_jar", "reinstall"].includes(installMode)) {
        return jsonResponse(res, 400, { error: "Invalid install mode" });
      }
      const currentMeta = await readNormalizedServerMeta(serverRecord.path);
      const currentVersion = String(currentMeta.paperVersion || "").trim();
      if (targetKind === "paper" && currentVersion && currentVersion !== version && !installMode) {
        return jsonResponse(res, 409, {
          error: "Version already installed",
          actionRequired: "version_change",
          currentVersion,
          requestedVersion: version,
          options: ["replace_jar", "reinstall"],
          warning:
            "Reinstalar o servidor inteiro remove todos os arquivos atuais.",
        });
      }

      if (installMode === "reinstall") {
        const runtimeState = runtimeStateByServerId.get(serverRecord.id);
        if (runtimeState?.runtime && typeof runtimeState.runtime.stop === "function") {
          const mainDescriptor = getDebugTargetDescriptor({ serverRecord, targetType: "main" });
          harvestRuntimeDebugErrors({
            ...mainDescriptor,
            runtime: runtimeState.runtime,
          });
          try {
            await runtimeState.runtime.stop();
          } catch {}
          harvestRuntimeDebugErrors({
            ...mainDescriptor,
            runtime: runtimeState.runtime,
          });
          markDebugSessionStopped(mainDescriptor);
        }
        await stopAllSubRuntimes(runtimeState, serverRecord);
        if (runtimeState) {
          runtimeState.processCpuSnapshot = null;
        }
        playersByServerId.set(serverRecord.id, new Set());
        await fs.mkdir(serverRecord.path, { recursive: true });
        await wipeDirectoryContents(serverRecord.path);
      }

      const fileName = "paper.jar";
      const destinationPath = path.join(serverRecord.path, fileName);
      let meta;
      let installedVersion = version;
      if (targetKind === "bungeecord") {
        meta = await downloadBinary({
          url: BUNGEECORD_JAR_URL,
          destinationPath,
        });
        installedVersion = "bungeecord";
        await patchServerMeta(serverRecord.path, {
          serverKind: "bungeecord",
          paperVersion: installedVersion,
          paperJar: fileName,
          installMode: installMode || "replace_jar",
          bungee: {
            nextPort: 25566,
            subServers: [],
          },
        });
      } else {
        const urlValue = getPaperVersionUrl(version);
        if (!urlValue) {
          return jsonResponse(res, 404, { error: "Version not found" });
        }
        meta = await downloadPaperVersion({
          version,
          url: urlValue,
          fileName,
          destinationPath,
        });
        await patchServerMeta(serverRecord.path, {
          serverKind: "paper",
          paperVersion: version,
          paperJar: fileName,
          installMode: installMode || "replace_jar",
          bungee: {
            nextPort: 25566,
            subServers: [],
          },
        });
        await ensureEulaAccepted(serverRecord.path);
      }
      return jsonResponse(res, 200, {
        ok: true,
        version: installedVersion,
        serverKind: targetKind,
        fileName,
        bytesWritten: meta.bytesWritten || 0,
        installModeApplied: installMode || "replace_jar",
        warning:
          installMode === "reinstall"
            ? "Servidor reinstalado: todos os arquivos anteriores foram removidos."
            : "",
      });
    }

    return false;
  }

  async function handleStatic(req, res, url) {
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const target = path.resolve(publicDir, `.${requested}`);
    if (!target.startsWith(publicDir)) {
      textResponse(res, 403, "Forbidden");
      return;
    }

    try {
      const content = await fs.readFile(target);
      const ext = path.extname(target).toLowerCase();
      const typeMap = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
      };
      res.writeHead(200, { "content-type": typeMap[ext] || "application/octet-stream" });
      res.end(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        textResponse(res, 404, "Not found");
        return;
      }
      throw error;
    }
  }

  const requestListener = async (req, res) => {
    try {
      const host = req.headers.host || "127.0.0.1";
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, url);
        if (handled !== false) {
          return;
        }
      }
      await handleStatic(req, res, url);
    } catch (error) {
      jsonResponse(res, 500, { error: error.message });
    }
  };

  return {
    get baseUrl() {
      return baseUrl;
    },

    async start(port = 3000, host = process.env.HOST || "127.0.0.1") {
      if (server) return;
      await fs.mkdir(resolvedServerDir, { recursive: true });
      server = http.createServer(requestListener);
      await new Promise((resolve) => {
        server.listen(port, host, resolve);
      });
      const address = server.address();
      const baseHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
      baseUrl = `http://${baseHost}:${address.port}`;
    },

    async stop() {
      if (!server) return;
      for (const runtimeState of runtimeStateByServerId.values()) {
        await stopRuntime(runtimeState?.runtime);
        await stopAllSubRuntimes(runtimeState);
      }
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      server = null;
      baseUrl = "";
      sessions.clear();
      runtimeStateByServerId.clear();
      playersByServerId.clear();
      debugHistoryByServerId.clear();
    },
  };
}

async function startFromCli() {
  const app = createServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  await app.start(port, host);
  // eslint-disable-next-line no-console
  console.log(`DSM running at ${app.baseUrl}`);
}

if (require.main === module) {
  startFromCli().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createServer,
};

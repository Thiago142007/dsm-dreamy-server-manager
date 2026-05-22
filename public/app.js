const PANEL_PAGES = ["console", "files", "servers", "versions", "properties", "plugins", "exportimport", "settings", "cowork", "debug", "home"];
const THEME_STORAGE_KEY = "dsm_theme";
const TOKEN_STORAGE_KEY = "dsm_token";
const TOKEN_SESSION_STORAGE_KEY = "dsm_token_session";
const SERVER_STORAGE_KEY = "dsm_server_id";

const DIFFICULTY_OPTIONS = [
  { value: "peaceful", label: "pacifico" },
  { value: "easy", label: "easy" },
  { value: "normal", label: "normal" },
  { value: "hard", label: "hard" },
];
const GAMEMODE_OPTIONS = ["survival", "creative", "adventure", "spectator"];
const BOOLEAN_PROPERTY_KEYS = new Set([
  "allow-flight",
  "allow-nether",
  "broadcast-console-to-ops",
  "enable-command-block",
  "enable-rcon",
  "enforce-whitelist",
  "force-gamemode",
  "hardcore",
  "online-mode",
  "pvp",
  "spawn-animals",
  "spawn-monsters",
  "spawn-npcs",
  "white-list",
]);

const PROPERTY_DESCRIPTIONS = {
  difficulty: "Define a dificuldade do mundo: easy, normal ou hard.",
  gamemode: "Modo de jogo padrao dos jogadores ao entrar no servidor.",
  motd: "Mensagem exibida na lista de servidores.",
  "max-players": "Numero maximo de jogadores simultaneos.",
  "online-mode": "Valida contas oficiais da Mojang/Microsoft (true/false).",
  "pvp": "Permite combate entre jogadores (true/false).",
  "allow-flight": "Permite jogadores voarem sem kick (true/false).",
  "spawn-monsters": "Permite spawn de monstros hostis (true/false).",
  "spawn-animals": "Permite spawn de animais passivos (true/false).",
  "spawn-npcs": "Permite spawn de NPCs (villagers) (true/false).",
  hardcore: "Ativa modo hardcore (morte permanente) (true/false).",
};

const COWORK_PERMISSION_LABELS = {
  consoleCommand: "Enviar comandos no console",
  powerStart: "Ligar o server",
  powerStopRestart: "Desligar/reiniciar o server",
  filesRead: "Ler arquivos",
  filesEdit: "Editar arquivos",
  filesUpload: "Fazer upload de arquivos",
  filesDelete: "Deletar arquivos",
};

const state = {
  token: "",
  currentUser: null,
  currentServerId: "",
  currentServerAccessType: "",
  homeServers: [],
  consoleAutoStickToBottom: true,
  selectedFilePaths: new Set(),
  currentFileEntries: [],
  editingFilePath: "",
  clipboard: { mode: null, paths: [] },
  subClipboard: { mode: null, paths: [] },
  currentDirectory: "",
  directoryHistory: [],
  playersPopoverOpen: false,
  autosaveTimer: null,
  serverVersion: "",
  pluginDetailsCache: new Map(),
  pluginPage: 1,
  pluginPageCount: 1,
  pluginPageSize: 20,
  pluginTotalHits: 0,
  pluginLoading: false,
  pluginTargetSubServerId: "",
  serverKind: "paper",
  selectedVersionKind: "paper",
  subServers: [],
  currentSubServerId: "",
  subCurrentDirectory: "",
  subDirectoryHistory: [],
  subSelectedFilePaths: new Set(),
  subCurrentFileEntries: [],
  subEditingFilePath: "",
  subServerContextTargetId: "",
  consoleTargetSubServerId: "",
  propertiesTargetSubServerId: "",
  fileContextTargetPath: "",
  fileContextScope: "main",
  lastKnownServerState: "",
  pendingPowerAction: "",
  pendingPowerActionAt: 0,
  lastCrashToastAt: 0,
  importArchiveFile: null,
  importArchiveFileName: "",
  coworkUsers: [],
  coworkEntries: [],
  debugTargets: [],
  bungeeManualNoticeServerId: "",
  javaMissingMajors: [],
  javaManagerEnabled: true,
};

function normalizePage(input) {
  if (typeof input !== "string") return "console";
  return input.replace(/^\/+/, "").trim().toLowerCase();
}

function resolvePageFromHash(hash) {
  if (!hash) return "console";
  const raw = hash.startsWith("#/") ? hash.slice(2) : hash.startsWith("#") ? hash.slice(1) : hash;
  const candidate = normalizePage(raw);
  return PANEL_PAGES.includes(candidate) ? candidate : "console";
}

function buildHashForPage(page) {
  return `#/${normalizePage(page)}`;
}

function basename(value) {
  const parts = String(value).split("/");
  return parts[parts.length - 1] || value;
}

function sortSubServersByPort(items = []) {
  const list = Array.isArray(items) ? [...items] : [];
  return list.sort((left, right) => {
    const leftPort = Number(left?.port || 0);
    const rightPort = Number(right?.port || 0);
    if (leftPort !== rightPort) {
      return leftPort - rightPort;
    }
    const leftName = String(left?.name || "");
    const rightName = String(right?.name || "");
    return leftName.localeCompare(rightName);
  });
}

function normalizeFileContextScope(scope) {
  return scope === "sub" ? "sub" : "main";
}

function isExtractableArchivePath(filePath) {
  return String(filePath || "").trim().toLowerCase().endsWith(".zip");
}

function setFileEntryButtonContent(button, entryType, name) {
  const icon = entryType === "directory" ? "\u{1F4C1}" : "\u{1F4C4}";
  button.textContent = "";
  const iconNode = document.createElement("span");
  iconNode.className = "file-entry-icon";
  iconNode.textContent = icon;
  const nameNode = document.createElement("span");
  nameNode.className = "file-entry-name";
  nameNode.textContent = name;
  button.append(iconNode, nameNode);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatUptimeLabel(status = {}) {
  const stateLabel = String(status.state || "").trim().toLowerCase();
  if (stateLabel !== "running") {
    return "Uptime: offline";
  }

  let totalSeconds = Math.max(0, Math.floor(Number(status.uptimeMs || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  totalSeconds -= days * 86400;
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds -= hours * 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return `Uptime: ${parts.join(" ")}`;
}

function formatCompactNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(numeric);
}

function formatRelativeDate(value) {
  if (!value) return "N/A";
  let date;
  if (typeof value === "number") {
    date = new Date(value * 1000);
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return "N/A";
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("pt-BR");
}

function formatDebugDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("pt-BR", { hour12: false });
}

function normalizeBooleanValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return "true";
  if (normalized === "false" || normalized === "0") return "false";
  return "";
}

function inferPropertyInputType(key, value) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  const normalizedBoolean = normalizeBooleanValue(value);
  if (normalizedKey === "difficulty") return "difficulty";
  if (normalizedKey === "gamemode") return "gamemode";
  if (BOOLEAN_PROPERTY_KEYS.has(normalizedKey) || normalizedBoolean) return "boolean";
  return "text";
}

function applyTheme(theme) {
  const safeTheme = ["green", "dark", "light"].includes(theme) ? theme : "green";
  elements.body.setAttribute("data-theme", safeTheme);
  localStorage.setItem(THEME_STORAGE_KEY, safeTheme);
  elements.themeSelect.value = safeTheme;
}

function getInitialTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return ["green", "dark", "light"].includes(stored) ? stored : "green";
}

function updateServersNavVisibility() {
  if (!elements.serversNavLink) return;
  const isBungee = state.serverKind === "bungeecord";
  elements.serversNavLink.classList.toggle("is-hidden", !isBungee);
  if (!isBungee && resolvePageFromHash(location.hash) === "servers") {
    location.hash = buildHashForPage("versions");
  }
}

function canUseExportImport() {
  if (!state.currentServerId) return false;
  return state.currentServerAccessType !== "cowork";
}

function updateExportImportNavVisibility() {
  if (!elements.exportImportNavLink) return;
  const visible = canUseExportImport();
  elements.exportImportNavLink.classList.toggle("is-hidden", !visible);
  if (!visible && resolvePageFromHash(location.hash) === "exportimport") {
    location.hash = buildHashForPage("console");
  }
}

function setVersionKind(kind) {
  const safeKind = kind === "bungeecord" ? "bungeecord" : "paper";
  state.selectedVersionKind = safeKind;
  const isPaper = safeKind === "paper";
  elements.paperInstallPanel.classList.toggle("is-hidden", !isPaper);
  elements.bungeeInstallPanel.classList.toggle("is-hidden", isPaper);
  elements.selectPaperKindButton.classList.toggle("is-active", isPaper);
  elements.selectBungeeKindButton.classList.toggle("is-active", !isPaper);
}

function getSelectedPluginSubServer() {
  const selectedId = String(elements.pluginSubServerSelect?.value || state.pluginTargetSubServerId || "").trim();
  if (!selectedId) return null;
  state.pluginTargetSubServerId = selectedId;
  return state.subServers.find((item) => item.id === state.pluginTargetSubServerId) || null;
}

function syncPluginTargetFromServer() {
  const isBungee = state.serverKind === "bungeecord";
  const currentVersion = state.serverVersion || "";
  elements.pluginSubServerWrap.classList.toggle("is-hidden", !isBungee);
  elements.pluginServerVersionWrap.classList.toggle("is-hidden", isBungee);
  elements.pluginServerVersionInput.readOnly = isBungee;

  if (!isBungee) {
    state.pluginTargetSubServerId = "";
    elements.pluginSubServerSelect.innerHTML = "";
    elements.pluginServerVersionInput.value = currentVersion;
    return;
  }

  const previous = state.pluginTargetSubServerId;
  const candidates = Array.isArray(state.subServers) ? state.subServers : [];
  if (!candidates.some((item) => item.id === previous)) {
    state.pluginTargetSubServerId = candidates[0]?.id || "";
  }

  elements.pluginSubServerSelect.innerHTML = "";
  for (const sub of candidates) {
    const option = document.createElement("option");
    option.value = sub.id;
    option.textContent = `${sub.name} (${sub.version || "sem versao"})`;
    option.selected = sub.id === state.pluginTargetSubServerId;
    elements.pluginSubServerSelect.append(option);
  }
  elements.pluginSubServerSelect.disabled = !candidates.length;
  elements.pluginSubServerSelect.value = state.pluginTargetSubServerId || "";

  const selected = getSelectedPluginSubServer();
  elements.pluginServerVersionInput.value = selected?.version || currentVersion || "";
}

function getSelectedPropertiesSubServer() {
  const selectedId = String(elements.propertiesSubServerSelect?.value || state.propertiesTargetSubServerId || "").trim();
  if (!selectedId) return null;
  state.propertiesTargetSubServerId = selectedId;
  return state.subServers.find((item) => item.id === state.propertiesTargetSubServerId) || null;
}

function syncPropertiesTargetFromServer() {
  const isBungee = state.serverKind === "bungeecord";
  elements.propertiesSubServerWrap.classList.toggle("is-hidden", !isBungee);

  if (!isBungee) {
    state.propertiesTargetSubServerId = "";
    elements.propertiesSubServerSelect.innerHTML = "";
    return;
  }

  const previous = state.propertiesTargetSubServerId;
  const candidates = Array.isArray(state.subServers) ? state.subServers : [];
  if (!candidates.some((item) => item.id === previous)) {
    state.propertiesTargetSubServerId = candidates[0]?.id || "";
  }

  elements.propertiesSubServerSelect.innerHTML = "";
  for (const sub of candidates) {
    const option = document.createElement("option");
    option.value = sub.id;
    option.textContent = `${sub.name} (${sub.version || "sem versao"})`;
    option.selected = sub.id === state.propertiesTargetSubServerId;
    elements.propertiesSubServerSelect.append(option);
  }
  elements.propertiesSubServerSelect.disabled = !candidates.length;
  elements.propertiesSubServerSelect.value = state.propertiesTargetSubServerId || "";
}

function getSelectedConsoleTarget() {
  if (state.serverKind !== "bungeecord") {
    return { subServerId: "", label: "Proxy" };
  }
  const selectedValue = String(elements.consoleTargetSelect?.value || state.consoleTargetSubServerId || "main").trim();
  if (!selectedValue || selectedValue === "main") {
    state.consoleTargetSubServerId = "";
    return { subServerId: "", label: "Proxy" };
  }
  const selectedSubServer = state.subServers.find((item) => item.id === selectedValue) || null;
  if (!selectedSubServer) {
    state.consoleTargetSubServerId = "";
    return { subServerId: "", label: "Proxy" };
  }
  state.consoleTargetSubServerId = selectedSubServer.id;
  return { subServerId: selectedSubServer.id, label: selectedSubServer.name || "Sub-servidor" };
}

function syncConsoleTargetFromServer() {
  if (!elements.consoleTargetWrap || !elements.consoleTargetSelect) return;
  const isBungee = state.serverKind === "bungeecord";
  elements.consoleTargetWrap.classList.toggle("is-hidden", !isBungee);

  if (!isBungee) {
    state.consoleTargetSubServerId = "";
    elements.consoleTargetSelect.innerHTML = "";
    return;
  }

  const previousSelection = state.consoleTargetSubServerId || "main";
  elements.consoleTargetSelect.innerHTML = "";
  const proxyOption = document.createElement("option");
  proxyOption.value = "main";
  proxyOption.textContent = "Proxy BungeeCord";
  elements.consoleTargetSelect.append(proxyOption);

  for (const sub of state.subServers) {
    const option = document.createElement("option");
    option.value = sub.id;
    option.textContent = `${sub.name} (${sub.port})`;
    elements.consoleTargetSelect.append(option);
  }

  const hasPreviousSelection =
    previousSelection === "main" || state.subServers.some((item) => item.id === previousSelection);
  const nextSelection = hasPreviousSelection ? previousSelection : "main";
  state.consoleTargetSubServerId = nextSelection === "main" ? "" : nextSelection;
  elements.consoleTargetSelect.value = nextSelection;
}

function getPluginTargetDescriptor() {
  const serverVersion = elements.pluginServerVersionInput.value.trim();
  if (state.serverKind !== "bungeecord") {
    return { serverVersion, subServerId: "" };
  }
  const selected = getSelectedPluginSubServer();
  if (!selected) {
    throw new Error("Selecione um sub-servidor para instalar plugins.");
  }
  return {
    serverVersion: String(selected.version || serverVersion || "").trim(),
    subServerId: selected.id,
  };
}

function setToken(token) {
  state.token = token || "";
  try {
    if (state.token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, state.token);
      sessionStorage.setItem(TOKEN_SESSION_STORAGE_KEY, state.token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(TOKEN_SESSION_STORAGE_KEY);
    }
  } catch {}
}

function setCurrentServerId(serverId) {
  state.currentServerId = serverId || "";
  if (state.currentServerId) {
    localStorage.setItem(SERVER_STORAGE_KEY, state.currentServerId);
  } else {
    localStorage.removeItem(SERVER_STORAGE_KEY);
  }
}

function showTemporaryMessage(message) {
  elements.healthText.textContent = message;
}

function showToast(message, type = "info", durationMs = 3200) {
  const text = String(message || "").trim();
  if (!text || !elements.toastStack) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = text;
  elements.toastStack.append(toast);

  const removeToast = () => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 220);
  };
  setTimeout(removeToast, Math.max(1200, Number(durationMs) || 3200));
}

function showManualBungeeConfigNotice({ force = false } = {}) {
  if (!state.currentServerId || state.serverKind !== "bungeecord") return;
  if (!force && state.bungeeManualNoticeServerId === state.currentServerId) return;
  state.bungeeManualNoticeServerId = state.currentServerId;
  showToast(
    "Config do BungeeCord nao e atualizado automaticamente. Configure manualmente o arquivo config.yml do proxy.",
    "warning",
    5200
  );
}

function updatePowerActionButtons({ serverState = "", hasServer = true } = {}) {
  const normalizedState = String(serverState || "").trim().toLowerCase();
  const isRunning = normalizedState === "running";

  for (const button of elements.powerButtons) {
    if (!hasServer) {
      button.disabled = true;
      continue;
    }
    const action = String(button.dataset.powerAction || "").toLowerCase();
    if (action === "start") {
      button.disabled = isRunning;
      continue;
    }
    if (action === "stop" || action === "restart") {
      button.disabled = !isRunning;
      continue;
    }
    button.disabled = false;
  }
}

function toTitle(page) {
  if (page === "home") return "Home";
  return page.charAt(0).toUpperCase() + page.slice(1);
}

function updatePageVisibility(page) {
  for (const section of elements.pageSections) {
    section.classList.toggle("is-hidden", section.dataset.page !== page);
  }
  for (const link of elements.navLinks) {
    link.classList.toggle("is-active", link.dataset.pageLink === page);
  }
  elements.pageTitle.textContent = toTitle(page);
}

function toggleLoginOverlay(show) {
  elements.loginOverlay.classList.toggle("is-hidden", !show);
}

async function requestJson(url, options = {}, meta = {}) {
  const headers = { ...(options.headers || {}) };
  if (meta.auth !== false && state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }
  if (meta.server !== false && state.currentServerId) {
    headers["x-dsm-server-id"] = state.currentServerId;
  }
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler imagem."));
    reader.readAsDataURL(blob);
  });
}

function setPropertiesServerIconPreviewDataUrl(dataUrl = "") {
  const safeDataUrl = String(dataUrl || "").trim();
  if (!elements.propertiesServerIconPreview) return;
  if (!safeDataUrl) {
    elements.propertiesServerIconPreview.removeAttribute("src");
    elements.propertiesServerIconPreview.classList.add("is-empty");
    return;
  }
  elements.propertiesServerIconPreview.src = safeDataUrl;
  elements.propertiesServerIconPreview.classList.remove("is-empty");
}

function resolvePropertiesIconTarget(selectedSubServer = null) {
  if (!state.currentServerId) {
    return { kind: "none" };
  }
  if (state.serverKind !== "bungeecord") {
    return {
      kind: "main",
      label: "servidor principal",
      downloadUrl: "/api/server/files/download?path=server-icon.png",
      uploadUrl: "/api/server/files/upload",
      uploadBodyBase: { directory: "" },
    };
  }

  const targetSubServer = selectedSubServer || getSelectedPropertiesSubServer();
  if (!targetSubServer) {
    return { kind: "missing-subserver" };
  }
  const encodedSubServerId = encodeURIComponent(targetSubServer.id);
  return {
    kind: "subserver",
    label: targetSubServer.name,
    downloadUrl: `/api/server/subservers/files/download?subServerId=${encodedSubServerId}&path=server-icon.png`,
    uploadUrl: "/api/server/subservers/files/upload",
    uploadBodyBase: { subServerId: targetSubServer.id, directory: "" },
  };
}

async function requestBlob(url, options = {}, meta = {}) {
  const headers = { ...(options.headers || {}) };
  if (meta.auth !== false && state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }
  if (meta.server !== false && state.currentServerId) {
    headers["x-dsm-server-id"] = state.currentServerId;
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) {
        message = data.error;
      }
    } catch {}
    throw new Error(message);
  }
  return response.blob();
}

async function normalizeServerIconFile(file) {
  if (!file) {
    throw new Error("Selecione uma imagem primeiro.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Imagem invalida. Use PNG, JPG ou WEBP."));
      img.src = objectUrl;
    });
    const sourceWidth = Number(image.naturalWidth || image.width || 0);
    const sourceHeight = Number(image.naturalHeight || image.height || 0);
    if (!sourceWidth || !sourceHeight) {
      throw new Error("Imagem invalida. Tente outra foto.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Nao foi possivel processar a imagem no navegador.");
    }
    context.imageSmoothingEnabled = true;
    context.clearRect(0, 0, 64, 64);
    context.drawImage(image, 0, 0, 64, 64);
    const dataUrl = canvas.toDataURL("image/png");
    const contentBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
    return {
      dataUrl,
      contentBase64,
      sourceWidth,
      sourceHeight,
      wasResized: sourceWidth !== 64 || sourceHeight !== 64,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadPropertiesServerIcon(selectedSubServer = null) {
  const target = resolvePropertiesIconTarget(selectedSubServer);
  if (target.kind === "none") {
    setPropertiesServerIconPreviewDataUrl("");
    elements.propertiesServerIconStatusText.textContent = "Sem servidor selecionado.";
    elements.propertiesServerIconInput.value = "";
    return;
  }
  if (target.kind === "missing-subserver") {
    setPropertiesServerIconPreviewDataUrl("");
    elements.propertiesServerIconStatusText.textContent = "Selecione um sub-servidor para configurar a foto.";
    elements.propertiesServerIconInput.value = "";
    return;
  }

  elements.propertiesServerIconStatusText.textContent = "Carregando foto...";
  const blob = await requestBlob(target.downloadUrl);
  if (!blob) {
    setPropertiesServerIconPreviewDataUrl("");
    elements.propertiesServerIconStatusText.textContent =
      target.kind === "subserver"
        ? `Sem foto definida para ${target.label}.`
        : "Sem foto definida para este servidor.";
    return;
  }
  const dataUrl = await blobToDataUrl(blob);
  setPropertiesServerIconPreviewDataUrl(dataUrl);
  elements.propertiesServerIconStatusText.textContent =
    target.kind === "subserver" ? `Foto carregada para ${target.label}.` : "Foto carregada.";
}

async function uploadPropertiesServerIcon(file) {
  const target = resolvePropertiesIconTarget();
  if (target.kind === "none") {
    throw new Error("Selecione um servidor antes de enviar a foto.");
  }
  if (target.kind === "missing-subserver") {
    throw new Error("Selecione um sub-servidor para enviar a foto.");
  }

  elements.propertiesServerIconStatusText.textContent = "Processando imagem...";
  const normalized = await normalizeServerIconFile(file);
  elements.propertiesServerIconStatusText.textContent = "Enviando foto...";

  await requestJson(target.uploadUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...target.uploadBodyBase,
      files: [
        {
          name: "server-icon.png",
          relativePath: "server-icon.png",
          contentBase64: normalized.contentBase64,
        },
      ],
    }),
  });

  setPropertiesServerIconPreviewDataUrl(normalized.dataUrl);
  const resizedMessage = normalized.wasResized
    ? `Foto enviada. Redimensionada automaticamente de ${normalized.sourceWidth}x${normalized.sourceHeight} para 64x64.`
    : "Foto enviada com 64x64.";
  elements.propertiesServerIconStatusText.textContent = resizedMessage;
  showToast(resizedMessage, "success");
}

function normalizeUploadRelativePath(value, fallbackName = "") {
  let raw = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!raw) {
    raw = String(fallbackName || "").trim();
  }
  const segments = raw
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== "." && item !== "..");
  return segments.join("/");
}

function dedupeUploadEntries(entries = []) {
  const unique = new Map();
  for (const entry of entries) {
    if (!entry || !entry.file) continue;
    const relativePath = normalizeUploadRelativePath(entry.relativePath, entry.file.name);
    if (!relativePath) continue;
    const key = `${relativePath}:${entry.file.size}:${entry.file.lastModified || 0}`;
    if (!unique.has(key)) {
      unique.set(key, { file: entry.file, relativePath });
    }
  }
  return Array.from(unique.values());
}

function createUploadEntriesFromFileList(fileList = []) {
  const rawEntries = Array.from(fileList).map((file) => ({
    file,
    relativePath: normalizeUploadRelativePath(file.webkitRelativePath || file.name, file.name),
  }));
  return dedupeUploadEntries(rawEntries);
}

function readDroppedFileFromEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDirectoryBatch(reader) {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function readAllDirectoryEntries(reader) {
  const entries = [];
  while (true) {
    const batch = await readDirectoryBatch(reader);
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

async function walkDroppedEntry(entry, prefix = "") {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await readDroppedFileFromEntry(entry);
    return [
      {
        file,
        relativePath: normalizeUploadRelativePath(`${prefix}${file.name}`, file.name),
      },
    ];
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = await readAllDirectoryEntries(reader);
    let result = [];
    for (const child of children) {
      const childEntries = await walkDroppedEntry(child, `${prefix}${entry.name}/`);
      result = result.concat(childEntries);
    }
    return result;
  }
  return [];
}

async function createUploadEntriesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];
  const items = Array.from(dataTransfer.items || []);
  const rootEntries = items
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (rootEntries.length) {
    let nested = [];
    for (const entry of rootEntries) {
      const extracted = await walkDroppedEntry(entry, "");
      nested = nested.concat(extracted);
    }
    return dedupeUploadEntries(nested);
  }

  return createUploadEntriesFromFileList(Array.from(dataTransfer.files || []));
}

async function convertUploadEntriesToPayload(uploadEntries = []) {
  const files = [];
  for (const entry of uploadEntries) {
    files.push({
      name: entry.file.name,
      relativePath: entry.relativePath,
      contentBase64: await fileToBase64(entry.file),
    });
  }
  return files;
}

function normalizeUploadEntriesInput(input = []) {
  if (!Array.isArray(input) || !input.length) return [];
  const first = input[0];
  const isUploadEntry =
    first && typeof first === "object" && Object.prototype.hasOwnProperty.call(first, "file");
  return isUploadEntry ? dedupeUploadEntries(input) : createUploadEntriesFromFileList(input);
}

const elements = {
  body: document.body,
  loginOverlay: document.getElementById("loginOverlay"),
  loginForm: document.getElementById("loginForm"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  toastStack: document.getElementById("toastStack"),
  pageTitle: document.getElementById("pageTitle"),
  pageSections: Array.from(document.querySelectorAll("[data-page]")),
  navLinks: Array.from(document.querySelectorAll("[data-page-link]")),
  serversNavLink: document.getElementById("serversNavLink"),
  exportImportNavLink: document.getElementById("exportImportNavLink"),
  healthBadge: document.getElementById("healthBadge"),
  healthText: document.getElementById("healthText"),
  cpuUsageText: document.getElementById("cpuUsageText"),
  ramUsageText: document.getElementById("ramUsageText"),
  serverSizeText: document.getElementById("serverSizeText"),
  serverVersionText: document.getElementById("serverVersionText"),
  serverIpText: document.getElementById("serverIpText"),
  onlinePlayersCount: document.getElementById("onlinePlayersCount"),
  consoleTargetWrap: document.getElementById("consoleTargetWrap"),
  consoleTargetSelect: document.getElementById("consoleTargetSelect"),
  togglePlayersButton: document.getElementById("togglePlayersButton"),
  playersPopover: document.getElementById("playersPopover"),
  playersList: document.getElementById("playersList"),
  exportServerButton: document.getElementById("exportServerButton"),
  importServerFileInput: document.getElementById("importServerFileInput"),
  importServerButton: document.getElementById("importServerButton"),
  exportImportStatusText: document.getElementById("exportImportStatusText"),
  powerButtons: Array.from(document.querySelectorAll("[data-power-action]")),
  commandForm: document.getElementById("commandForm"),
  commandInput: document.getElementById("commandInput"),
  consoleOutput: document.getElementById("consoleOutput"),
  serverDirectoryInput: document.getElementById("serverDirectoryInput"),
  backDirectoryButton: document.getElementById("backDirectoryButton"),
  refreshServerFilesButton: document.getElementById("refreshServerFilesButton"),
  goDirectoryButton: document.getElementById("goDirectoryButton"),
  upDirectoryButton: document.getElementById("upDirectoryButton"),
  fileUploadInput: document.getElementById("fileUploadInput"),
  fileFolderUploadInput: document.getElementById("fileFolderUploadInput"),
  selectAllFilesButton: document.getElementById("selectAllFilesButton"),
  downloadSelectedFilesButton: document.getElementById("downloadSelectedFilesButton"),
  deleteSelectedFilesButton: document.getElementById("deleteSelectedFilesButton"),
  copySelectedFilesButton: document.getElementById("copySelectedFilesButton"),
  cutSelectedFilesButton: document.getElementById("cutSelectedFilesButton"),
  pasteClipboardFilesButton: document.getElementById("pasteClipboardFilesButton"),
  serverFilesDropZone: document.getElementById("serverFilesDropZone"),
  serverItemsList: document.getElementById("serverItemsList"),
  editingFileLabel: document.getElementById("editingFileLabel"),
  fileEditorText: document.getElementById("fileEditorText"),
  saveEditedFileButton: document.getElementById("saveEditedFileButton"),
  paperVersionSelect: document.getElementById("paperVersionSelect"),
  downloadSelectedVersionButton: document.getElementById("downloadSelectedVersionButton"),
  paperVersionsList: document.getElementById("paperVersionsList"),
  selectPaperKindButton: document.getElementById("selectPaperKindButton"),
  selectBungeeKindButton: document.getElementById("selectBungeeKindButton"),
  paperInstallPanel: document.getElementById("paperInstallPanel"),
  bungeeInstallPanel: document.getElementById("bungeeInstallPanel"),
  installBungeeButton: document.getElementById("installBungeeButton"),
  versionsStatusText: document.getElementById("versionsStatusText"),
  createSubServerForm: document.getElementById("createSubServerForm"),
  newSubServerNameInput: document.getElementById("newSubServerNameInput"),
  newSubServerVersionSelect: document.getElementById("newSubServerVersionSelect"),
  subServersList: document.getElementById("subServersList"),
  serversStatusText: document.getElementById("serversStatusText"),
  subServerDirectoryInput: document.getElementById("subServerDirectoryInput"),
  backSubDirectoryButton: document.getElementById("backSubDirectoryButton"),
  refreshSubServerFilesButton: document.getElementById("refreshSubServerFilesButton"),
  goSubDirectoryButton: document.getElementById("goSubDirectoryButton"),
  upSubDirectoryButton: document.getElementById("upSubDirectoryButton"),
  subFileUploadInput: document.getElementById("subFileUploadInput"),
  subFolderUploadInput: document.getElementById("subFolderUploadInput"),
  downloadSubSelectedFilesButton: document.getElementById("downloadSubSelectedFilesButton"),
  copySubSelectedFilesButton: document.getElementById("copySubSelectedFilesButton"),
  cutSubSelectedFilesButton: document.getElementById("cutSubSelectedFilesButton"),
  pasteSubClipboardFilesButton: document.getElementById("pasteSubClipboardFilesButton"),
  deleteSubSelectedFilesButton: document.getElementById("deleteSubSelectedFilesButton"),
  subServerFilesDropZone: document.getElementById("subServerFilesDropZone"),
  subServerItemsList: document.getElementById("subServerItemsList"),
  subEditingFileLabel: document.getElementById("subEditingFileLabel"),
  subFileEditorText: document.getElementById("subFileEditorText"),
  saveSubEditedFileButton: document.getElementById("saveSubEditedFileButton"),
  subServerContextMenu: document.getElementById("subServerContextMenu"),
  subServerContextDelete: document.getElementById("subServerContextDelete"),
  fileContextMenu: document.getElementById("fileContextMenu"),
  fileContextDelete: document.getElementById("fileContextDelete"),
  fileContextCopy: document.getElementById("fileContextCopy"),
  fileContextCut: document.getElementById("fileContextCut"),
  fileContextRename: document.getElementById("fileContextRename"),
  fileContextExtract: document.getElementById("fileContextExtract"),
  propertiesTable: document.getElementById("propertiesTable"),
  propertiesStatusText: document.getElementById("propertiesStatusText"),
  propertiesServerIconPreview: document.getElementById("propertiesServerIconPreview"),
  propertiesServerIconInput: document.getElementById("propertiesServerIconInput"),
  propertiesServerIconStatusText: document.getElementById("propertiesServerIconStatusText"),
  propertiesSubServerWrap: document.getElementById("propertiesSubServerWrap"),
  propertiesSubServerSelect: document.getElementById("propertiesSubServerSelect"),
  pluginSearchForm: document.getElementById("pluginSearchForm"),
  pluginSourceSelect: document.getElementById("pluginSourceSelect"),
  pluginSortSelect: document.getElementById("pluginSortSelect"),
  pluginViewSelect: document.getElementById("pluginViewSelect"),
  pluginRefreshButton: document.getElementById("pluginRefreshButton"),
  pluginPrevPageButton: document.getElementById("pluginPrevPageButton"),
  pluginNextPageButton: document.getElementById("pluginNextPageButton"),
  pluginPageInfo: document.getElementById("pluginPageInfo"),
  pluginServerVersionWrap: document.getElementById("pluginServerVersionWrap"),
  pluginServerVersionInput: document.getElementById("pluginServerVersionInput"),
  pluginSubServerWrap: document.getElementById("pluginSubServerWrap"),
  pluginSubServerSelect: document.getElementById("pluginSubServerSelect"),
  pluginQueryInput: document.getElementById("pluginQueryInput"),
  pluginsStatusText: document.getElementById("pluginsStatusText"),
  pluginsResultsList: document.getElementById("pluginsResultsList"),
  refreshJavaManagerButton: document.getElementById("refreshJavaManagerButton"),
  installMissingJavaButton: document.getElementById("installMissingJavaButton"),
  javaManagerStatusText: document.getElementById("javaManagerStatusText"),
  javaManagerList: document.getElementById("javaManagerList"),
  themeSelect: document.getElementById("themeSelect"),
  homeLimitsText: document.getElementById("homeLimitsText"),
  createHomeServerForm: document.getElementById("createHomeServerForm"),
  newHomeServerNameInput: document.getElementById("newHomeServerNameInput"),
  homeServersList: document.getElementById("homeServersList"),
  adminPanelCard: document.getElementById("adminPanelCard"),
  adminCreateUserForm: document.getElementById("adminCreateUserForm"),
  adminNewUsername: document.getElementById("adminNewUsername"),
  adminNewPassword: document.getElementById("adminNewPassword"),
  adminNewMaxServers: document.getElementById("adminNewMaxServers"),
  adminUsersList: document.getElementById("adminUsersList"),
  logoutButton: document.getElementById("logoutButton"),
  coworkGrantForm: document.getElementById("coworkGrantForm"),
  coworkTargetUser: document.getElementById("coworkTargetUser"),
  coworkPermConsoleCommand: document.getElementById("coworkPermConsoleCommand"),
  coworkPermPowerStart: document.getElementById("coworkPermPowerStart"),
  coworkPermPowerStopRestart: document.getElementById("coworkPermPowerStopRestart"),
  coworkPermFilesRead: document.getElementById("coworkPermFilesRead"),
  coworkPermFilesEdit: document.getElementById("coworkPermFilesEdit"),
  coworkPermFilesUpload: document.getElementById("coworkPermFilesUpload"),
  coworkPermFilesDelete: document.getElementById("coworkPermFilesDelete"),
  coworkStatusText: document.getElementById("coworkStatusText"),
  coworkList: document.getElementById("coworkList"),
  refreshCoworkButton: document.getElementById("refreshCoworkButton"),
  debugStatusText: document.getElementById("debugStatusText"),
  debugSessionsList: document.getElementById("debugSessionsList"),
  refreshDebugButton: document.getElementById("refreshDebugButton"),
};

async function authenticate(username, password) {
  const response = await requestJson(
    "/api/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    },
    { auth: false, server: false }
  );
  setToken(response.token);
  state.currentUser = response.user;
  showToast(`Bem-vindo, ${response.user.username}!`, "success");
}

async function hydrateAuthState() {
  let stored = "";
  try {
    stored = localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(TOKEN_SESSION_STORAGE_KEY) || "";
  } catch {}
  if (!stored) {
    return false;
  }
  setToken(stored);
  try {
    const response = await requestJson("/api/auth/me", {}, { server: false });
    state.currentUser = response.user;
    return true;
  } catch {
    setToken("");
    state.currentUser = null;
    return false;
  }
}

async function loadHomeServers() {
  const response = await requestJson("/api/home/servers", {}, { server: false });
  state.homeServers = response.servers || [];
  const ownServersCount = Number(response.ownServersCount || 0);
  elements.homeLimitsText.textContent = `Meus servidores: ${ownServersCount}/${response.maxServers} | Acessiveis: ${state.homeServers.length}`;

  if (!state.currentServerId) {
    const stored = localStorage.getItem(SERVER_STORAGE_KEY);
    if (stored && state.homeServers.some((server) => server.id === stored)) {
      setCurrentServerId(stored);
    }
  }
  if (!state.currentServerId && state.homeServers.length) {
    setCurrentServerId(state.homeServers[0].id);
  }
  const currentServer = state.homeServers.find((server) => server.id === state.currentServerId) || null;
  state.currentServerAccessType = String(currentServer?.accessType || "");
  updateExportImportNavVisibility();

  elements.homeServersList.innerHTML = "";
  if (!state.homeServers.length) {
    setCurrentServerId("");
    state.currentServerAccessType = "";
    updateExportImportNavVisibility();
    const li = document.createElement("li");
    li.textContent = "Nenhum servidor criado.";
    elements.homeServersList.append(li);
  } else {
    for (const server of state.homeServers) {
      const li = document.createElement("li");
      li.className = "home-server-item";

      const row = document.createElement("div");
      row.className = "home-server-row";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = server.id === state.currentServerId ? "" : "button-muted";
      const ownerSuffix =
        server.ownerUsername && server.ownerUsername !== state.currentUser?.username
          ? ` | dono: ${server.ownerUsername}`
          : "";
      const accessSuffix = server.accessType && server.accessType !== "owner" ? ` | acesso: ${server.accessType}` : "";
      openButton.textContent = `${server.name} (${server.id})${ownerSuffix}${accessSuffix}`;
      openButton.addEventListener("click", async () => {
        setCurrentServerId(server.id);
        state.currentServerAccessType = String(server.accessType || "");
        updateExportImportNavVisibility();
        await refreshServerScopedViews();
      });

      const canDelete = Boolean(
        state.currentUser?.isAdmin || (server.ownerUsername ? server.ownerUsername === state.currentUser?.username : true)
      );
      row.append(openButton);
      if (canDelete) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "button-danger";
        deleteButton.textContent = "Excluir";
        deleteButton.addEventListener("click", async () => {
          const shouldDelete = confirm(
            `Excluir o servidor \"${server.name}\"? Todos os arquivos dele serao removidos permanentemente.`
          );
          if (!shouldDelete) return;
          await requestJson(`/api/home/servers/${encodeURIComponent(server.id)}`, { method: "DELETE" }, { server: false });
          const wasCurrent = state.currentServerId === server.id;
          await loadHomeServers();
          if (wasCurrent) {
            await refreshServerScopedViews();
          }
        });
        row.append(deleteButton);
      }
      li.append(row);
      elements.homeServersList.append(li);
    }
  }
}

function renderJavaManagerList(payload = {}) {
  if (!elements.javaManagerList) return;
  elements.javaManagerList.innerHTML = "";

  const requirements = payload.requirements || {};
  const installed = Array.isArray(payload.installed) ? payload.installed : [];
  const missingMajors = Array.isArray(payload.missingMajors) ? payload.missingMajors : [];
  const installedByMajor = new Map(installed.map((item) => [Number(item.major || 0), item]));

  const mainRequirement = requirements.main || {};
  const mainLine = document.createElement("li");
  mainLine.textContent = `Principal (${mainRequirement.serverKind || "paper"} ${mainRequirement.paperVersion || "N/A"}): Java ${
    mainRequirement.requiredJavaMajor || "N/A"
  }`;
  elements.javaManagerList.append(mainLine);

  const subRequirements = Array.isArray(requirements.subServers) ? requirements.subServers : [];
  for (const sub of subRequirements) {
    const li = document.createElement("li");
    li.textContent = `Sub-server ${sub.name || sub.id || "N/A"} (${sub.version || "N/A"}): Java ${sub.requiredJavaMajor || "N/A"}`;
    elements.javaManagerList.append(li);
  }

  for (const major of Array.from(new Set(missingMajors)).sort((a, b) => a - b)) {
    const li = document.createElement("li");
    li.textContent = `Java ${major}: faltando`;
    elements.javaManagerList.append(li);
  }

  for (const [major, entry] of Array.from(installedByMajor.entries()).sort((a, b) => a[0] - b[0])) {
    if (!entry?.installed) continue;
    const li = document.createElement("li");
    li.textContent = `Java ${major}: instalado (${entry.javaPath || "caminho desconhecido"})`;
    elements.javaManagerList.append(li);
  }

  if (!elements.javaManagerList.children.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhuma informacao de Java encontrada.";
    elements.javaManagerList.append(li);
  }
}

async function loadJavaManagerStatus() {
  if (!elements.javaManagerStatusText || !elements.installMissingJavaButton) return;
  if (!state.currentServerId) {
    state.javaMissingMajors = [];
    state.javaManagerEnabled = true;
    elements.installMissingJavaButton.disabled = true;
    elements.javaManagerStatusText.textContent = "Selecione um servidor para ver o status do Java Manager.";
    renderJavaManagerList({});
    return;
  }

  const payload = await requestJson("/api/java/manager/status");
  state.javaMissingMajors = Array.isArray(payload.missingMajors) ? payload.missingMajors : [];
  state.javaManagerEnabled = payload.managerEnabled !== false;

  if (!state.javaManagerEnabled) {
    elements.javaManagerStatusText.textContent = "Java Manager desativado (modo de runtime customizado).";
    elements.installMissingJavaButton.disabled = true;
  } else if (state.javaMissingMajors.length) {
    elements.javaManagerStatusText.textContent = `Faltam ${state.javaMissingMajors.length} versao(oes) do Java: ${state.javaMissingMajors.join(
      ", "
    )}.`;
    elements.installMissingJavaButton.disabled = false;
  } else {
    elements.javaManagerStatusText.textContent = "Todos os Javas necessarios estao instalados.";
    elements.installMissingJavaButton.disabled = true;
  }

  renderJavaManagerList(payload);
}

async function installMissingJavaRuntimes() {
  if (!state.currentServerId) {
    showToast("Selecione um servidor primeiro.", "warning");
    return;
  }
  if (!state.javaManagerEnabled) {
    showToast("Java Manager desativado para este modo de runtime.", "warning");
    return;
  }
  if (!state.javaMissingMajors.length) {
    showToast("Nenhum Java faltando no momento.", "info");
    return;
  }

  await requestJson("/api/java/manager/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installMissing: true }),
  });
  await loadJavaManagerStatus();
  showToast("Java(s) faltante(s) instalado(s) com sucesso.", "success");
}

function clearServerScopedUi() {
  elements.cpuUsageText.textContent = "0%";
  elements.ramUsageText.textContent = "0.00 GB";
  elements.serverSizeText.textContent = "0 MB";
  elements.serverVersionText.textContent = "N/A";
  elements.serverIpText.textContent = "N/A";
  elements.consoleOutput.textContent = "[SYS] Selecione ou crie um servidor na aba Home.";
  state.lastKnownServerState = "";
  state.pendingPowerAction = "";
  state.pendingPowerActionAt = 0;
  state.lastCrashToastAt = 0;
  elements.onlinePlayersCount.textContent = "Uptime: offline";
  state.consoleTargetSubServerId = "";
  state.playersPopoverOpen = false;
  if (elements.playersPopover) elements.playersPopover.classList.add("is-hidden");
  if (elements.togglePlayersButton) elements.togglePlayersButton.classList.add("is-hidden");
  renderPlayers([]);

  state.currentDirectory = "";
  state.directoryHistory = [];
  elements.serverDirectoryInput.value = "";
  state.currentFileEntries = [];
  state.selectedFilePaths.clear();
  state.clipboard = { mode: null, paths: [] };
  renderServerItems();

  state.editingFilePath = "";
  elements.editingFileLabel.textContent = "Nenhum arquivo selecionado.";
  elements.fileEditorText.value = "";

  elements.propertiesTable.innerHTML = "";
  elements.propertiesStatusText.textContent = "Sem servidor selecionado.";
  setPropertiesServerIconPreviewDataUrl("");
  elements.propertiesServerIconStatusText.textContent = "Sem servidor selecionado.";
  elements.propertiesServerIconInput.value = "";
  state.propertiesTargetSubServerId = "";
  elements.propertiesSubServerSelect.innerHTML = "";
  state.serverVersion = "";
  state.serverKind = "paper";
  state.currentServerAccessType = "";
  state.selectedVersionKind = "paper";
  syncConsoleTargetFromServer();
  setVersionKind("paper");
  elements.versionsStatusText.textContent = "Selecione o tipo de servidor para instalar.";
  elements.pluginServerVersionInput.value = "";
  state.pluginPage = 1;
  state.pluginPageCount = 1;
  state.pluginTotalHits = 0;
  elements.pluginPageInfo.textContent = "1 / 1";
  elements.pluginPrevPageButton.disabled = true;
  elements.pluginNextPageButton.disabled = true;
  elements.pluginsStatusText.textContent = "Sem servidor selecionado.";
  elements.pluginsResultsList.innerHTML = "";
  state.pluginDetailsCache.clear();
  state.pluginTargetSubServerId = "";
  elements.pluginSubServerSelect.innerHTML = "";
  state.subServers = [];
  state.currentSubServerId = "";
  state.subCurrentDirectory = "";
  state.subDirectoryHistory = [];
  state.subSelectedFilePaths.clear();
  state.subCurrentFileEntries = [];
  state.subEditingFilePath = "";
  state.subClipboard = { mode: null, paths: [] };
  elements.subServersList.innerHTML = "";
  elements.subServerItemsList.innerHTML = "";
  elements.subServerDirectoryInput.value = "";
  elements.subEditingFileLabel.textContent = "Nenhum arquivo selecionado.";
  elements.subFileEditorText.value = "";
  closeSubServerContextMenu();
  closeFileContextMenu();
  elements.serversStatusText.textContent = "Sem servidor bungeecord selecionado.";
  state.coworkEntries = [];
  state.coworkUsers = [];
  state.javaMissingMajors = [];
  state.javaManagerEnabled = true;
  if (elements.installMissingJavaButton) {
    elements.installMissingJavaButton.disabled = true;
  }
  if (elements.javaManagerStatusText) {
    elements.javaManagerStatusText.textContent = "Selecione um servidor para ver o status do Java Manager.";
  }
  if (elements.javaManagerList) {
    elements.javaManagerList.innerHTML = "";
  }
  state.importArchiveFile = null;
  state.importArchiveFileName = "";
  if (elements.importServerFileInput) {
    elements.importServerFileInput.value = "";
  }
  if (elements.exportImportStatusText) {
    elements.exportImportStatusText.textContent = "Selecione um servidor próprio para exportar/importar.";
  }
  if (elements.coworkTargetUser) {
    elements.coworkTargetUser.innerHTML = "";
  }
  if (elements.coworkList) {
    elements.coworkList.innerHTML = "";
  }
  if (elements.coworkStatusText) {
    elements.coworkStatusText.textContent = "Sem servidor selecionado.";
  }
  state.debugTargets = [];
  if (elements.debugSessionsList) {
    elements.debugSessionsList.innerHTML = "";
  }
  if (elements.debugStatusText) {
    elements.debugStatusText.textContent = "Sem servidor selecionado.";
  }
  resetCoworkPermissionsUi();
  syncPluginTargetFromServer();
  syncPropertiesTargetFromServer();
  updateServersNavVisibility();
  updateExportImportNavVisibility();
  updatePowerActionButtons({ hasServer: false });
}

async function loadAdminUsers() {
  if (!state.currentUser?.isAdmin) {
    elements.adminPanelCard.classList.add("is-hidden");
    return;
  }
  elements.adminPanelCard.classList.remove("is-hidden");
  const response = await requestJson("/api/admin/users", {}, { server: false });
  elements.adminUsersList.innerHTML = "";
  for (const user of response.users) {
    const li = document.createElement("li");
    li.textContent = `${user.username} | max: ${user.maxServers}`;
    if (user.username !== "admin") {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "button-danger";
      removeButton.textContent = "Excluir";
      removeButton.addEventListener("click", async () => {
        await requestJson(`/api/admin/users/${encodeURIComponent(user.username)}`, {
          method: "DELETE",
        });
        await loadAdminUsers();
      });
      li.append(" ", removeButton);
    }
    elements.adminUsersList.append(li);
  }
}

async function updateHealth() {
  try {
    const response = await requestJson("/api/health", {}, { auth: false, server: false });
    elements.healthBadge.classList.add("is-online");
    elements.healthText.textContent = `Online (${response.app})`;
  } catch {
    elements.healthBadge.classList.remove("is-online");
    elements.healthText.textContent = "Offline";
  }
}

async function loadMachineStats() {
  if (!state.currentServerId) return;
  const stats = await requestJson("/api/system/stats");
  elements.cpuUsageText.textContent = `${stats.cpuUsagePercent}%`;
  const memoryGb = Number(stats.serverMemoryGb || 0);
  elements.ramUsageText.textContent = `${memoryGb.toFixed(2)} GB`;
  elements.serverSizeText.textContent = formatBytes(stats.serverDirectorySizeBytes);
}

async function loadServerInfo() {
  if (!state.currentServerId) {
    state.serverVersion = "";
    state.serverKind = "paper";
    state.bungeeManualNoticeServerId = "";
    elements.pluginServerVersionInput.value = "";
    elements.serverVersionText.textContent = "N/A";
    elements.serverIpText.textContent = "N/A";
    syncPluginTargetFromServer();
    syncPropertiesTargetFromServer();
    syncConsoleTargetFromServer();
    updateServersNavVisibility();
    return;
  }
  const data = await requestJson("/api/server/info");
  state.serverVersion = String(data.paperVersion || "");
  state.serverKind = String(data.serverKind || "paper").toLowerCase() === "bungeecord" ? "bungeecord" : "paper";
  elements.pluginServerVersionInput.value = state.serverVersion;
  elements.serverVersionText.textContent =
    state.serverKind === "bungeecord"
      ? "BungeeCord"
      : state.serverVersion || "Nao instalada";
  elements.serverIpText.textContent = data.serverAddress || "0.0.0.0:25565";
  setVersionKind(state.serverKind);
  syncPluginTargetFromServer();
  syncPropertiesTargetFromServer();
  syncConsoleTargetFromServer();
  elements.versionsStatusText.textContent =
    state.serverKind === "bungeecord"
      ? "Servidor atual: BungeeCord"
      : `Servidor atual: Paper ${state.serverVersion || "(nao instalado)"}`;
  updateServersNavVisibility();
  updateExportImportNavVisibility();
  if (state.serverKind !== "bungeecord") {
    state.bungeeManualNoticeServerId = "";
  } else {
    showManualBungeeConfigNotice();
  }
}

function getCoworkPermissionsFromUi() {
  return {
    consoleCommand: Boolean(elements.coworkPermConsoleCommand?.checked),
    powerStart: Boolean(elements.coworkPermPowerStart?.checked),
    powerStopRestart: Boolean(elements.coworkPermPowerStopRestart?.checked),
    filesRead: Boolean(elements.coworkPermFilesRead?.checked),
    filesEdit: Boolean(elements.coworkPermFilesEdit?.checked),
    filesUpload: Boolean(elements.coworkPermFilesUpload?.checked),
    filesDelete: Boolean(elements.coworkPermFilesDelete?.checked),
  };
}

function setCoworkPermissionsToUi(permissions = {}) {
  elements.coworkPermConsoleCommand.checked = Boolean(permissions.consoleCommand);
  elements.coworkPermPowerStart.checked = Boolean(permissions.powerStart);
  elements.coworkPermPowerStopRestart.checked = Boolean(permissions.powerStopRestart);
  elements.coworkPermFilesRead.checked = Boolean(permissions.filesRead);
  elements.coworkPermFilesEdit.checked = Boolean(permissions.filesEdit);
  elements.coworkPermFilesUpload.checked = Boolean(permissions.filesUpload);
  elements.coworkPermFilesDelete.checked = Boolean(permissions.filesDelete);
}

function resetCoworkPermissionsUi() {
  setCoworkPermissionsToUi({
    consoleCommand: false,
    powerStart: false,
    powerStopRestart: false,
    filesRead: false,
    filesEdit: false,
    filesUpload: false,
    filesDelete: false,
  });
}

function renderCoworkUsers() {
  if (!elements.coworkTargetUser) return;
  elements.coworkTargetUser.innerHTML = "";
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = "Selecione um usuario";
  elements.coworkTargetUser.append(placeholderOption);

  for (const username of state.coworkUsers) {
    const option = document.createElement("option");
    option.value = username;
    option.textContent = username;
    elements.coworkTargetUser.append(option);
  }
}

function formatCoworkPermissions(permissions = {}) {
  return Object.entries(COWORK_PERMISSION_LABELS)
    .filter(([key]) => Boolean(permissions[key]))
    .map(([, label]) => label);
}

function renderCoworkEntries() {
  if (!elements.coworkList) return;
  elements.coworkList.innerHTML = "";
  if (!state.coworkEntries.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhum usuario com acesso cowork.";
    elements.coworkList.append(li);
    return;
  }

  for (const entry of state.coworkEntries) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "cowork-row";

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.username;
    const summary = document.createElement("p");
    const labels = formatCoworkPermissions(entry.permissions);
    summary.className = "muted-text";
    summary.textContent = labels.length ? labels.join(" | ") : "Sem permissoes";
    info.append(title, summary);

    const actions = document.createElement("div");
    actions.className = "cowork-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "button-muted";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => {
      elements.coworkTargetUser.value = entry.username;
      setCoworkPermissionsToUi(entry.permissions || {});
      elements.coworkStatusText.textContent = `Editando permissoes de ${entry.username}.`;
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "button-danger";
    removeButton.textContent = "Remover";
    removeButton.addEventListener("click", () => removeCoworkAccess(entry.username).catch((error) => showToast(error.message, "error")));

    actions.append(editButton, removeButton);
    row.append(info, actions);
    li.append(row);
    elements.coworkList.append(li);
  }
}

async function loadCoworkAccess() {
  if (!state.currentServerId) return;
  try {
    const payload = await requestJson("/api/server/cowork");
    state.coworkUsers = Array.isArray(payload.users) ? payload.users : [];
    state.coworkEntries = Array.isArray(payload.coworkers) ? payload.coworkers : [];
    renderCoworkUsers();
    renderCoworkEntries();
    if (!elements.coworkTargetUser.value && state.coworkUsers.length) {
      elements.coworkTargetUser.value = state.coworkUsers[0];
    }
    elements.coworkStatusText.textContent = "Permissoes cowork carregadas.";
  } catch (error) {
    state.coworkUsers = [];
    state.coworkEntries = [];
    renderCoworkUsers();
    renderCoworkEntries();
    elements.coworkStatusText.textContent = `Acesso cowork indisponivel: ${error.message}`;
  }
}

async function saveCoworkAccess() {
  if (!state.currentServerId) return;
  const targetUsername = String(elements.coworkTargetUser.value || "").trim();
  if (!targetUsername) {
    showToast("Selecione um usuario para compartilhar.", "warning");
    return;
  }

  await requestJson("/api/server/cowork", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetUsername,
      permissions: getCoworkPermissionsFromUi(),
    }),
  });
  elements.coworkStatusText.textContent = `Permissoes atualizadas para ${targetUsername}.`;
  showToast(`Permissoes salvas para ${targetUsername}.`, "success");
  await loadCoworkAccess();
}

async function removeCoworkAccess(username) {
  const target = String(username || "").trim();
  if (!target) return;
  const shouldRemove = confirm(`Remover o acesso cowork de "${target}"?`);
  if (!shouldRemove) return;
  await requestJson(`/api/server/cowork/${encodeURIComponent(target)}`, {
    method: "DELETE",
  });
  elements.coworkStatusText.textContent = `Acesso removido de ${target}.`;
  showToast(`Acesso removido de ${target}.`, "info");
  await loadCoworkAccess();
}

function formatDebugTargetLabel(target = {}) {
  const targetType = String(target.targetType || "").trim().toLowerCase();
  if (targetType === "main") {
    return state.serverKind === "bungeecord" ? "Proxy principal" : "Servidor principal";
  }
  const name = String(target.targetName || target.targetId || "Sub-server").trim();
  const port = Number(target.targetPort || 0);
  if (Number.isFinite(port) && port > 0) {
    return `${name} (porta ${port})`;
  }
  return name || "Sub-server";
}

function renderDebugLogs() {
  if (!elements.debugSessionsList) return;
  elements.debugSessionsList.innerHTML = "";
  const targets = Array.isArray(state.debugTargets) ? state.debugTargets : [];
  if (!targets.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhum erro registrado no console.";
    elements.debugSessionsList.append(li);
    return;
  }

  for (const target of targets) {
    const sessions = Array.isArray(target.sessions) ? target.sessions : [];
    const targetErrorCount = sessions.reduce((count, session) => count + Number(session.errorCount || 0), 0);

    const li = document.createElement("li");
    li.className = "debug-target-item";

    const title = document.createElement("strong");
    title.textContent = formatDebugTargetLabel(target);
    const summary = document.createElement("p");
    summary.className = "muted-text";
    summary.textContent = `${sessions.length} sessao(oes) | ${targetErrorCount} erro(s)`;
    li.append(title, summary);

    if (!sessions.length) {
      const emptySession = document.createElement("p");
      emptySession.className = "muted-text";
      emptySession.textContent = "Nenhuma sessao de console registrada.";
      li.append(emptySession);
      elements.debugSessionsList.append(li);
      continue;
    }

    for (const session of sessions) {
      const card = document.createElement("div");
      card.className = "debug-session-card";
      const errors = Array.isArray(session.errors) ? session.errors : [];
      const startedText = formatDebugDateTime(session.startedAt);
      const stoppedText = session.stoppedAt ? formatDebugDateTime(session.stoppedAt) : "em execucao";

      const sessionSummary = document.createElement("p");
      sessionSummary.className = "muted-text";
      sessionSummary.textContent = `Sessao: ${startedText} -> ${stoppedText} | erros: ${errors.length}`;
      card.append(sessionSummary);

      if (!errors.length) {
        const noErrors = document.createElement("p");
        noErrors.className = "muted-text";
        noErrors.textContent = "Sem erros nesta sessao.";
        card.append(noErrors);
      } else {
        const errorList = document.createElement("ul");
        errorList.className = "debug-error-list";
        for (const error of errors) {
          const errorItem = document.createElement("li");
          const whenText = formatDebugDateTime(error.at);
          const line = String(error.line || error.formatted || "").trim() || "(linha vazia)";
          errorItem.textContent = `[${whenText}] ${line}`;
          errorList.append(errorItem);
        }
        card.append(errorList);
      }

      li.append(card);
    }

    elements.debugSessionsList.append(li);
  }
}

async function loadDebugLogs() {
  if (!elements.debugStatusText) return;
  if (!state.currentServerId) {
    state.debugTargets = [];
    renderDebugLogs();
    elements.debugStatusText.textContent = "Sem servidor selecionado.";
    return;
  }

  const payload = await requestJson("/api/server/debug/logs");
  state.debugTargets = Array.isArray(payload.targets) ? payload.targets : [];
  renderDebugLogs();

  const targetCount = state.debugTargets.length;
  let sessionCount = 0;
  let errorCount = 0;
  for (const target of state.debugTargets) {
    const sessions = Array.isArray(target.sessions) ? target.sessions : [];
    sessionCount += sessions.length;
    for (const session of sessions) {
      errorCount += Array.isArray(session.errors) ? session.errors.length : 0;
    }
  }
  const generatedLabel = formatDebugDateTime(payload.generatedAt);
  elements.debugStatusText.textContent = `Atualizado em ${generatedLabel} | alvos: ${targetCount} | sessoes: ${sessionCount} | erros: ${errorCount}`;
}

function getSubServerIdOrThrow() {
  const subServerId = String(state.currentSubServerId || "").trim();
  if (!subServerId) {
    throw new Error("Selecione um sub-servidor primeiro.");
  }
  return subServerId;
}

function buildSubServerQuery(params = {}) {
  const query = new URLSearchParams();
  query.set("subServerId", getSubServerIdOrThrow());
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(key, String(value));
  }
  return query.toString();
}

function renderSubServerItems() {
  elements.subServerItemsList.innerHTML = "";
  if (!state.currentSubServerId) {
    const li = document.createElement("li");
    li.textContent = "Selecione um sub-servidor para carregar os arquivos.";
    elements.subServerItemsList.append(li);
    return;
  }
  if (!state.subCurrentFileEntries.length) {
    const li = document.createElement("li");
    li.textContent = "Diretorio vazio.";
    elements.subServerItemsList.append(li);
    return;
  }
  for (const entry of state.subCurrentFileEntries) {
    const li = document.createElement("li");
    li.className = "file-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.subSelectedFilePaths.has(entry.path);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.subSelectedFilePaths.add(entry.path);
      else state.subSelectedFilePaths.delete(entry.path);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-entry-button";
    setFileEntryButtonContent(button, entry.type, basename(entry.path));
    button.addEventListener("click", async () => {
      if (entry.type === "directory") {
        await navigateSubDirectory(entry.path, true);
        return;
      }
      await loadSubFileForEditing(entry.path);
    });
    li.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const isSingleSelected = state.subSelectedFilePaths.size === 1 && state.subSelectedFilePaths.has(entry.path);
      if (!isSingleSelected) {
        state.subSelectedFilePaths = new Set([entry.path]);
        renderSubServerItems();
      }
      openFileContextMenu(entry.path, event.clientX, event.clientY, { scope: "sub" });
    });

    li.append(checkbox, button);
    elements.subServerItemsList.append(li);
  }
}

function closeSubServerContextMenu() {
  state.subServerContextTargetId = "";
  if (!elements.subServerContextMenu) return;
  elements.subServerContextMenu.classList.add("is-hidden");
}

function openSubServerContextMenu(subServer, x, y) {
  if (!elements.subServerContextMenu) return;
  closeFileContextMenu();
  state.subServerContextTargetId = subServer.id;
  elements.subServerContextMenu.classList.remove("is-hidden");
  const menuWidth = 160;
  const menuHeight = 44;
  const maxX = Math.max(4, window.innerWidth - menuWidth - 4);
  const maxY = Math.max(4, window.innerHeight - menuHeight - 4);
  const safeX = Math.max(4, Math.min(x, maxX));
  const safeY = Math.max(4, Math.min(y, maxY));
  elements.subServerContextMenu.style.left = `${safeX}px`;
  elements.subServerContextMenu.style.top = `${safeY}px`;
}

function renderSubServers() {
  elements.subServersList.innerHTML = "";
  if (!state.subServers.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhum sub-servidor criado ainda.";
    elements.subServersList.append(li);
    return;
  }

  for (const sub of state.subServers) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "home-server-row";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = sub.id === state.currentSubServerId ? "" : "button-muted";
    openButton.textContent = `${sub.name} | porta ${sub.port} | Paper ${sub.version}`;
    openButton.addEventListener("click", async () => {
      state.currentSubServerId = sub.id;
      state.subCurrentDirectory = "";
      state.subDirectoryHistory = [];
      state.subSelectedFilePaths.clear();
      state.subClipboard = { mode: null, paths: [] };
      elements.subServerDirectoryInput.value = "";
      elements.serversStatusText.textContent = `Sub-servidor ativo: ${sub.name}`;
      await loadSubServerFiles();
    });
    openButton.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openSubServerContextMenu(sub, event.clientX, event.clientY);
    });

    row.append(openButton);
    li.append(row);
    elements.subServersList.append(li);
  }
}

async function loadSubServers() {
  closeSubServerContextMenu();
  if (!state.currentServerId || state.serverKind !== "bungeecord") {
    state.subServers = [];
    state.currentSubServerId = "";
    state.subClipboard = { mode: null, paths: [] };
    state.consoleTargetSubServerId = "";
    state.pluginTargetSubServerId = "";
    state.propertiesTargetSubServerId = "";
    syncConsoleTargetFromServer();
    syncPluginTargetFromServer();
    syncPropertiesTargetFromServer();
    renderSubServers();
    renderSubServerItems();
    return;
  }
  const response = await requestJson("/api/server/subservers");
  state.subServers = sortSubServersByPort(response.items);
  syncConsoleTargetFromServer();
  syncPluginTargetFromServer();
  syncPropertiesTargetFromServer();
  renderSubServers();
  if (!state.currentSubServerId || !state.subServers.some((item) => item.id === state.currentSubServerId)) {
    state.currentSubServerId = state.subServers[0]?.id || "";
    state.subCurrentDirectory = "";
    state.subDirectoryHistory = [];
    elements.subServerDirectoryInput.value = "";
  }
  if (state.currentSubServerId) {
    const selected = state.subServers.find((item) => item.id === state.currentSubServerId);
    elements.serversStatusText.textContent = selected
      ? `Sub-servidor ativo: ${selected.name}`
      : "Selecione um sub-servidor.";
    await loadSubServerFiles();
  } else {
    elements.serversStatusText.textContent = "Nenhum sub-servidor criado ainda.";
    renderSubServerItems();
  }
}

async function createSubServer(name, version) {
  const payload = await requestJson("/api/server/subservers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, version }),
  });
  showToast(`Sub-servidor criado: ${payload.subServer.name}`, "success");
  showManualBungeeConfigNotice({ force: true });
  await loadSubServers();
}

async function deleteSubServer(subServerId) {
  const target = state.subServers.find((item) => item.id === subServerId);
  if (!target) {
    showToast("Sub-servidor não encontrado.", "warning");
    return;
  }
  const shouldDelete = confirm(`Excluir o sub-servidor "${target.name}"? Todos os arquivos dele serão removidos.`);
  if (!shouldDelete) return;

  await requestJson(`/api/server/subservers/${encodeURIComponent(subServerId)}`, {
    method: "DELETE",
  });

  if (state.currentSubServerId === subServerId) {
    state.currentSubServerId = "";
    state.subCurrentDirectory = "";
    state.subDirectoryHistory = [];
    state.subSelectedFilePaths.clear();
    state.subClipboard = { mode: null, paths: [] };
    state.subCurrentFileEntries = [];
    state.subEditingFilePath = "";
    elements.subServerDirectoryInput.value = "";
    elements.subEditingFileLabel.textContent = "Nenhum arquivo selecionado.";
    elements.subFileEditorText.value = "";
  }
  if (state.pluginTargetSubServerId === subServerId) {
    state.pluginTargetSubServerId = "";
  }

  await loadSubServers();
  if (resolvePageFromHash(location.hash) === "plugins") {
    await loadPluginCatalog({ resetPage: true });
  }
  showToast(`Sub-servidor excluído: ${target.name}`, "success");
  showManualBungeeConfigNotice({ force: true });
}

async function navigateSubDirectory(newDirectory, pushHistory) {
  const normalized = String(newDirectory || "").trim();
  if (pushHistory && normalized !== state.subCurrentDirectory) {
    state.subDirectoryHistory.push(state.subCurrentDirectory);
  }
  state.subCurrentDirectory = normalized;
  elements.subServerDirectoryInput.value = state.subCurrentDirectory;
  await loadSubServerFiles();
}

async function goBackSubDirectory() {
  if (!state.subDirectoryHistory.length) return;
  const previous = state.subDirectoryHistory.pop() || "";
  await navigateSubDirectory(previous, false);
}

async function loadSubServerFiles() {
  if (!state.currentSubServerId) {
    renderSubServerItems();
    return;
  }
  closeFileContextMenu();
  const query = buildSubServerQuery({ directory: state.subCurrentDirectory });
  const data = await requestJson(`/api/server/subservers/files?${query}`);
  const directories = data.directories.map((item) => ({ path: item, type: "directory" }));
  const files = data.files.map((item) => ({ path: item, type: "file" }));
  state.subCurrentFileEntries = [...directories, ...files];
  state.subSelectedFilePaths = new Set(
    Array.from(state.subSelectedFilePaths).filter((item) => state.subCurrentFileEntries.some((entry) => entry.path === item))
  );
  renderSubServerItems();
}

async function uploadSubFiles(fileListOrEntries) {
  const uploadEntries = normalizeUploadEntriesInput(fileListOrEntries);
  if (!uploadEntries.length) return;
  const files = await convertUploadEntriesToPayload(uploadEntries);
  await requestJson("/api/server/subservers/files/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subServerId: getSubServerIdOrThrow(),
      directory: state.subCurrentDirectory,
      files,
    }),
  });
  await loadSubServerFiles();
  showToast(`Upload concluido: ${files.length} arquivo(s) enviado(s) no sub-servidor.`, "success");
}

async function loadSubFileForEditing(filePath) {
  const query = buildSubServerQuery({ path: filePath });
  const data = await requestJson(`/api/server/subservers/files/read?${query}`);
  state.subEditingFilePath = filePath;
  elements.subEditingFileLabel.textContent = `Editando: ${filePath}`;
  elements.subFileEditorText.value = data.content;
}

async function saveSubEditedFile() {
  if (!state.subEditingFilePath) {
    showToast("Selecione um arquivo do sub-servidor para editar.", "warning");
    return;
  }
  await requestJson("/api/server/subservers/files/write", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subServerId: getSubServerIdOrThrow(),
      path: state.subEditingFilePath,
      content: elements.subFileEditorText.value,
    }),
  });
  await loadSubServerFiles();
  showToast(`Arquivo salvo: ${state.subEditingFilePath}`, "success");
}

async function renameSubServerPath(filePath) {
  const sourcePath = String(filePath || "").trim();
  if (!sourcePath) return;
  const currentName = basename(sourcePath);
  const typedName = prompt(`Novo nome para "${currentName}":`, currentName);
  if (typedName === null) return;
  const newName = String(typedName || "").trim();
  if (!newName) {
    showToast("Informe um novo nome valido.", "warning");
    return;
  }
  if (newName === currentName) return;

  const payload = await requestJson("/api/server/subservers/files/rename", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subServerId: getSubServerIdOrThrow(),
      path: sourcePath,
      newName,
    }),
  });

  if (state.subEditingFilePath === sourcePath) {
    state.subEditingFilePath = payload.path;
    elements.subEditingFileLabel.textContent = `Editando: ${payload.path}`;
  }
  state.subSelectedFilePaths = new Set([payload.path]);
  await loadSubServerFiles();
  renderSubServerItems();
  showToast(`Item renomeado para ${basename(payload.path)}.`, "success");
}

function getSelectedSubPaths() {
  return Array.from(state.subSelectedFilePaths);
}

async function deleteSelectedSubFiles() {
  const paths = getSelectedSubPaths();
  if (!paths.length) return;
  await requestJson("/api/server/subservers/files/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subServerId: getSubServerIdOrThrow(),
      action: "delete",
      paths,
    }),
  });
  state.subSelectedFilePaths.clear();
  await loadSubServerFiles();
  showToast(`${paths.length} item(ns) excluido(s) do sub-servidor.`, "success");
}

async function downloadSelectedSubFiles() {
  const paths = getSelectedSubPaths();
  if (!paths.length) return;
  const { links } = await requestJson("/api/server/subservers/files/download-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subServerId: getSubServerIdOrThrow(),
      paths,
    }),
  });
  for (const link of links) {
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
  showToast(`${paths.length} download(s) iniciado(s).`, "info");
}

function copySelectedSubFiles() {
  const paths = getSelectedSubPaths();
  if (!paths.length) return;
  state.subClipboard = { mode: "copy", paths };
  showTemporaryMessage(`Copiados ${paths.length} item(ns) do sub-servidor.`);
  showToast(`${paths.length} item(ns) copiado(s) do sub-servidor.`, "info");
}

function cutSelectedSubFiles() {
  const paths = getSelectedSubPaths();
  if (!paths.length) return;
  state.subClipboard = { mode: "move", paths };
  showTemporaryMessage(`Recortados ${paths.length} item(ns) do sub-servidor.`);
  showToast(`${paths.length} item(ns) recortado(s) do sub-servidor.`, "info");
}

async function pasteSubClipboardFiles() {
  if (!state.subClipboard.mode || !state.subClipboard.paths.length) return;
  await requestJson("/api/server/subservers/files/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subServerId: getSubServerIdOrThrow(),
      action: state.subClipboard.mode,
      paths: state.subClipboard.paths,
      destinationDirectory: state.subCurrentDirectory,
    }),
  });
  if (state.subClipboard.mode === "move") {
    state.subClipboard = { mode: null, paths: [] };
  }
  state.subSelectedFilePaths.clear();
  await loadSubServerFiles();
  showToast("Itens colados no sub-servidor com sucesso.", "success");
}

async function extractSelectedSubFiles() {
  const paths = getSelectedSubPaths();
  if (!paths.length) return;
  await requestJson("/api/server/subservers/files/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subServerId: getSubServerIdOrThrow(),
      action: "extract",
      paths,
    }),
  });
  await loadSubServerFiles();
  showToast(`${paths.length} arquivo(s) compactado(s) extraido(s) no sub-servidor.`, "success");
}

function renderPluginResults(items = []) {
  elements.pluginsResultsList.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhum plugin encontrado.";
    elements.pluginsResultsList.append(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "plugin-result-card";

    const header = document.createElement("div");
    header.className = "plugin-result-header";

    const info = document.createElement("div");
    info.className = "plugin-result-main";
    const icon = document.createElement("img");
    icon.className = "plugin-result-icon";
    icon.alt = "";
    icon.width = 36;
    icon.height = 36;
    icon.src =
      item.iconUrl ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'%3E%3Crect width='36' height='36' rx='8' fill='%23182920'/%3E%3Cpath d='M9 10h18v16H9z' fill='%2326d467' fill-opacity='.25'/%3E%3Cpath d='M12 15h12v2H12zm0 5h8v2h-8z' fill='%2326d467'/%3E%3C/svg%3E";
    icon.referrerPolicy = "no-referrer";

    const text = document.createElement("div");
    text.className = "plugin-result-info";
    const title = document.createElement("strong");
    title.textContent = item.title || item.id || "Plugin";
    if (item.author) {
      const authorNode = document.createElement("span");
      authorNode.className = "plugin-author";
      authorNode.textContent = `by ${item.author}`;
      title.append(" ", authorNode);
    }
    const summary = document.createElement("p");
    summary.textContent = item.description || "Sem descricao.";
    const meta = document.createElement("small");
    meta.textContent = `Fonte: ${item.source}`;
    text.append(title, summary, meta);
    info.append(icon, text);

    const tags = document.createElement("div");
    tags.className = "plugin-tags";
    const combinedTags = Array.isArray(item.tags) ? item.tags : [];
    const versionTags = Array.isArray(item.versions) ? item.versions.slice(0, 2) : [];
    for (const tag of [...combinedTags.slice(0, 3), ...versionTags]) {
      const chip = document.createElement("span");
      chip.className = "plugin-tag";
      chip.textContent = tag;
      tags.append(chip);
    }
    if (tags.childElementCount) {
      text.append(tags);
    }

    const actions = document.createElement("div");
    actions.className = "plugin-result-actions";
    const stats = document.createElement("div");
    stats.className = "plugin-stats";
    const downloads = document.createElement("span");
    downloads.textContent = `DL ${formatCompactNumber(item.downloads || 0)}`;
    const followers = document.createElement("span");
    followers.textContent = `Fav ${formatCompactNumber(item.followers || 0)}`;
    const updated = document.createElement("span");
    updated.textContent = `Upd ${formatRelativeDate(item.updatedAt)}`;
    stats.append(downloads, followers, updated);

    const buttons = document.createElement("div");
    buttons.className = "plugin-action-buttons";
    const readButton = document.createElement("button");
    readButton.type = "button";
    readButton.className = "button-muted";
    readButton.textContent = "Descricao";

    const installButton = document.createElement("button");
    installButton.type = "button";
    installButton.textContent = "Install";
    installButton.addEventListener("click", async () => {
      try {
        const target = getPluginTargetDescriptor();
        const payload = await requestJson("/api/plugins/download", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: item.source,
            projectId: item.id,
            serverVersion: target.serverVersion,
            subServerId: target.subServerId,
          }),
        });
        elements.pluginsStatusText.textContent = `Instalado: ${payload.fileName} (${payload.source})`;
        showToast(`Plugin instalado: ${payload.fileName}`, "success");
        if (state.serverKind === "bungeecord" && state.currentSubServerId && state.currentSubServerId === target.subServerId) {
          await loadSubServerFiles();
        } else {
          await loadServerFiles();
        }
      } catch (error) {
        elements.pluginsStatusText.textContent = `Erro: ${error.message}`;
        showToast(error.message, "error");
      }
    });
    buttons.append(readButton, installButton);
    actions.append(stats, buttons);

    if (item.projectUrl) {
      const link = document.createElement("a");
      link.href = item.projectUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Abrir";
      actions.append(link);
    }

    const details = document.createElement("div");
    details.className = "plugin-details is-hidden";
    const detailsContent = document.createElement("div");
    detailsContent.className = "plugin-details-content";
    detailsContent.textContent = "Clique novamente para ocultar.";
    details.append(detailsContent);

    readButton.addEventListener("click", async () => {
      const key = `${item.source}:${item.id}`;
      if (!details.classList.contains("is-hidden")) {
        details.classList.add("is-hidden");
        readButton.textContent = "Descricao";
        return;
      }

      details.classList.remove("is-hidden");
      readButton.textContent = "Ocultar";
      if (state.pluginDetailsCache.has(key)) {
        detailsContent.textContent = state.pluginDetailsCache.get(key);
        return;
      }

      detailsContent.textContent = "Carregando descricao...";
      try {
        const target = getPluginTargetDescriptor();
        const params = new URLSearchParams({
          source: item.source,
          projectId: item.id,
        });
        if (target.serverVersion) params.set("serverVersion", target.serverVersion);
        if (target.subServerId) params.set("subServerId", target.subServerId);
        const response = await requestJson(`/api/plugins/details?${params.toString()}`);
        const fullDescription = String(response.description || item.description || "Sem descricao detalhada.");
        state.pluginDetailsCache.set(key, fullDescription);
        detailsContent.textContent = fullDescription;
      } catch (error) {
        detailsContent.textContent = `Erro ao carregar descricao: ${error.message}`;
        showToast(error.message, "error");
      }
    });

    header.append(info, actions);
    li.append(header, details);
    elements.pluginsResultsList.append(li);
  }
}

function updatePluginPaginationUi() {
  elements.pluginPageInfo.textContent = `${state.pluginPage} / ${state.pluginPageCount}`;
  elements.pluginPrevPageButton.disabled = state.pluginPage <= 1;
  elements.pluginNextPageButton.disabled = state.pluginPage >= state.pluginPageCount;
}

async function loadPluginCatalog({ resetPage = false } = {}) {
  if (!state.currentServerId) {
    elements.pluginsStatusText.textContent = "Selecione um servidor na aba Home.";
    return;
  }
  if (state.pluginLoading) return;
  if (resetPage) {
    state.pluginPage = 1;
  }

  state.pluginLoading = true;
  const source = elements.pluginSourceSelect.value;
  const sort = elements.pluginSortSelect.value;
  const viewLimit = Number(elements.pluginViewSelect.value || 20);
  state.pluginPageSize = viewLimit;
  const query = elements.pluginQueryInput.value.trim();
  elements.pluginsStatusText.textContent = "Buscando plugins...";

  try {
    const target = getPluginTargetDescriptor();
    const serverVersion = target.serverVersion;
    const params = new URLSearchParams({
      source,
      sort,
      limit: String(viewLimit),
      page: String(state.pluginPage),
    });
    if (query) {
      params.set("query", query);
    }
    if (serverVersion) {
      params.set("serverVersion", serverVersion);
    }
    if (target.subServerId) {
      params.set("subServerId", target.subServerId);
    }
    const response = await requestJson(`/api/plugins/search?${params.toString()}`);
    state.pluginDetailsCache.clear();
    const items = Array.isArray(response.items) ? response.items : [];
    state.pluginPage = Number(response.page || state.pluginPage || 1);
    state.pluginPageCount = Math.max(1, Number(response.pageCount || 1));
    state.pluginTotalHits = Number(response.totalHits || items.length);
    updatePluginPaginationUi();
    renderPluginResults(items);
    const modeLabel = query ? `Resultados para "${query}"` : "Plugins populares";
    elements.pluginsStatusText.textContent = `${modeLabel} - ${state.pluginTotalHits} encontrados`;
  } finally {
    state.pluginLoading = false;
  }
}

function renderPlayers(players) {
  elements.playersList.innerHTML = "";
  if (!players.length) {
    const li = document.createElement("li");
    li.textContent = "Sem jogadores online.";
    elements.playersList.append(li);
    return;
  }
  for (const player of players) {
    const li = document.createElement("li");
    li.className = "player-row";
    li.innerHTML = `
      <img src="${player.headUrl}" alt="${player.name}" width="24" height="24" />
      <a href="${player.nameMcUrl}" target="_blank" rel="noopener">${player.name}</a>
    `;
    elements.playersList.append(li);
  }
}

async function loadPlayers() {
  if (!state.currentServerId) return;
  const payload = await requestJson("/api/server/players");
  elements.onlinePlayersCount.textContent = `${payload.onlineCount} online`;
  const hasPlayers = payload.onlineCount > 0;
  elements.togglePlayersButton.classList.toggle("is-hidden", !hasPlayers);
  if (!hasPlayers) {
    state.playersPopoverOpen = false;
    elements.playersPopover.classList.add("is-hidden");
  } else if (payload.onlineCount === 1) {
    state.playersPopoverOpen = true;
    elements.playersPopover.classList.remove("is-hidden");
  } else {
    elements.playersPopover.classList.toggle("is-hidden", !state.playersPopoverOpen);
  }
  renderPlayers(payload.players || []);
}

async function loadConsole() {
  if (!state.currentServerId) return;
  const target = getSelectedConsoleTarget();
  const query = new URLSearchParams();
  if (target.subServerId) {
    query.set("subServerId", target.subServerId);
  }
  const suffix = query.toString();
  const status = await requestJson("/api/server/status");
  const consoleData = await requestJson(`/api/server/console${suffix ? `?${suffix}` : ""}`);
  const targetStatus =
    consoleData && typeof consoleData.status === "object" && consoleData.status
      ? consoleData.status
      : status;

  const currentState = String(status.state || "").toLowerCase();
  const previousState = state.lastKnownServerState;
  const pendingAction = String(state.pendingPowerAction || "").toLowerCase();
  const now = Date.now();
  if (pendingAction && state.pendingPowerActionAt && now - state.pendingPowerActionAt > 25000) {
    state.pendingPowerAction = "";
    state.pendingPowerActionAt = 0;
  }
  if (
    (pendingAction === "start" && currentState === "running") ||
    (pendingAction === "stop" && currentState !== "running") ||
    (pendingAction === "restart" && currentState === "running")
  ) {
    state.pendingPowerAction = "";
    state.pendingPowerActionAt = 0;
  }
  if (previousState === "running" && currentState !== "running" && !state.pendingPowerAction) {
    if (now - state.lastCrashToastAt > 7000) {
      showToast("Crash handler: o servidor caiu inesperadamente. Verifique o console e reinicie.", "error", 5200);
      state.lastCrashToastAt = now;
    }
  }
  state.lastKnownServerState = currentState;
  updatePowerActionButtons({ serverState: currentState, hasServer: true });
  elements.onlinePlayersCount.textContent = formatUptimeLabel(targetStatus);
  if (elements.togglePlayersButton) {
    elements.togglePlayersButton.classList.add("is-hidden");
  }
  if (elements.playersPopover) {
    elements.playersPopover.classList.add("is-hidden");
  }

  const output = consoleData.lines.length ? consoleData.lines.join("\n") : "[SYS] Console sem logs ainda.";
  const distanceFromBottom =
    elements.consoleOutput.scrollHeight - (elements.consoleOutput.scrollTop + elements.consoleOutput.clientHeight);
  const shouldStick = state.consoleAutoStickToBottom || distanceFromBottom < 24;
  elements.consoleOutput.textContent = output;
  if (shouldStick) elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
  const consoleName = String(consoleData.targetName || target.label || "Proxy");
  showTemporaryMessage(`Servidor: ${status.state} | Console: ${consoleName} (${targetStatus.state || "offline"})`);
}

async function sendPowerAction(action) {
  const normalizedAction = String(action || "").toLowerCase();
  state.pendingPowerAction = normalizedAction;
  state.pendingPowerActionAt = Date.now();
  try {
    await requestJson("/api/server/power", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: normalizedAction }),
    });
    await loadConsole();
    const successMessageByAction = {
      start: "Servidor ligado com sucesso.",
      stop: "Servidor desligado com sucesso.",
      restart: "Servidor reiniciado com sucesso.",
    };
    showToast(successMessageByAction[normalizedAction] || `Acao ${normalizedAction} executada com sucesso.`, "success");
  } catch (error) {
    state.pendingPowerAction = "";
    state.pendingPowerActionAt = 0;
    throw error;
  }
}

async function sendConsoleCommand(command) {
  const target = getSelectedConsoleTarget();
  const payload = { command };
  if (target.subServerId) {
    payload.subServerId = target.subServerId;
  }
  await requestJson("/api/server/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  await loadConsole();
}

function closeFileContextMenu() {
  state.fileContextTargetPath = "";
  state.fileContextScope = "main";
  if (elements.fileContextExtract) {
    elements.fileContextExtract.classList.add("is-hidden");
  }
  if (!elements.fileContextMenu) return;
  elements.fileContextMenu.classList.add("is-hidden");
}

function getFileEntriesForScope(scope) {
  return normalizeFileContextScope(scope) === "sub" ? state.subCurrentFileEntries : state.currentFileEntries;
}

function getFileContextEntry(scope, filePath) {
  const safePath = String(filePath || "").trim();
  if (!safePath) return null;
  const entries = getFileEntriesForScope(scope);
  return entries.find((entry) => entry.path === safePath) || null;
}

function openFileContextMenu(filePath, x, y, { scope = "main" } = {}) {
  if (!elements.fileContextMenu) return;
  closeSubServerContextMenu();
  state.fileContextTargetPath = String(filePath || "");
  state.fileContextScope = normalizeFileContextScope(scope);

  const contextEntry = getFileContextEntry(state.fileContextScope, state.fileContextTargetPath);
  const canExtract = Boolean(
    contextEntry && contextEntry.type === "file" && isExtractableArchivePath(state.fileContextTargetPath)
  );
  if (elements.fileContextExtract) {
    elements.fileContextExtract.classList.toggle("is-hidden", !canExtract);
  }

  elements.fileContextMenu.classList.remove("is-hidden");
  const menuWidth = 180;
  const visibleItemCount = Array.from(elements.fileContextMenu.querySelectorAll(".context-menu-item")).filter(
    (item) => !item.classList.contains("is-hidden")
  ).length;
  const menuHeight = Math.max(44, visibleItemCount * 34 + 10);
  const maxX = Math.max(4, window.innerWidth - menuWidth - 4);
  const maxY = Math.max(4, window.innerHeight - menuHeight - 4);
  const safeX = Math.max(4, Math.min(x, maxX));
  const safeY = Math.max(4, Math.min(y, maxY));
  elements.fileContextMenu.style.left = `${safeX}px`;
  elements.fileContextMenu.style.top = `${safeY}px`;
}

function getFileContextPathOrThrow() {
  const filePath = String(state.fileContextTargetPath || "").trim();
  if (!filePath) {
    throw new Error("Nenhum item selecionado.");
  }
  return filePath;
}

function getFileContextTargetOrThrow() {
  return {
    path: getFileContextPathOrThrow(),
    scope: normalizeFileContextScope(state.fileContextScope),
  };
}

function renderServerItems() {
  elements.serverItemsList.innerHTML = "";
  if (!state.currentFileEntries.length) {
    const li = document.createElement("li");
    li.textContent = "Diretorio vazio.";
    elements.serverItemsList.append(li);
    return;
  }

  for (const entry of state.currentFileEntries) {
    const li = document.createElement("li");
    li.className = "file-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedFilePaths.has(entry.path);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedFilePaths.add(entry.path);
      else state.selectedFilePaths.delete(entry.path);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-entry-button";
    setFileEntryButtonContent(button, entry.type, basename(entry.path));
    button.addEventListener("click", async () => {
      if (entry.type === "directory") {
        await navigateToDirectory(entry.path, true);
        return;
      }
      await loadFileForEditing(entry.path);
    });
    li.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const isSingleSelected = state.selectedFilePaths.size === 1 && state.selectedFilePaths.has(entry.path);
      if (!isSingleSelected) {
        state.selectedFilePaths = new Set([entry.path]);
        renderServerItems();
      }
      openFileContextMenu(entry.path, event.clientX, event.clientY, { scope: "main" });
    });

    li.append(checkbox, button);
    elements.serverItemsList.append(li);
  }
}

async function navigateToDirectory(newDirectory, pushHistory) {
  const normalized = String(newDirectory || "").trim();
  if (pushHistory && normalized !== state.currentDirectory) {
    state.directoryHistory.push(state.currentDirectory);
  }
  state.currentDirectory = normalized;
  elements.serverDirectoryInput.value = state.currentDirectory;
  await loadServerFiles();
}

async function goBackDirectory() {
  if (!state.directoryHistory.length) return;
  const previous = state.directoryHistory.pop() || "";
  await navigateToDirectory(previous, false);
}

async function loadServerFiles() {
  if (!state.currentServerId) return;
  closeFileContextMenu();
  const query = new URLSearchParams({ directory: state.currentDirectory });
  const data = await requestJson(`/api/server/files?${query}`);
  const directories = data.directories.map((item) => ({ path: item, type: "directory" }));
  const files = data.files.map((item) => ({ path: item, type: "file" }));
  state.currentFileEntries = [...directories, ...files];
  state.selectedFilePaths = new Set(
    Array.from(state.selectedFilePaths).filter((item) => state.currentFileEntries.some((entry) => entry.path === item))
  );
  renderServerItems();
}

async function uploadFiles(fileListOrEntries) {
  const uploadEntries = normalizeUploadEntriesInput(fileListOrEntries);
  if (!uploadEntries.length || !state.currentServerId) return;
  const files = await convertUploadEntriesToPayload(uploadEntries);
  await requestJson("/api/server/files/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory: state.currentDirectory, files }),
  });
  await loadServerFiles();
  showToast(`Upload concluido: ${files.length} arquivo(s) enviado(s).`, "success");
}

function isFileDragEvent(event) {
  const dataTransfer = event?.dataTransfer;
  const types = Array.from(dataTransfer?.types || []);
  return types.includes("Files");
}

function setUploadDropZoneState(dropZoneElement, isActive) {
  if (!dropZoneElement) return;
  dropZoneElement.classList.toggle("is-drag-active", Boolean(isActive));
}

function registerUploadDropZone(dropZoneElement, onDropUploadEntries) {
  if (!dropZoneElement || typeof onDropUploadEntries !== "function") return;
  let dragDepth = 0;

  dropZoneElement.addEventListener("dragenter", (event) => {
    if (!isFileDragEvent(event)) return;
    event.preventDefault();
    dragDepth += 1;
    setUploadDropZoneState(dropZoneElement, true);
  });

  dropZoneElement.addEventListener("dragover", (event) => {
    if (!isFileDragEvent(event)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setUploadDropZoneState(dropZoneElement, true);
  });

  dropZoneElement.addEventListener("dragleave", (event) => {
    if (!isFileDragEvent(event)) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setUploadDropZoneState(dropZoneElement, false);
    }
  });

  dropZoneElement.addEventListener("drop", async (event) => {
    if (!isFileDragEvent(event)) return;
    event.preventDefault();
    dragDepth = 0;
    setUploadDropZoneState(dropZoneElement, false);
    try {
      const uploadEntries = await createUploadEntriesFromDataTransfer(event.dataTransfer);
      if (!uploadEntries.length) {
        showToast("Nenhum arquivo encontrado para upload.", "warning");
        return;
      }
      await onDropUploadEntries(uploadEntries);
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

async function loadFileForEditing(filePath) {
  const query = new URLSearchParams({ path: filePath });
  const data = await requestJson(`/api/server/files/read?${query}`);
  state.editingFilePath = filePath;
  elements.editingFileLabel.textContent = `Editando: ${filePath}`;
  elements.fileEditorText.value = data.content;
}

async function saveEditedFile() {
  if (!state.editingFilePath) {
    showToast("Selecione um arquivo para editar.", "warning");
    return;
  }
  await requestJson("/api/server/files/write", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: state.editingFilePath, content: elements.fileEditorText.value }),
  });
  await loadServerFiles();
  showToast(`Arquivo salvo: ${state.editingFilePath}`, "success");
}

async function renameServerPath(filePath) {
  const sourcePath = String(filePath || "").trim();
  if (!sourcePath) return;
  const currentName = basename(sourcePath);
  const typedName = prompt(`Novo nome para "${currentName}":`, currentName);
  if (typedName === null) return;
  const newName = String(typedName || "").trim();
  if (!newName) {
    showToast("Informe um novo nome valido.", "warning");
    return;
  }
  if (newName === currentName) return;
  const payload = await requestJson("/api/server/files/rename", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: sourcePath,
      newName,
    }),
  });
  if (state.editingFilePath === sourcePath) {
    state.editingFilePath = payload.path;
    elements.editingFileLabel.textContent = `Editando: ${payload.path}`;
  }
  state.selectedFilePaths = new Set([payload.path]);
  await loadServerFiles();
  renderServerItems();
  showToast(`Item renomeado para ${basename(payload.path)}.`, "success");
}

function getSelectedPaths() {
  return Array.from(state.selectedFilePaths);
}

async function deleteSelectedFiles() {
  const paths = getSelectedPaths();
  if (!paths.length) return;
  await requestJson("/api/server/files/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "delete", paths }),
  });
  state.selectedFilePaths.clear();
  await loadServerFiles();
  showToast(`${paths.length} item(ns) excluido(s).`, "success");
}

async function extractSelectedFiles() {
  const paths = getSelectedPaths();
  if (!paths.length) return;
  await requestJson("/api/server/files/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "extract", paths }),
  });
  await loadServerFiles();
  showToast(`${paths.length} arquivo(s) compactado(s) extraido(s).`, "success");
}

async function downloadSelectedFiles() {
  const paths = getSelectedPaths();
  if (!paths.length) return;
  const { links } = await requestJson("/api/server/files/download-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  for (const link of links) {
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
  showToast(`${paths.length} download(s) iniciado(s).`, "info");
}

function copySelectedFiles() {
  const paths = getSelectedPaths();
  if (!paths.length) return;
  state.clipboard = { mode: "copy", paths };
  showTemporaryMessage(`Copiados ${paths.length} item(ns).`);
  showToast(`${paths.length} item(ns) copiado(s).`, "info");
}

function cutSelectedFiles() {
  const paths = getSelectedPaths();
  if (!paths.length) return;
  state.clipboard = { mode: "move", paths };
  showTemporaryMessage(`Recortados ${paths.length} item(ns).`);
  showToast(`${paths.length} item(ns) recortado(s).`, "info");
}

async function pasteClipboardFiles() {
  if (!state.clipboard.mode || !state.clipboard.paths.length) return;
  await requestJson("/api/server/files/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: state.clipboard.mode,
      paths: state.clipboard.paths,
      destinationDirectory: state.currentDirectory,
    }),
  });
  if (state.clipboard.mode === "move") state.clipboard = { mode: null, paths: [] };
  state.selectedFilePaths.clear();
  await loadServerFiles();
  showToast("Itens colados com sucesso.", "success");
}

function copyFileFromContextMenu() {
  try {
    const target = getFileContextTargetOrThrow();
    if (target.scope === "sub") {
      state.subSelectedFilePaths = new Set([target.path]);
      renderSubServerItems();
      closeFileContextMenu();
      copySelectedSubFiles();
      return;
    }
    state.selectedFilePaths = new Set([target.path]);
    renderServerItems();
    closeFileContextMenu();
    copySelectedFiles();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function cutFileFromContextMenu() {
  try {
    const target = getFileContextTargetOrThrow();
    if (target.scope === "sub") {
      state.subSelectedFilePaths = new Set([target.path]);
      renderSubServerItems();
      closeFileContextMenu();
      cutSelectedSubFiles();
      return;
    }
    state.selectedFilePaths = new Set([target.path]);
    renderServerItems();
    closeFileContextMenu();
    cutSelectedFiles();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteFileFromContextMenu() {
  try {
    const target = getFileContextTargetOrThrow();
    if (target.scope === "sub") {
      state.subSelectedFilePaths = new Set([target.path]);
      renderSubServerItems();
      closeFileContextMenu();
      await deleteSelectedSubFiles();
      return;
    }
    state.selectedFilePaths = new Set([target.path]);
    renderServerItems();
    closeFileContextMenu();
    await deleteSelectedFiles();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function renameFileFromContextMenu() {
  try {
    const target = getFileContextTargetOrThrow();
    closeFileContextMenu();
    if (target.scope === "sub") {
      await renameSubServerPath(target.path);
      return;
    }
    await renameServerPath(target.path);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function extractFileFromContextMenu() {
  try {
    const target = getFileContextTargetOrThrow();
    if (!isExtractableArchivePath(target.path)) {
      throw new Error("Selecione um arquivo .zip para extrair.");
    }
    if (target.scope === "sub") {
      state.subSelectedFilePaths = new Set([target.path]);
      renderSubServerItems();
      closeFileContextMenu();
      await extractSelectedSubFiles();
      return;
    }
    state.selectedFilePaths = new Set([target.path]);
    renderServerItems();
    closeFileContextMenu();
    await extractSelectedFiles();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadPaperVersions() {
  const { items } = await requestJson("/api/paper/versions");
  elements.paperVersionSelect.innerHTML = "";
  elements.newSubServerVersionSelect.innerHTML = "";
  elements.paperVersionsList.innerHTML = "";

  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.version;
    option.textContent = item.version;
    elements.paperVersionSelect.append(option);

    const subOption = document.createElement("option");
    subOption.value = item.version;
    subOption.textContent = item.version;
    elements.newSubServerVersionSelect.append(subOption);

    const li = document.createElement("li");
    li.className = "version-row";
    li.innerHTML = `<div><strong>${item.version}</strong><span>${item.url}</span></div>`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Baixar";
    button.addEventListener("click", () => {
      setVersionKind("paper");
      downloadPaperVersion(item.version).catch((error) => showToast(error.message, "error"));
    });
    li.append(button);
    elements.paperVersionsList.append(li);
  }

  if (items.length) {
    elements.paperVersionSelect.value = items[0].version;
    elements.newSubServerVersionSelect.value = items[0].version;
  }
}

async function downloadPaperVersion(version) {
  const isBungee = state.selectedVersionKind === "bungeecord";
  const targetKind = isBungee ? "bungeecord" : "paper";
  let installMode = "";
  let response;
  try {
    response = await requestJson("/api/paper/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, serverKind: targetKind }),
    });
  } catch (error) {
    if (isBungee || !String(error.message || "").toLowerCase().includes("version already installed")) {
      throw error;
    }

    const replaceOnly = confirm(
      "Ja existe outra versao instalada neste servidor.\n\nOK = Trocar somente o JAR\nCancelar = Escolher reinstalacao completa"
    );
    if (replaceOnly) {
      installMode = "replace_jar";
    } else {
      const reinstall = confirm(
        "Reinstalar o servidor inteiro vai DELETAR TODOS OS ARQUIVOS do servidor atual.\n\nDeseja continuar?"
      );
      if (!reinstall) return;
      installMode = "reinstall";
    }

    response = await requestJson("/api/paper/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, installMode, serverKind: targetKind }),
    });
  }

  if (targetKind === "bungeecord") {
    showToast("BungeeCord instalado com sucesso. Aba Servers liberada.", "success", 4200);
    showManualBungeeConfigNotice({ force: true });
  } else if (response.installModeApplied === "reinstall") {
    showToast("Servidor reinstalado e Paper baixado com sucesso.", "warning", 4200);
  } else {
    showToast(`Paper ${response.version} baixado como ${response.fileName}.`, "success");
  }
  await loadServerInfo();
  await loadServerFiles();
  if (state.serverKind === "bungeecord") {
    await loadSubServers();
  }
}

function readPropertyValueFromRow(row) {
  const valueControl = row.querySelector('[data-role="value"]');
  return valueControl ? valueControl.value : "";
}

function mountPropertyValueControl(row, key, value) {
  const valueContainer = row.querySelector(".property-value");
  valueContainer.innerHTML = "";
  const type = inferPropertyInputType(key, value);

  if (type === "difficulty" || type === "gamemode") {
    const select = document.createElement("select");
    select.dataset.role = "value";
    const options =
      type === "difficulty"
        ? DIFFICULTY_OPTIONS
        : GAMEMODE_OPTIONS.map((item) => ({ value: item, label: item }));
    const currentValue = String(value || "").toLowerCase();
    for (const optionItem of options) {
      const option = document.createElement("option");
      option.value = optionItem.value;
      option.textContent = optionItem.label;
      option.selected = optionItem.value === currentValue;
      select.append(option);
    }
    select.addEventListener("change", schedulePropertiesAutosave);
    valueContainer.append(select);
    return;
  }

  if (type === "boolean") {
    const normalized = normalizeBooleanValue(value) || "false";
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.dataset.role = "value";
    hidden.value = normalized;

    const toggle = document.createElement("div");
    toggle.className = "toggle-group";
    for (const optionValue of ["true", "false"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toggle-choice";
      button.textContent = optionValue;
      button.classList.toggle("is-active", optionValue === normalized);
      button.addEventListener("click", () => {
        hidden.value = optionValue;
        for (const choice of toggle.querySelectorAll(".toggle-choice")) {
          choice.classList.toggle("is-active", choice.textContent === optionValue);
        }
        schedulePropertiesAutosave();
      });
      toggle.append(button);
    }
    valueContainer.append(hidden, toggle);
    return;
  }

  const input = document.createElement("input");
  input.dataset.role = "value";
  input.value = value ?? "";
  input.addEventListener("input", schedulePropertiesAutosave);
  valueContainer.append(input);
}

function renderPropertiesRows(entries = {}) {
  elements.propertiesTable.innerHTML = "";
  const prioritizedEntries = {
    difficulty: entries.difficulty || "normal",
    gamemode: entries.gamemode || "survival",
    ...entries,
  };

  const orderedKeys = ["difficulty", "gamemode", ...Object.keys(prioritizedEntries).filter((key) => !["difficulty", "gamemode"].includes(key))];
  for (const key of orderedKeys) {
    const row = document.createElement("div");
    row.className = "property-row";
    row.dataset.key = key;

    const keyLabel = document.createElement("div");
    keyLabel.className = "property-key";
    keyLabel.textContent = key;
    keyLabel.title = PROPERTY_DESCRIPTIONS[key] || "Propriedade de configuracao do servidor.";

    const valueContainer = document.createElement("div");
    valueContainer.className = "property-value";
    row.append(keyLabel, valueContainer);
    elements.propertiesTable.append(row);
    mountPropertyValueControl(row, key, prioritizedEntries[key]);
  }
}

function collectPropertiesEntriesFromUI() {
  const entries = {};
  const rows = Array.from(elements.propertiesTable.querySelectorAll(".property-row"));
  for (const row of rows) {
    const key = row.dataset.key;
    if (!key) continue;
    entries[key] = readPropertyValueFromRow(row);
  }
  return entries;
}

async function saveProperties(entries) {
  const body = { entries };
  if (state.serverKind === "bungeecord") {
    const selected = getSelectedPropertiesSubServer();
    if (!selected) {
      throw new Error("Selecione um sub-servidor para salvar as propriedades.");
    }
    body.subServerId = selected.id;
  }
  await requestJson("/api/server/properties", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function schedulePropertiesAutosave() {
  if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
  elements.propertiesStatusText.textContent = "Salvando...";
  state.autosaveTimer = setTimeout(async () => {
    try {
      await saveProperties(collectPropertiesEntriesFromUI());
      elements.propertiesStatusText.textContent = `Salvo automaticamente (${new Date().toLocaleTimeString()})`;
    } catch (error) {
      elements.propertiesStatusText.textContent = `Erro ao salvar: ${error.message}`;
    }
  }, 650);
}

async function loadProperties() {
  if (!state.currentServerId) return;
  if (state.serverKind === "bungeecord" && !state.subServers.length) {
    try {
      const subResponse = await requestJson("/api/server/subservers");
      state.subServers = sortSubServersByPort(subResponse.items);
      syncPluginTargetFromServer();
    } catch {
      state.subServers = [];
    }
  }

  syncPropertiesTargetFromServer();
  const selectedSubServer = state.serverKind === "bungeecord" ? getSelectedPropertiesSubServer() : null;
  try {
    await loadPropertiesServerIcon(selectedSubServer);
  } catch (error) {
    setPropertiesServerIconPreviewDataUrl("");
    elements.propertiesServerIconStatusText.textContent = `Erro ao carregar foto: ${error.message}`;
  }
  if (state.serverKind === "bungeecord" && !selectedSubServer) {
    renderPropertiesRows({});
    elements.propertiesStatusText.textContent = "Crie ou selecione um sub-servidor para editar as propriedades.";
    return;
  }

  const query = new URLSearchParams();
  if (selectedSubServer?.id) {
    query.set("subServerId", selectedSubServer.id);
  }
  const suffix = query.toString();
  const response = await requestJson(`/api/server/properties${suffix ? `?${suffix}` : ""}`);
  renderPropertiesRows(response.entries || {});
  if (selectedSubServer) {
    elements.propertiesStatusText.textContent = `Editando ${selectedSubServer.name}. Alteracoes salvam automaticamente.`;
  } else {
    elements.propertiesStatusText.textContent = "Alteracoes salvam automaticamente.";
  }
}

function downloadBlobFile(fileName, blob) {
  const anchor = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

function buildAuthorizedHeaders({ includeServer = true, extra = {} } = {}) {
  const headers = { ...extra };
  if (state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }
  if (includeServer && state.currentServerId) {
    headers["x-dsm-server-id"] = state.currentServerId;
  }
  return headers;
}

function getFileNameFromContentDisposition(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/["']/g, "").trim());
    } catch {}
  }
  const fallbackMatch = value.match(/filename="?([^";]+)"?/i);
  return fallbackMatch?.[1] ? fallbackMatch[1].trim() : "";
}

async function exportCurrentServer() {
  if (!canUseExportImport()) {
    throw new Error("A exportacao/importacao esta disponivel somente para dono/admin.");
  }
  elements.exportImportStatusText.textContent = "Gerando arquivo de exportacao...";
  const response = await fetch("/api/server/export/download", {
    method: "POST",
    headers: buildAuthorizedHeaders(),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) {
        message = data.error;
      }
    } catch {}
    throw new Error(message);
  }

  const fileName =
    getFileNameFromContentDisposition(response.headers.get("content-disposition")) || "servidor.dsmexport.zip";
  const blob = await response.blob();
  downloadBlobFile(fileName, blob);
  const formattedSize = formatBytes(Number(blob.size || 0));
  elements.exportImportStatusText.textContent = `Exportado com sucesso: ${fileName} (${formattedSize}).`;
  showToast("Servidor exportado com sucesso.", "success");
}

async function importServerFromSelectedFile() {
  if (!canUseExportImport()) {
    throw new Error("A exportacao/importacao esta disponivel somente para dono/admin.");
  }
  if (!state.importArchiveFile) {
    throw new Error("Selecione um arquivo de exportacao antes de importar.");
  }

  elements.exportImportStatusText.textContent = "Importando servidor...";
  const importFileName = String(state.importArchiveFile.name || "").trim();
  const lowerImportFileName = importFileName.toLowerCase();
  const isZipFile = lowerImportFileName.endsWith(".zip");
  const contentType = isZipFile ? "application/zip" : "application/json";
  const bodyBytes = await state.importArchiveFile.arrayBuffer();
  const response = await fetch("/api/home/servers/import/file", {
    method: "POST",
    headers: buildAuthorizedHeaders({
      includeServer: false,
      extra: {
        "content-type": contentType,
        "x-dsm-import-name": importFileName,
      },
    }),
    body: bodyBytes,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  state.importArchiveFile = null;
  state.importArchiveFileName = "";
  elements.importServerFileInput.value = "";

  const importedServer = payload.server && typeof payload.server === "object" ? payload.server : null;
  if (importedServer?.id) {
    setCurrentServerId(importedServer.id);
  }
  await loadHomeServers();
  await refreshServerScopedViews();
  elements.exportImportStatusText.textContent = `Importado com sucesso: ${payload.importedName || importedServer?.name || "Servidor"}.`;
  showToast("Servidor importado com sucesso.", "success");
}

async function refreshServerScopedViews() {
  if (!state.currentServerId) {
    clearServerScopedUi();
    await loadHomeServers();
    return;
  }
  elements.serverDirectoryInput.value = state.currentDirectory;
  await Promise.all([
    loadServerInfo(),
    loadMachineStats(),
    loadConsole(),
    loadServerFiles(),
    loadProperties(),
    loadCoworkAccess(),
  ]);
  await loadSubServers();
  await loadHomeServers();
  if (resolvePageFromHash(location.hash) === "plugins") {
    await loadPluginCatalog({ resetPage: true });
  }
  if (resolvePageFromHash(location.hash) === "debug") {
    await loadDebugLogs();
  }
  if (resolvePageFromHash(location.hash) === "settings") {
    await loadJavaManagerStatus();
  }
}

async function logoutCurrentAccount() {
  try {
    await requestJson("/api/auth/logout", { method: "POST" }, { server: false });
  } catch {}

  setToken("");
  state.currentUser = null;
  setCurrentServerId("");
  state.homeServers = [];
  state.clipboard = { mode: null, paths: [] };
  state.subClipboard = { mode: null, paths: [] };
  clearServerScopedUi();
  location.hash = buildHashForPage("console");
  toggleLoginOverlay(true);
  showToast("Sessao encerrada.", "info");
}

async function initializeAfterLogin() {
  toggleLoginOverlay(false);
  await loadHomeServers();
  await refreshServerScopedViews();
  await Promise.all([loadPaperVersions(), loadAdminUsers()]);

  if (!location.hash) {
    location.hash = buildHashForPage("console");
  }
  syncPageFromHash();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  try {
    await authenticate(elements.loginUsername.value, elements.loginPassword.value);
    await initializeAfterLogin();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function syncPageFromHash() {
  const page = resolvePageFromHash(location.hash);
  if (page === "servers" && state.serverKind !== "bungeecord") {
    location.hash = buildHashForPage("versions");
    showToast("A aba Servers fica disponivel apenas para servidores BungeeCord.", "warning");
    return;
  }
  if (page === "exportimport" && !canUseExportImport()) {
    location.hash = buildHashForPage("console");
    showToast("A aba Export/import fica disponível apenas para dono/admin do servidor.", "warning");
    return;
  }
  updatePageVisibility(page);
  if (page === "plugins" && state.currentUser) {
    loadPluginCatalog().catch((error) => {
      elements.pluginsStatusText.textContent = `Erro: ${error.message}`;
    });
  }
  if (page === "cowork" && state.currentUser) {
    loadCoworkAccess().catch((error) => {
      elements.coworkStatusText.textContent = `Erro: ${error.message}`;
    });
  }
  if (page === "debug" && state.currentUser) {
    loadDebugLogs().catch((error) => {
      elements.debugStatusText.textContent = `Erro: ${error.message}`;
    });
  }
  if (page === "servers" && state.currentUser) {
    loadSubServers().catch((error) => {
      elements.serversStatusText.textContent = `Erro: ${error.message}`;
    });
  }
  if (page === "settings" && state.currentUser) {
    loadJavaManagerStatus().catch((error) => {
      if (elements.javaManagerStatusText) {
        elements.javaManagerStatusText.textContent = `Erro ao carregar Java Manager: ${error.message}`;
      }
    });
  }
}

elements.loginForm.addEventListener("submit", handleLoginSubmit);
elements.themeSelect.addEventListener("change", () => applyTheme(elements.themeSelect.value));
elements.logoutButton.addEventListener("click", () => logoutCurrentAccount().catch((error) => showToast(error.message, "error")));
elements.refreshJavaManagerButton.addEventListener("click", () => {
  loadJavaManagerStatus().catch((error) => showToast(error.message, "error"));
});
elements.installMissingJavaButton.addEventListener("click", () => {
  installMissingJavaRuntimes().catch((error) => showToast(error.message, "error"));
});

for (const link of elements.navLinks) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    location.hash = buildHashForPage(link.dataset.pageLink || "console");
  });
}

elements.togglePlayersButton.addEventListener("click", () => {
  if (elements.togglePlayersButton.classList.contains("is-hidden")) return;
  state.playersPopoverOpen = !state.playersPopoverOpen;
  elements.playersPopover.classList.toggle("is-hidden", !state.playersPopoverOpen);
});

for (const button of elements.powerButtons) {
  button.addEventListener("click", () => sendPowerAction(button.dataset.powerAction).catch((error) => showToast(error.message, "error")));
}

elements.commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const command = elements.commandInput.value.trim();
  if (!command) return;
  try {
    await sendConsoleCommand(command);
    elements.commandInput.value = "";
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.consoleOutput.addEventListener("scroll", () => {
  const distanceFromBottom =
    elements.consoleOutput.scrollHeight - (elements.consoleOutput.scrollTop + elements.consoleOutput.clientHeight);
  state.consoleAutoStickToBottom = distanceFromBottom < 24;
});

elements.refreshServerFilesButton.addEventListener("click", () => loadServerFiles().catch((error) => showToast(error.message, "error")));
elements.goDirectoryButton.addEventListener("click", () => navigateToDirectory(elements.serverDirectoryInput.value.trim(), true).catch((error) => showToast(error.message, "error")));
elements.backDirectoryButton.addEventListener("click", () => goBackDirectory().catch((error) => showToast(error.message, "error")));
elements.upDirectoryButton.addEventListener("click", () => {
  if (!state.currentDirectory) return;
  const parts = state.currentDirectory.split("/").filter(Boolean);
  parts.pop();
  navigateToDirectory(parts.join("/"), true).catch((error) => showToast(error.message, "error"));
});

elements.fileUploadInput.addEventListener("change", async () => {
  try {
    await uploadFiles(Array.from(elements.fileUploadInput.files || []));
    elements.fileUploadInput.value = "";
  } catch (error) {
    showToast(error.message, "error");
  }
});
elements.fileFolderUploadInput.addEventListener("change", async () => {
  try {
    await uploadFiles(Array.from(elements.fileFolderUploadInput.files || []));
    elements.fileFolderUploadInput.value = "";
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.selectAllFilesButton.addEventListener("click", () => {
  state.selectedFilePaths = new Set(state.currentFileEntries.map((entry) => entry.path));
  renderServerItems();
});
elements.downloadSelectedFilesButton.addEventListener("click", () => downloadSelectedFiles().catch((error) => showToast(error.message, "error")));
elements.deleteSelectedFilesButton.addEventListener("click", () => deleteSelectedFiles().catch((error) => showToast(error.message, "error")));
elements.copySelectedFilesButton.addEventListener("click", copySelectedFiles);
elements.cutSelectedFilesButton.addEventListener("click", cutSelectedFiles);
elements.pasteClipboardFilesButton.addEventListener("click", () => pasteClipboardFiles().catch((error) => showToast(error.message, "error")));
elements.saveEditedFileButton.addEventListener("click", () => saveEditedFile().catch((error) => showToast(error.message, "error")));
elements.propertiesSubServerSelect.addEventListener("change", () => {
  state.propertiesTargetSubServerId = String(elements.propertiesSubServerSelect.value || "").trim();
  loadProperties().catch((error) => {
    elements.propertiesStatusText.textContent = `Erro ao carregar: ${error.message}`;
  });
});
elements.consoleTargetSelect.addEventListener("change", () => {
  const selectedValue = String(elements.consoleTargetSelect.value || "main").trim();
  state.consoleTargetSubServerId = selectedValue === "main" ? "" : selectedValue;
  loadConsole().catch((error) => showToast(error.message, "error"));
});
elements.propertiesServerIconInput.addEventListener("change", async () => {
  const file = elements.propertiesServerIconInput.files?.[0];
  if (!file) return;
  try {
    await uploadPropertiesServerIcon(file);
  } catch (error) {
    elements.propertiesServerIconStatusText.textContent = `Erro ao enviar foto: ${error.message}`;
    showToast(error.message, "error");
  } finally {
    elements.propertiesServerIconInput.value = "";
  }
});

elements.downloadSelectedVersionButton.addEventListener("click", () => {
  const version = elements.paperVersionSelect.value;
  if (!version) return;
  setVersionKind("paper");
  downloadPaperVersion(version).catch((error) => showToast(error.message, "error"));
});
elements.selectPaperKindButton.addEventListener("click", () => setVersionKind("paper"));
elements.selectBungeeKindButton.addEventListener("click", () => setVersionKind("bungeecord"));
elements.installBungeeButton.addEventListener("click", () => {
  setVersionKind("bungeecord");
  downloadPaperVersion("bungeecord").catch((error) => showToast(error.message, "error"));
});

elements.createSubServerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.newSubServerNameInput.value.trim();
  const version = elements.newSubServerVersionSelect.value;
  if (!name || !version) return;
  try {
    await createSubServer(name, version);
    elements.newSubServerNameInput.value = "";
  } catch (error) {
    showToast(error.message, "error");
    elements.serversStatusText.textContent = `Erro: ${error.message}`;
  }
});

elements.refreshSubServerFilesButton.addEventListener("click", () =>
  loadSubServerFiles().catch((error) => showToast(error.message, "error"))
);
elements.goSubDirectoryButton.addEventListener("click", () =>
  navigateSubDirectory(elements.subServerDirectoryInput.value.trim(), true).catch((error) => showToast(error.message, "error"))
);
elements.backSubDirectoryButton.addEventListener("click", () =>
  goBackSubDirectory().catch((error) => showToast(error.message, "error"))
);
elements.upSubDirectoryButton.addEventListener("click", () => {
  if (!state.subCurrentDirectory) return;
  const parts = state.subCurrentDirectory.split("/").filter(Boolean);
  parts.pop();
  navigateSubDirectory(parts.join("/"), true).catch((error) => showToast(error.message, "error"));
});
elements.subFileUploadInput.addEventListener("change", async () => {
  try {
    await uploadSubFiles(Array.from(elements.subFileUploadInput.files || []));
    elements.subFileUploadInput.value = "";
  } catch (error) {
    showToast(error.message, "error");
  }
});
elements.subFolderUploadInput.addEventListener("change", async () => {
  try {
    await uploadSubFiles(Array.from(elements.subFolderUploadInput.files || []));
    elements.subFolderUploadInput.value = "";
  } catch (error) {
    showToast(error.message, "error");
  }
});
registerUploadDropZone(elements.serverFilesDropZone, async (uploadEntries) => {
  await uploadFiles(uploadEntries);
});
registerUploadDropZone(elements.subServerFilesDropZone, async (uploadEntries) => {
  if (!state.currentSubServerId) {
    showToast("Selecione um sub-servidor antes do upload.", "warning");
    return;
  }
  await uploadSubFiles(uploadEntries);
});
elements.downloadSubSelectedFilesButton.addEventListener("click", () =>
  downloadSelectedSubFiles().catch((error) => showToast(error.message, "error"))
);
elements.copySubSelectedFilesButton.addEventListener("click", copySelectedSubFiles);
elements.cutSubSelectedFilesButton.addEventListener("click", cutSelectedSubFiles);
elements.pasteSubClipboardFilesButton.addEventListener("click", () =>
  pasteSubClipboardFiles().catch((error) => showToast(error.message, "error"))
);
elements.deleteSubSelectedFilesButton.addEventListener("click", () =>
  deleteSelectedSubFiles().catch((error) => showToast(error.message, "error"))
);
elements.saveSubEditedFileButton.addEventListener("click", () =>
  saveSubEditedFile().catch((error) => showToast(error.message, "error"))
);
elements.subServerContextDelete.addEventListener("click", async () => {
  const targetId = state.subServerContextTargetId;
  closeSubServerContextMenu();
  if (!targetId) return;
  try {
    await deleteSubServer(targetId);
  } catch (error) {
    showToast(error.message, "error");
    elements.serversStatusText.textContent = `Erro: ${error.message}`;
  }
});
elements.fileContextDelete.addEventListener("click", () => {
  deleteFileFromContextMenu().catch((error) => showToast(error.message, "error"));
});
elements.fileContextCopy.addEventListener("click", copyFileFromContextMenu);
elements.fileContextCut.addEventListener("click", cutFileFromContextMenu);
elements.fileContextRename.addEventListener("click", () => {
  renameFileFromContextMenu().catch((error) => showToast(error.message, "error"));
});
elements.fileContextExtract.addEventListener("click", () => {
  extractFileFromContextMenu().catch((error) => showToast(error.message, "error"));
});
document.addEventListener("click", (event) => {
  if (!elements.subServerContextMenu.classList.contains("is-hidden")) {
    if (!elements.subServerContextMenu.contains(event.target)) {
      closeSubServerContextMenu();
    }
  }
  if (!elements.fileContextMenu.classList.contains("is-hidden")) {
    if (!elements.fileContextMenu.contains(event.target)) {
      closeFileContextMenu();
    }
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSubServerContextMenu();
    closeFileContextMenu();
  }
});
window.addEventListener("resize", () => {
  closeSubServerContextMenu();
  closeFileContextMenu();
});
window.addEventListener("blur", () => {
  closeSubServerContextMenu();
  closeFileContextMenu();
});

elements.pluginSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await loadPluginCatalog({ resetPage: true });
  } catch (error) {
    elements.pluginsStatusText.textContent = `Erro: ${error.message}`;
  }
});

elements.pluginSortSelect.addEventListener("change", () => loadPluginCatalog({ resetPage: true }).catch(() => {}));
elements.pluginViewSelect.addEventListener("change", () => loadPluginCatalog({ resetPage: true }).catch(() => {}));
elements.pluginSourceSelect.addEventListener("change", () => loadPluginCatalog({ resetPage: true }).catch(() => {}));
elements.pluginServerVersionInput.addEventListener("change", () => loadPluginCatalog({ resetPage: true }).catch(() => {}));
elements.pluginSubServerSelect.addEventListener("change", () => {
  state.pluginTargetSubServerId = String(elements.pluginSubServerSelect.value || "").trim();
  const selected = getSelectedPluginSubServer();
  elements.pluginServerVersionInput.value = selected?.version || "";
  loadPluginCatalog({ resetPage: true }).catch(() => {});
});
elements.pluginRefreshButton.addEventListener("click", () => loadPluginCatalog({ resetPage: true }).catch(() => {}));
elements.pluginPrevPageButton.addEventListener("click", () => {
  if (state.pluginPage <= 1) return;
  state.pluginPage -= 1;
  loadPluginCatalog().catch(() => {});
});
elements.pluginNextPageButton.addEventListener("click", () => {
  if (state.pluginPage >= state.pluginPageCount) return;
  state.pluginPage += 1;
  loadPluginCatalog().catch(() => {});
});

elements.exportServerButton.addEventListener("click", () => {
  exportCurrentServer().catch((error) => {
    showToast(error.message, "error");
    elements.exportImportStatusText.textContent = `Erro ao exportar: ${error.message}`;
  });
});

elements.importServerFileInput.addEventListener("change", async () => {
  const file = elements.importServerFileInput.files?.[0];
  if (!file) {
    state.importArchiveFile = null;
    state.importArchiveFileName = "";
    elements.exportImportStatusText.textContent = "Selecione um arquivo para importar.";
    return;
  }
  try {
    state.importArchiveFile = file;
    state.importArchiveFileName = file.name;
    elements.exportImportStatusText.textContent = `Arquivo pronto para importar: ${file.name}`;
  } catch (error) {
    state.importArchiveFile = null;
    state.importArchiveFileName = "";
    elements.importServerFileInput.value = "";
    elements.exportImportStatusText.textContent = `Erro ao ler arquivo: ${error.message}`;
  }
});

elements.importServerButton.addEventListener("click", () => {
  importServerFromSelectedFile().catch((error) => {
    showToast(error.message, "error");
    elements.exportImportStatusText.textContent = `Erro ao importar: ${error.message}`;
  });
});

elements.createHomeServerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.newHomeServerNameInput.value.trim();
  if (!name) return;
  try {
    await requestJson(
      "/api/home/servers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      },
      { server: false }
    );
    elements.newHomeServerNameInput.value = "";
    await loadHomeServers();
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.adminCreateUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await requestJson(
      "/api/admin/users",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: elements.adminNewUsername.value.trim(),
          password: elements.adminNewPassword.value,
          maxServers: Number(elements.adminNewMaxServers.value),
        }),
      },
      { server: false }
    );
    elements.adminCreateUserForm.reset();
    elements.adminNewMaxServers.value = "1";
    await loadAdminUsers();
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.coworkGrantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveCoworkAccess();
  } catch (error) {
    showToast(error.message, "error");
    elements.coworkStatusText.textContent = `Erro: ${error.message}`;
  }
});

elements.refreshCoworkButton.addEventListener("click", () => {
  loadCoworkAccess().catch((error) => {
    elements.coworkStatusText.textContent = `Erro: ${error.message}`;
  });
});

elements.refreshDebugButton.addEventListener("click", () => {
  loadDebugLogs().catch((error) => {
    elements.debugStatusText.textContent = `Erro: ${error.message}`;
  });
});

window.addEventListener("error", (event) => {
  const message = String(event?.error?.message || event?.message || "").trim();
  if (!message) return;
  showToast(`Crash handler do painel: ${message}`, "error", 5200);
});

window.addEventListener("unhandledrejection", (event) => {
  const message = String(event?.reason?.message || event?.reason || "").trim();
  if (!message) return;
  showToast(`Crash handler do painel: ${message}`, "error", 5200);
});

window.addEventListener("hashchange", syncPageFromHash);

setInterval(() => {
  if (!state.currentUser || !state.currentServerId) return;
  loadConsole().catch(() => {});
  loadMachineStats().catch(() => {});
}, 2500);

async function init() {
  updatePowerActionButtons({ hasServer: false });
  setVersionKind("paper");
  applyTheme(getInitialTheme());
  await updateHealth();
  const isAuthenticated = await hydrateAuthState();
  if (!isAuthenticated) {
    toggleLoginOverlay(true);
    return;
  }
  await initializeAfterLogin();
}

init().catch((error) => {
  showToast(error.message, "error");
});








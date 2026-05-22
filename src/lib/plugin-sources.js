const DEFAULT_LIMIT = 20;

function clampLimit(limit) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
  return Math.min(50, Math.max(5, Math.floor(numeric)));
}

function normalizePage(page) {
  const numeric = Number(page);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.floor(numeric));
}

function normalizeVersion(version) {
  return String(version || "").trim();
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function isSnapshotVersion(version) {
  return /\bsnapshot\b/i.test(String(version || ""));
}

function hasVersionMatch(versions, targetVersion) {
  const normalizedTarget = normalizeVersion(targetVersion);
  if (!normalizedTarget) return true;
  if (!Array.isArray(versions) || !versions.length) return false;
  return versions.some((version) => String(version || "").trim() === normalizedTarget);
}

function buildPageResult({ items, page, pageSize, totalHits }) {
  const safeTotal = Number.isFinite(totalHits) ? Math.max(0, totalHits) : items.length;
  const pageCount = Math.max(1, Math.ceil(safeTotal / pageSize));
  return {
    items,
    page,
    pageSize,
    totalHits: safeTotal,
    pageCount,
  };
}

function mapModrinthSort(sort) {
  const normalized = String(sort || "").trim().toLowerCase();
  if (["downloads", "updated", "newest", "follows", "relevance"].includes(normalized)) {
    return normalized;
  }
  return "downloads";
}

async function searchModrinth({ query, serverVersion, limit, page, sort }) {
  const pageSize = clampLimit(limit);
  const safePage = normalizePage(page);
  const offset = (safePage - 1) * pageSize;
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String(offset),
    index: mapModrinthSort(sort),
  });

  const normalizedQuery = sanitizeText(query);
  if (normalizedQuery) {
    params.set("query", normalizedQuery);
  }

  const facets = [["project_type:plugin"]];
  const normalizedVersion = normalizeVersion(serverVersion);
  if (normalizedVersion) {
    facets.push([`versions:${normalizedVersion}`]);
  }
  params.set("facets", JSON.stringify(facets));

  const response = await fetch(`https://api.modrinth.com/v2/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Modrinth indisponivel (${response.status})`);
  }

  const payload = await response.json();
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  const items = hits.map((item) => ({
    source: "modrinth",
    id: String(item.project_id || ""),
    title: sanitizeText(item.title),
    author: sanitizeText(item.author),
    description: sanitizeText(item.description),
    iconUrl: item.icon_url || "",
    projectUrl: `https://modrinth.com/plugin/${encodeURIComponent(item.slug || item.project_id || "")}`,
    downloads: Number(item.downloads || 0),
    followers: Number(item.follows || 0),
    versions: Array.isArray(item.versions) ? item.versions : [],
    tags: Array.isArray(item.display_categories) && item.display_categories.length ? item.display_categories : Array.isArray(item.categories) ? item.categories : [],
    updatedAt: item.date_modified || item.date_created || "",
  }));

  return buildPageResult({
    items,
    page: safePage,
    pageSize,
    totalHits: Number(payload.total_hits || items.length),
  });
}

async function resolveModrinthDownload({ projectId, serverVersion }) {
  const params = new URLSearchParams({
    loaders: JSON.stringify(["paper", "spigot", "purpur", "bukkit", "folia"]),
  });
  const normalizedVersion = normalizeVersion(serverVersion);
  if (normalizedVersion) {
    params.set("game_versions", JSON.stringify([normalizedVersion]));
  }

  const response = await fetch(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(`Nao foi possivel buscar versoes no Modrinth (${response.status})`);
  }

  const versions = await response.json();
  if (!Array.isArray(versions) || !versions.length) {
    throw new Error("Nenhuma versao compativel encontrada no Modrinth");
  }

  const chosenVersion =
    versions.find((item) => {
      const versionName = String(item?.version_number || item?.name || "").trim();
      return !isSnapshotVersion(versionName);
    }) || versions[0];
  const files = Array.isArray(chosenVersion.files) ? chosenVersion.files : [];
  const selectedFile = files.find((file) => file.primary) || files.find((file) => String(file.filename || "").endsWith(".jar")) || files[0];
  if (!selectedFile?.url) {
    throw new Error("Arquivo de download nao encontrado no Modrinth");
  }

  return {
    fileName: selectedFile.filename || `${projectId}.jar`,
    downloadUrl: selectedFile.url,
    projectUrl: `https://modrinth.com/plugin/${encodeURIComponent(projectId)}`,
    versionName: String(chosenVersion.version_number || chosenVersion.name || ""),
  };
}

async function getModrinthDetails({ projectId }) {
  const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`);
  if (!response.ok) {
    throw new Error(`Nao foi possivel carregar descricao do Modrinth (${response.status})`);
  }
  const payload = await response.json();
  return {
    description: String(payload.body || payload.description || "").trim(),
    projectUrl: `https://modrinth.com/plugin/${encodeURIComponent(payload.slug || projectId)}`,
    title: sanitizeText(payload.title || ""),
  };
}

async function fetchSpigotResourceBySearch({ query, limit }) {
  const params = new URLSearchParams({
    field: "name",
    size: String(clampLimit(limit)),
  });
  const response = await fetch(
    `https://api.spiget.org/v2/search/resources/${encodeURIComponent(query)}?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(`Spigot indisponivel (${response.status})`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function fetchSpigotPopular({ limit, page }) {
  const pageSize = clampLimit(limit);
  const safePage = normalizePage(page);
  const params = new URLSearchParams({
    size: String(pageSize),
    page: String(safePage - 1),
    sort: "-downloads",
  });
  const response = await fetch(`https://api.spiget.org/v2/resources/free?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Spigot indisponivel (${response.status})`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function mapSpigotItems(items, serverVersion) {
  const normalizedVersion = normalizeVersion(serverVersion);
  return items
    .filter((item) => {
      if (!normalizedVersion) return true;
      const tested = Array.isArray(item.testedVersions) ? item.testedVersions : [];
      if (!tested.length) return true;
      return hasVersionMatch(tested, normalizedVersion);
    })
    .map((item) => ({
      source: "spigot",
      id: String(item.id || ""),
      title: sanitizeText(item.name),
      author: sanitizeText(item.author?.name || item.author || ""),
      description: sanitizeText(item.tag || ""),
      iconUrl: item.icon?.url ? `https://www.spigotmc.org/${String(item.icon.url).replace(/^\/+/, "")}` : "",
      projectUrl: `https://www.spigotmc.org/resources/${encodeURIComponent(String(item.id || ""))}`,
      downloads: Number(item.downloads || 0),
      followers: Number(item.likes || 0),
      versions: Array.isArray(item.testedVersions) ? item.testedVersions : [],
      tags: [],
      updatedAt: item.updateDate ? new Date(Number(item.updateDate) * 1000).toISOString() : "",
    }));
}

async function searchSpigot({ query, serverVersion, limit, page }) {
  const normalizedQuery = sanitizeText(query);
  const pageSize = clampLimit(limit);
  const safePage = normalizePage(page);
  const rawItems = normalizedQuery
    ? await fetchSpigotResourceBySearch({ query: normalizedQuery, limit: pageSize })
    : await fetchSpigotPopular({ limit: pageSize, page: safePage });

  const items = mapSpigotItems(rawItems, serverVersion);
  return buildPageResult({
    items,
    page: safePage,
    pageSize,
    totalHits: normalizedQuery ? items.length : safePage * pageSize + (items.length === pageSize ? pageSize : 0),
  });
}

async function resolveSpigotDownload({ projectId, serverVersion }) {
  const response = await fetch(`https://api.spiget.org/v2/resources/${encodeURIComponent(projectId)}`);
  if (!response.ok) {
    throw new Error(`Nao foi possivel buscar o plugin no Spigot (${response.status})`);
  }
  const details = await response.json();
  const testedVersions = Array.isArray(details.testedVersions) ? details.testedVersions : [];
  const normalizedVersion = normalizeVersion(serverVersion);
  if (normalizedVersion && testedVersions.length && !hasVersionMatch(testedVersions, normalizedVersion)) {
    throw new Error("Plugin Spigot sem compatibilidade declarada para esta versao");
  }

  if (details.external) {
    const externalUrl = details.file?.externalUrl || details.file?.url || "";
    if (!externalUrl) {
      throw new Error("Plugin Spigot usa download externo sem URL publica");
    }
    return {
      fileName: details.file?.name || `${projectId}.jar`,
      downloadUrl: externalUrl,
      projectUrl: `https://www.spigotmc.org/resources/${encodeURIComponent(projectId)}`,
      versionName: String(details.version?.name || ""),
    };
  }

  return {
    fileName: details.file?.name || `${projectId}.jar`,
    downloadUrl: `https://api.spiget.org/v2/resources/${encodeURIComponent(projectId)}/download`,
    projectUrl: `https://www.spigotmc.org/resources/${encodeURIComponent(projectId)}`,
    versionName: String(details.version?.name || ""),
  };
}

async function getSpigotDetails({ projectId }) {
  const response = await fetch(`https://api.spiget.org/v2/resources/${encodeURIComponent(projectId)}`);
  if (!response.ok) {
    throw new Error(`Nao foi possivel carregar descricao do Spigot (${response.status})`);
  }
  const payload = await response.json();
  return {
    description: stripHtml(payload.description || payload.tag || ""),
    projectUrl: `https://www.spigotmc.org/resources/${encodeURIComponent(projectId)}`,
    title: sanitizeText(payload.name || ""),
  };
}

async function searchPlugins({ source, query, serverVersion, limit, page, sort }) {
  const normalizedSource = String(source || "").trim().toLowerCase() || "modrinth";
  if (normalizedSource === "modrinth") {
    return searchModrinth({ query, serverVersion, limit, page, sort });
  }
  if (normalizedSource === "spigot") {
    return searchSpigot({ query, serverVersion, limit, page });
  }
  throw new Error("Fonte de plugins invalida");
}

async function resolvePluginDownload({ source, projectId, serverVersion }) {
  const normalizedSource = String(source || "").trim().toLowerCase();
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new Error("ID do plugin invalido");
  }

  if (normalizedSource === "modrinth") {
    return resolveModrinthDownload({ projectId: normalizedProjectId, serverVersion });
  }
  if (normalizedSource === "spigot") {
    return resolveSpigotDownload({ projectId: normalizedProjectId, serverVersion });
  }
  throw new Error("Fonte de plugins invalida");
}

async function getPluginDetails({ source, projectId }) {
  const normalizedSource = String(source || "").trim().toLowerCase();
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new Error("ID do plugin invalido");
  }

  if (normalizedSource === "modrinth") {
    return getModrinthDetails({ projectId: normalizedProjectId });
  }
  if (normalizedSource === "spigot") {
    return getSpigotDetails({ projectId: normalizedProjectId });
  }
  throw new Error("Fonte de plugins invalida");
}

module.exports = {
  searchPlugins,
  resolvePluginDownload,
  getPluginDetails,
};

const PANEL_PAGES = ["console", "files", "servers", "versions", "properties", "plugins", "exportimport", "settings", "cowork", "home"];

function normalizePage(input) {
  if (typeof input !== "string") {
    return "console";
  }

  return input.replace(/^\/+/, "").trim().toLowerCase();
}

function resolvePageFromHash(hash, pages = PANEL_PAGES) {
  if (typeof hash !== "string" || hash.length === 0) {
    return "console";
  }

  const raw = hash.startsWith("#/") ? hash.slice(2) : hash.startsWith("#") ? hash.slice(1) : hash;
  const candidate = normalizePage(raw);
  return pages.includes(candidate) ? candidate : "console";
}

function buildHashForPage(page) {
  return `#/${normalizePage(page)}`;
}

module.exports = {
  PANEL_PAGES,
  resolvePageFromHash,
  buildHashForPage,
};

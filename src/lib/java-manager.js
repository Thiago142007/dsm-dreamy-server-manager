function parseMinecraftVersion(version) {
  const raw = String(version || "").trim();
  const match = raw.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return { major: 0, minor: 0, patch: 0, valid: false };
  }
  return {
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
    valid: true,
  };
}

function resolveJavaMajorForPaperVersion(version) {
  const parsed = parseMinecraftVersion(version);
  if (!parsed.valid) {
    return 17;
  }
  if (parsed.major >= 2) {
    return 21;
  }
  if (parsed.major !== 1) {
    return 17;
  }

  if (parsed.minor >= 21) {
    return 21;
  }
  if (parsed.minor === 20 && parsed.patch >= 5) {
    return 21;
  }
  if (parsed.minor >= 18) {
    return 17;
  }
  if (parsed.minor === 17) {
    return 16;
  }
  return 8;
}

function resolveJavaMajorForServer({ serverKind = "paper", paperVersion = "" } = {}) {
  const normalizedKind = String(serverKind || "").trim().toLowerCase();
  if (normalizedKind === "bungeecord") {
    return 17;
  }
  return resolveJavaMajorForPaperVersion(paperVersion);
}

const MANAGED_JAVA_MAJORS = [8, 16, 17, 21];

module.exports = {
  MANAGED_JAVA_MAJORS,
  parseMinecraftVersion,
  resolveJavaMajorForPaperVersion,
  resolveJavaMajorForServer,
};

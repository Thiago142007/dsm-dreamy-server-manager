const fs = require("node:fs/promises");
const path = require("node:path");
const { parseFlags } = require("./flags");
const { createStorageManager } = require("./storage-manager");

function createRegistry({ rootDir }) {
  if (!rootDir) {
    throw new Error("rootDir is required");
  }

  const resolvedRootDir = path.resolve(rootDir);
  const metadataPath = path.join(resolvedRootDir, "extensions.json");
  const storageBaseDir = path.join(resolvedRootDir, "storage");

  async function ensureRoot() {
    await fs.mkdir(resolvedRootDir, { recursive: true });
    await fs.mkdir(storageBaseDir, { recursive: true });
  }

  async function readMetadata() {
    await ensureRoot();
    try {
      const raw = await fs.readFile(metadataPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.items)) {
        return { items: [] };
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") {
        return { items: [] };
      }
      throw error;
    }
  }

  async function writeMetadata(metadata) {
    await ensureRoot();
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  }

  function validateIdentifier(identifier) {
    if (!/^[a-z]+$/.test(identifier)) {
      throw new Error("identifier must contain only lowercase letters a-z");
    }
  }

  return {
    async installExtension(payload) {
      const identifier = String(payload.identifier || "");
      validateIdentifier(identifier);

      const record = {
        identifier,
        name: String(payload.name || identifier),
        description: String(payload.description || ""),
        version: String(payload.version || "0.1.0"),
        target: String(payload.target || "beta-2025-09"),
        author: String(payload.author || ""),
        flags: parseFlags(payload.flags || ""),
        updatedAt: new Date().toISOString(),
      };

      const metadata = await readMetadata();
      const index = metadata.items.findIndex((item) => item.identifier === identifier);
      if (index === -1) {
        metadata.items.push(record);
      } else {
        metadata.items[index] = { ...metadata.items[index], ...record };
      }

      const storage = createStorageManager({ baseDir: storageBaseDir, identifier });
      await storage.makeDirectory("public", ".");
      await storage.makeDirectory("private", ".");

      await writeMetadata(metadata);
      return record;
    },

    async listExtensions() {
      const metadata = await readMetadata();
      return metadata.items;
    },

    async getExtension(identifier) {
      const all = await this.listExtensions();
      return all.find((item) => item.identifier === identifier) || null;
    },

    createStorage(identifier) {
      return createStorageManager({ baseDir: storageBaseDir, identifier });
    },
  };
}

module.exports = {
  createRegistry,
};


const fs = require("node:fs/promises");
const path = require("node:path");

function normalizeRelativePath(input = "") {
  const cleaned = String(input).replace(/\\/g, "/").replace(/^\/+/, "");
  return cleaned;
}

function createStorageManager({ baseDir, identifier }) {
  if (!baseDir || !identifier) {
    throw new Error("baseDir and identifier are required");
  }

  const scopes = {
    public: path.resolve(baseDir, "fs", identifier),
    private: path.resolve(baseDir, "private", identifier),
  };

  function getScopeRoot(scope) {
    const root = scopes[scope];
    if (!root) {
      throw new Error(`Unknown scope: ${scope}`);
    }
    return root;
  }

  function resolvePath(scope, relativePath = "") {
    const root = getScopeRoot(scope);
    const normalized = normalizeRelativePath(relativePath);
    const target = path.resolve(root, normalized);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error("Invalid path traversal attempt");
    }
    return { root, target, normalized };
  }

  async function ensureParent(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  async function walkDirectories(startDir, mode) {
    const results = [];
    async function walk(currentDir, scopeRoot) {
      let entries = [];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") {
          return;
        }
        throw error;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relative = normalizeRelativePath(path.relative(scopeRoot, fullPath));
        if (entry.isDirectory()) {
          if (mode === "directories") {
            results.push(relative);
          }
          await walk(fullPath, scopeRoot);
        } else if (mode === "files") {
          results.push(relative);
        }
      }
    }

    await walk(startDir.target, startDir.root);
    return results;
  }

  return {
    async put(scope, relativePath, content) {
      const resolved = resolvePath(scope, relativePath);
      await ensureParent(resolved.target);
      await fs.writeFile(resolved.target, String(content), "utf8");
      return true;
    },

    async get(scope, relativePath) {
      const resolved = resolvePath(scope, relativePath);
      return fs.readFile(resolved.target, "utf8");
    },

    async json(scope, relativePath) {
      const raw = await this.get(scope, relativePath);
      return JSON.parse(raw);
    },

    async exists(scope, relativePath) {
      const resolved = resolvePath(scope, relativePath);
      try {
        await fs.access(resolved.target);
        return true;
      } catch {
        return false;
      }
    },

    async copy(scope, fromPath, toPath) {
      const fromResolved = resolvePath(scope, fromPath);
      const toResolved = resolvePath(scope, toPath);
      await ensureParent(toResolved.target);
      await fs.copyFile(fromResolved.target, toResolved.target);
      return true;
    },

    async move(scope, fromPath, toPath) {
      const fromResolved = resolvePath(scope, fromPath);
      const toResolved = resolvePath(scope, toPath);
      await ensureParent(toResolved.target);
      await fs.rename(fromResolved.target, toResolved.target);
      return true;
    },

    async prepend(scope, relativePath, text) {
      const current = (await this.exists(scope, relativePath)) ? await this.get(scope, relativePath) : "";
      await this.put(scope, relativePath, String(text) + current);
      return true;
    },

    async append(scope, relativePath, text) {
      const current = (await this.exists(scope, relativePath)) ? await this.get(scope, relativePath) : "";
      await this.put(scope, relativePath, current + String(text));
      return true;
    },

    async delete(scope, relativePath) {
      const resolved = resolvePath(scope, relativePath);
      try {
        await fs.unlink(resolved.target);
        return true;
      } catch (error) {
        if (error.code === "ENOENT") {
          return false;
        }
        throw error;
      }
    },

    async files(scope, directory = "") {
      const start = resolvePath(scope, directory);
      return walkDirectories(start, "files");
    },

    async directories(scope, directory = "") {
      const start = resolvePath(scope, directory);
      return walkDirectories(start, "directories");
    },

    async makeDirectory(scope, directory) {
      const resolved = resolvePath(scope, directory);
      await fs.mkdir(resolved.target, { recursive: true });
      return true;
    },

    async deleteDirectory(scope, directory) {
      const resolved = resolvePath(scope, directory);
      await fs.rm(resolved.target, { recursive: true, force: true });
      return true;
    },

    publicUrl(relativePath) {
      const cleaned = normalizeRelativePath(relativePath);
      return `/fs/${identifier}/${cleaned}`;
    },

    getScopePath(scope) {
      return getScopeRoot(scope);
    },
  };
}

module.exports = {
  createStorageManager,
};


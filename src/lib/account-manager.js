const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const COWORK_PERMISSION_KEYS = [
  "consoleCommand",
  "powerStart",
  "powerStopRestart",
  "filesRead",
  "filesEdit",
  "filesUpload",
  "filesDelete",
];

function sanitizeUsername(input) {
  return String(input || "").trim();
}

function sanitizeServerName(input) {
  const value = String(input || "").trim();
  return value || "Servidor";
}

function normalizeCoworkPermissions(input) {
  const source = input && typeof input === "object" ? input : {};
  const normalized = {};
  for (const key of COWORK_PERMISSION_KEYS) {
    normalized[key] = Boolean(source[key]);
  }
  return normalized;
}

function hasAnyCoworkPermission(permissions) {
  return COWORK_PERMISSION_KEYS.some((key) => Boolean(permissions[key]));
}

function fullPermissions() {
  return {
    consoleCommand: true,
    powerStart: true,
    powerStopRestart: true,
    filesRead: true,
    filesEdit: true,
    filesUpload: true,
    filesDelete: true,
  };
}

function createAccountManager({ dataDir, defaultServerDir }) {
  const rootDir = path.resolve(dataDir);
  const filePath = path.join(rootDir, "accounts.json");

  async function ensureFile() {
    await fs.mkdir(rootDir, { recursive: true });
    try {
      await fs.access(filePath);
    } catch {
      const initial = {
        lastServerNumber: 1,
        users: [
          {
            username: "admin",
            password: "85113005",
            isAdmin: true,
            maxServers: 999,
            servers: [
              {
                id: "srv-1",
                name: "Servidor Principal",
                path: path.resolve(defaultServerDir),
              },
            ],
          },
        ],
      };
      await fs.writeFile(filePath, JSON.stringify(initial, null, 2), "utf8");
    }
  }

  async function readData() {
    await ensureFile();
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.users)) {
      parsed.users = [];
    }
    if (typeof parsed.lastServerNumber !== "number") {
      parsed.lastServerNumber = 1;
    }
    return parsed;
  }

  async function writeData(data) {
    await ensureFile();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  function ensureServerShape(server) {
    if (!Array.isArray(server.cowork)) {
      server.cowork = [];
    }
    server.cowork = server.cowork
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        username: sanitizeUsername(entry.username),
        permissions: normalizeCoworkPermissions(entry.permissions),
      }))
      .filter((entry) => entry.username && hasAnyCoworkPermission(entry.permissions));
    return server;
  }

  async function normalizeData(data) {
    let changed = false;
    for (const user of data.users) {
      if (!Array.isArray(user.servers)) {
        user.servers = [];
        changed = true;
      }
      for (const server of user.servers) {
        const before = JSON.stringify(server.cowork || []);
        ensureServerShape(server);
        const after = JSON.stringify(server.cowork || []);
        if (before !== after) {
          changed = true;
        }
      }
    }
    if (changed) {
      await writeData(data);
    }
    return data;
  }

  function toPublicUser(user) {
    return {
      username: user.username,
      isAdmin: Boolean(user.isAdmin),
      maxServers: Number(user.maxServers || 0),
      servers: Array.isArray(user.servers) ? user.servers.map((srv) => ({ ...srv })) : [],
    };
  }

  async function ensureAdmin(data) {
    const hasAdmin = data.users.some((user) => user.username === "admin");
    if (hasAdmin) {
      return data;
    }

    data.lastServerNumber += 1;
    data.users.unshift({
      username: "admin",
      password: "85113005",
      isAdmin: true,
      maxServers: 999,
      servers: [
        {
          id: `srv-${data.lastServerNumber}`,
          name: "Servidor Principal",
          path: path.resolve(defaultServerDir),
        },
      ],
    });
    await writeData(data);
    return data;
  }

  return {
    async authenticate(username, password) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedUsername = sanitizeUsername(username);
      const normalizedPassword = String(password || "");
      const user = data.users.find((candidate) => candidate.username === normalizedUsername);
      if (!user || user.password !== normalizedPassword) {
        return null;
      }
      return toPublicUser(user);
    },

    async getUser(username) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const user = data.users.find((candidate) => candidate.username === sanitizeUsername(username));
      return user ? toPublicUser(user) : null;
    },

    async listUsers() {
      const data = await normalizeData(await ensureAdmin(await readData()));
      return data.users.map((user) => toPublicUser(user));
    },

    async listUsernames() {
      const data = await normalizeData(await ensureAdmin(await readData()));
      return data.users.map((user) => user.username).filter(Boolean);
    },

    async createUser({ username, password, maxServers }) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedUsername = sanitizeUsername(username);
      const normalizedPassword = String(password || "");
      const normalizedMaxServers = Number(maxServers);

      if (!normalizedUsername || !normalizedPassword || !Number.isFinite(normalizedMaxServers) || normalizedMaxServers < 1) {
        throw new Error("Invalid user payload");
      }
      if (data.users.some((user) => user.username === normalizedUsername)) {
        throw new Error("User already exists");
      }

      data.users.push({
        username: normalizedUsername,
        password: normalizedPassword,
        isAdmin: false,
        maxServers: Math.floor(normalizedMaxServers),
        servers: [],
      });
      await writeData(data);
      return toPublicUser(data.users[data.users.length - 1]);
    },

    async deleteUser(username) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedUsername = sanitizeUsername(username);
      if (normalizedUsername === "admin") {
        throw new Error("Cannot delete admin");
      }

      const before = data.users.length;
      data.users = data.users.filter((user) => user.username !== normalizedUsername);
      for (const user of data.users) {
        for (const server of user.servers || []) {
          const original = Array.isArray(server.cowork) ? server.cowork : [];
          server.cowork = original.filter((entry) => sanitizeUsername(entry.username) !== normalizedUsername);
        }
      }
      await writeData(data);
      return before !== data.users.length;
    },

    async listServers(username) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedUsername = sanitizeUsername(username);
      const user = data.users.find((candidate) => candidate.username === normalizedUsername);
      if (!user) {
        throw new Error("User not found");
      }
      return (user.servers || []).map((server) => ({ ...server }));
    },

    async listAccessibleServers(username) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedUsername = sanitizeUsername(username);
      const user = data.users.find((candidate) => candidate.username === normalizedUsername);
      if (!user) {
        throw new Error("User not found");
      }

      const results = [];
      const seenIds = new Set();
      const ownServers = Array.isArray(user.servers) ? user.servers : [];
      for (const server of ownServers) {
        if (!server?.id || seenIds.has(server.id)) continue;
        seenIds.add(server.id);
        results.push({
          ...server,
          ownerUsername: user.username,
          accessType: "owner",
          permissions: fullPermissions(),
        });
      }

      if (user.isAdmin) {
        for (const candidate of data.users) {
          for (const server of candidate.servers || []) {
            if (!server?.id || seenIds.has(server.id)) continue;
            seenIds.add(server.id);
            results.push({
              ...server,
              ownerUsername: candidate.username,
              accessType: candidate.username === user.username ? "owner" : "admin",
              permissions: fullPermissions(),
            });
          }
        }
        return results;
      }

      for (const candidate of data.users) {
        if (candidate.username === user.username) continue;
        for (const server of candidate.servers || []) {
          if (!server?.id || seenIds.has(server.id)) continue;
          const cowork = (server.cowork || []).find((entry) => sanitizeUsername(entry.username) === user.username);
          if (!cowork) continue;
          const permissions = normalizeCoworkPermissions(cowork.permissions);
          if (!hasAnyCoworkPermission(permissions)) continue;
          seenIds.add(server.id);
          results.push({
            ...server,
            ownerUsername: candidate.username,
            accessType: "cowork",
            permissions,
          });
        }
      }

      return results;
    },

    async createServerForUser(username, name) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedUsername = sanitizeUsername(username);
      const user = data.users.find((candidate) => candidate.username === normalizedUsername);
      if (!user) {
        throw new Error("User not found");
      }
      const currentServers = Array.isArray(user.servers) ? user.servers : [];
      if (currentServers.length >= Number(user.maxServers || 0)) {
        throw new Error("Server limit reached");
      }

      data.lastServerNumber += 1;
      const id = `srv-${data.lastServerNumber}`;
      const safeName = sanitizeServerName(name);
      const safeSlug = safeName.replace(/[^a-z0-9-_]/gi, "_").toLowerCase();
      const serverPath = path.join(rootDir, "servers", `${normalizedUsername}-${safeSlug}-${id}`);
      await fs.mkdir(serverPath, { recursive: true });
      await fs.writeFile(path.join(serverPath, "eula.txt"), "eula=true\n", "utf8");

      const serverRecord = {
        id,
        name: safeName,
        path: serverPath,
        cowork: [],
      };
      currentServers.push(serverRecord);
      user.servers = currentServers;
      await writeData(data);
      return { ...serverRecord };
    },

    async deleteServerForUser(username, serverId) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedUsername = sanitizeUsername(username);
      const normalizedServerId = String(serverId || "").trim();
      if (!normalizedServerId) {
        throw new Error("Server id is required");
      }

      const user = data.users.find((candidate) => candidate.username === normalizedUsername);
      if (!user) {
        throw new Error("User not found");
      }

      const currentServers = Array.isArray(user.servers) ? user.servers : [];
      const index = currentServers.findIndex((server) => server.id === normalizedServerId);
      if (index === -1) {
        return { deleted: false, server: null };
      }

      const [removedServer] = currentServers.splice(index, 1);
      user.servers = currentServers;
      await writeData(data);

      if (removedServer?.path) {
        await fs.rm(path.resolve(removedServer.path), { recursive: true, force: true });
      }

      return { deleted: true, server: { ...removedServer } };
    },

    async listCoworkAccess({ ownerUsername, serverId }) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const owner = data.users.find((candidate) => candidate.username === sanitizeUsername(ownerUsername));
      if (!owner) throw new Error("Owner not found");
      const server = (owner.servers || []).find((item) => item.id === String(serverId || "").trim());
      if (!server) throw new Error("Server not found");
      ensureServerShape(server);
      return (server.cowork || []).map((entry) => ({
        username: entry.username,
        permissions: normalizeCoworkPermissions(entry.permissions),
      }));
    },

    async setCoworkAccess({ ownerUsername, serverId, targetUsername, permissions }) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedOwner = sanitizeUsername(ownerUsername);
      const normalizedTarget = sanitizeUsername(targetUsername);
      if (!normalizedTarget) {
        throw new Error("Target username is required");
      }
      if (normalizedTarget === normalizedOwner) {
        throw new Error("Cannot set cowork access for owner");
      }

      const owner = data.users.find((candidate) => candidate.username === normalizedOwner);
      if (!owner) throw new Error("Owner not found");
      const target = data.users.find((candidate) => candidate.username === normalizedTarget);
      if (!target) throw new Error("Target user not found");

      const server = (owner.servers || []).find((item) => item.id === String(serverId || "").trim());
      if (!server) throw new Error("Server not found");
      ensureServerShape(server);

      const normalizedPermissions = normalizeCoworkPermissions(permissions);
      if (!hasAnyCoworkPermission(normalizedPermissions)) {
        throw new Error("At least one permission is required");
      }

      const coworkList = Array.isArray(server.cowork) ? server.cowork : [];
      const existingIndex = coworkList.findIndex((entry) => sanitizeUsername(entry.username) === normalizedTarget);
      if (existingIndex >= 0) {
        coworkList[existingIndex] = {
          username: normalizedTarget,
          permissions: normalizedPermissions,
        };
      } else {
        coworkList.push({
          username: normalizedTarget,
          permissions: normalizedPermissions,
        });
      }
      server.cowork = coworkList;
      await writeData(data);
      return {
        username: normalizedTarget,
        permissions: normalizedPermissions,
      };
    },

    async removeCoworkAccess({ ownerUsername, serverId, targetUsername }) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedOwner = sanitizeUsername(ownerUsername);
      const normalizedTarget = sanitizeUsername(targetUsername);
      const owner = data.users.find((candidate) => candidate.username === normalizedOwner);
      if (!owner) throw new Error("Owner not found");
      const server = (owner.servers || []).find((item) => item.id === String(serverId || "").trim());
      if (!server) throw new Error("Server not found");
      ensureServerShape(server);
      const before = server.cowork.length;
      server.cowork = server.cowork.filter((entry) => sanitizeUsername(entry.username) !== normalizedTarget);
      await writeData(data);
      return before !== server.cowork.length;
    },

    async resolveServerForUser({ username, serverId }) {
      const data = await normalizeData(await ensureAdmin(await readData()));
      const normalizedUsername = sanitizeUsername(username);
      const user = data.users.find((candidate) => candidate.username === normalizedUsername);
      if (!user) {
        throw new Error("User not found");
      }

      const ownServers = Array.isArray(user.servers) ? user.servers : [];
      if (!serverId) {
        if (!ownServers.length) {
          const accessible = await this.listAccessibleServers(normalizedUsername);
          if (!accessible.length) throw new Error("No servers available");
          return { ...accessible[0] };
        }
        return {
          ...ownServers[0],
          ownerUsername: user.username,
          accessType: "owner",
          permissions: fullPermissions(),
        };
      }

      const ownMatch = ownServers.find((server) => server.id === serverId);
      if (ownMatch) {
        return {
          ...ownMatch,
          ownerUsername: user.username,
          accessType: "owner",
          permissions: fullPermissions(),
        };
      }

      if (user.isAdmin) {
        for (const candidate of data.users) {
          const candidateServers = Array.isArray(candidate.servers) ? candidate.servers : [];
          const match = candidateServers.find((server) => server.id === serverId);
          if (match) {
            return {
              ...match,
              ownerUsername: candidate.username,
              accessType: "admin",
              permissions: fullPermissions(),
            };
          }
        }
      }

      for (const candidate of data.users) {
        if (candidate.username === user.username) continue;
        for (const server of candidate.servers || []) {
          if (server.id !== serverId) continue;
          const cowork = (server.cowork || []).find((entry) => sanitizeUsername(entry.username) === user.username);
          if (!cowork) continue;
          const permissions = normalizeCoworkPermissions(cowork.permissions);
          if (!hasAnyCoworkPermission(permissions)) continue;
          return {
            ...server,
            ownerUsername: candidate.username,
            accessType: "cowork",
            permissions,
          }
        }
      }

      throw new Error("Server not found");
    },

    createSessionToken() {
      return crypto.randomBytes(24).toString("hex");
    },
  };
}

module.exports = {
  createAccountManager,
  COWORK_PERMISSION_KEYS,
};

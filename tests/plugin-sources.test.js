const test = require("node:test");
const assert = require("node:assert/strict");

const { resolvePluginDownload } = require("../src/lib/plugin-sources");

test("resolvePluginDownload prefere versao nao-snapshot no Modrinth", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return [
          {
            version_number: "2.0.0-SNAPSHOT",
            name: "2.0.0 Snapshot",
            files: [
              {
                primary: true,
                filename: "plugin-2.0.0-snapshot.jar",
                url: "https://cdn.example/plugin-2.0.0-snapshot.jar",
              },
            ],
          },
          {
            version_number: "1.9.0",
            name: "1.9.0",
            files: [
              {
                primary: true,
                filename: "plugin-1.9.0.jar",
                url: "https://cdn.example/plugin-1.9.0.jar",
              },
            ],
          },
        ];
      },
    });

    const resolved = await resolvePluginDownload({
      source: "modrinth",
      projectId: "example-plugin",
      serverVersion: "1.21.1",
    });

    assert.equal(resolved.versionName, "1.9.0");
    assert.equal(resolved.fileName, "plugin-1.9.0.jar");
    assert.equal(resolved.downloadUrl, "https://cdn.example/plugin-1.9.0.jar");
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolvePluginDownload usa snapshot quando nao houver alternativa no Modrinth", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return [
          {
            version_number: "2.0.0-SNAPSHOT",
            name: "2.0.0 Snapshot",
            files: [
              {
                primary: true,
                filename: "plugin-2.0.0-snapshot.jar",
                url: "https://cdn.example/plugin-2.0.0-snapshot.jar",
              },
            ],
          },
        ];
      },
    });

    const resolved = await resolvePluginDownload({
      source: "modrinth",
      projectId: "example-plugin",
      serverVersion: "1.21.1",
    });

    assert.equal(resolved.versionName, "2.0.0-SNAPSHOT");
    assert.equal(resolved.fileName, "plugin-2.0.0-snapshot.jar");
    assert.equal(resolved.downloadUrl, "https://cdn.example/plugin-2.0.0-snapshot.jar");
  } finally {
    global.fetch = originalFetch;
  }
});

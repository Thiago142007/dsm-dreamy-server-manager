const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseMinecraftVersion,
  resolveJavaMajorForPaperVersion,
  resolveJavaMajorForServer,
} = require("../src/lib/java-manager");

test("java manager parses minecraft versions safely", () => {
  assert.deepEqual(parseMinecraftVersion("1.21.8"), { major: 1, minor: 21, patch: 8, valid: true });
  assert.deepEqual(parseMinecraftVersion("1.20"), { major: 1, minor: 20, patch: 0, valid: true });
  assert.deepEqual(parseMinecraftVersion("1.20.5-rc1"), { major: 1, minor: 20, patch: 5, valid: true });
  assert.deepEqual(parseMinecraftVersion("unknown"), { major: 0, minor: 0, patch: 0, valid: false });
});

test("java manager resolves java major for paper versions", () => {
  assert.equal(resolveJavaMajorForPaperVersion("1.9.4"), 8);
  assert.equal(resolveJavaMajorForPaperVersion("1.16.5"), 8);
  assert.equal(resolveJavaMajorForPaperVersion("1.17"), 16);
  assert.equal(resolveJavaMajorForPaperVersion("1.18.2"), 17);
  assert.equal(resolveJavaMajorForPaperVersion("1.20.4"), 17);
  assert.equal(resolveJavaMajorForPaperVersion("1.20.5"), 21);
  assert.equal(resolveJavaMajorForPaperVersion("1.21.8"), 21);
});

test("java manager resolves java major for server kind", () => {
  assert.equal(resolveJavaMajorForServer({ serverKind: "paper", paperVersion: "1.21.8" }), 21);
  assert.equal(resolveJavaMajorForServer({ serverKind: "paper", paperVersion: "1.16.5" }), 8);
  assert.equal(resolveJavaMajorForServer({ serverKind: "bungeecord", paperVersion: "bungeecord" }), 17);
});

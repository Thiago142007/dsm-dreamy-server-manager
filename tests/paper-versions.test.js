const test = require("node:test");
const assert = require("node:assert/strict");
const { PAPER_VERSIONS, listPaperVersions } = require("../src/lib/paper-versions");

test("paper versions catalog contains key releases", () => {
  assert.equal(typeof PAPER_VERSIONS["1.21.11"], "string");
  assert.equal(typeof PAPER_VERSIONS["1.20.4"], "string");
  assert.equal(typeof PAPER_VERSIONS["1.7.10"], "string");
});

test("listPaperVersions returns structured objects", () => {
  const items = listPaperVersions();
  assert.equal(Array.isArray(items), true);
  assert.equal(items.length > 10, true);
  assert.equal(items[0].version, "1.21.11");
  assert.match(items[0].url, /^https:\/\//);
  assert.equal(items.every((item) => !item.version.includes("-")), true);
});

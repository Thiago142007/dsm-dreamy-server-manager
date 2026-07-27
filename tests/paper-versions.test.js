const test = require("node:test");
const assert = require("node:assert/strict");
const { PAPER_VERSIONS, BEDROCK_VERSIONS, listPaperVersions, getPaperVersionUrl, listBedrockVersions, getBedrockVersionUrl } = require("../src/lib/paper-versions");

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

test("bedrock versions catalog contains key releases", () => {
  assert.equal(typeof BEDROCK_VERSIONS["1.21.11"], "string");
  assert.equal(typeof BEDROCK_VERSIONS["1.20.80"], "string");
  assert.equal(typeof BEDROCK_VERSIONS["1.19.80"], "string");
});

test("listBedrockVersions returns structured objects", () => {
  const items = listBedrockVersions();
  assert.equal(Array.isArray(items), true);
  assert.equal(items.length > 10, true);
  assert.equal(items[0].version, "1.21.11");
  assert.match(items[0].url, /^https:\/\//);
  assert.equal(items.every((item) => !item.version.includes("-")), true);
});

test("getBedrockVersionUrl returns url for known version", () => {
  const url = getBedrockVersionUrl("1.21.11");
  assert.notEqual(url, null);
  assert.match(url, /^https:\/\//);
});

test("getBedrockVersionUrl returns null for unknown version", () => {
  const url = getBedrockVersionUrl("99.99.99");
  assert.equal(url, null);
});

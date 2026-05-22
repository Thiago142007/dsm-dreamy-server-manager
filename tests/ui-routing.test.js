const test = require("node:test");
const assert = require("node:assert/strict");
const { PANEL_PAGES, resolvePageFromHash, buildHashForPage } = require("../src/lib/ui-routing");

test("resolvePageFromHash returns console for invalid hash", () => {
  assert.equal(resolvePageFromHash(""), "console");
  assert.equal(resolvePageFromHash("#/unknown"), "console");
  assert.equal(resolvePageFromHash("#"), "console");
});

test("resolvePageFromHash returns valid panel page", () => {
  for (const page of PANEL_PAGES) {
    assert.equal(resolvePageFromHash(`#/${page}`), page);
  }
});

test("buildHashForPage creates stable page hash", () => {
  assert.equal(buildHashForPage("files"), "#/files");
  assert.equal(buildHashForPage("properties"), "#/properties");
});

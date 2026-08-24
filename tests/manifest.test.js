const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("manifest remains a valid Manifest V3 extension with existing entry points", () => {
  assert.equal(manifest.manifest_version, 3);
  const paths = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page];
  for (const relativePath of paths) assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
});

test("background adult-protection dependencies exist", () => {
  for (const relativePath of ["data/adult-domains.js", "lib/adult-protection.js"]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }
});

test("every declared web accessible resource exists", () => {
  for (const group of manifest.web_accessible_resources) {
    for (const relativePath of group.resources) assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }
});

test("the extension does not request new remote-data permissions", () => {
  assert.deepEqual(manifest.permissions.sort(), ["alarms", "declarativeNetRequest", "storage", "tabs"]);
});

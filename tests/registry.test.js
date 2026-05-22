const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createRegistry } = require('../src/lib/registry');

test('registry installs and lists extensions', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsm-registry-'));
  const registry = createRegistry({ rootDir });

  const created = await registry.installExtension({
    identifier: 'dreamycore',
    name: 'Dreamy Core',
    version: '1.0.0',
    description: 'Core extension',
    target: 'beta-2025-09',
    flags: 'developerIgnoreRebuild, ignorePlaceholders',
  });

  assert.equal(created.identifier, 'dreamycore');

  const all = await registry.listExtensions();
  assert.equal(all.length, 1);
  assert.equal(all[0].identifier, 'dreamycore');
  assert.deepEqual(all[0].flags, ['developerIgnoreRebuild', 'ignorePlaceholders']);
});
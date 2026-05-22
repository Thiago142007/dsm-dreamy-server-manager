const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createStorageManager } = require('../src/lib/storage-manager');

async function makeManager() {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsm-storage-'));
  return {
    manager: createStorageManager({ baseDir, identifier: 'dreamy' }),
    baseDir,
  };
}

test('storage manager writes and reads public/private files', async () => {
  const { manager } = await makeManager();
  await manager.put('public', 'foo.txt', 'bar');
  await manager.put('private', 'secret.txt', 's3cr3t');

  assert.equal(await manager.get('public', 'foo.txt'), 'bar');
  assert.equal(await manager.get('private', 'secret.txt'), 's3cr3t');
});

test('storage manager supports append/prepend/copy/move/delete', async () => {
  const { manager } = await makeManager();
  await manager.put('private', 'example.log', 'core');
  await manager.prepend('private', 'example.log', 'pre-');
  await manager.append('private', 'example.log', '-post');

  assert.equal(await manager.get('private', 'example.log'), 'pre-core-post');

  await manager.copy('private', 'example.log', 'copy.log');
  assert.equal(await manager.exists('private', 'copy.log'), true);

  await manager.move('private', 'copy.log', 'moved.log');
  assert.equal(await manager.exists('private', 'copy.log'), false);
  assert.equal(await manager.exists('private', 'moved.log'), true);

  await manager.delete('private', 'moved.log');
  assert.equal(await manager.exists('private', 'moved.log'), false);
});

test('storage manager handles directories listing and json reads', async () => {
  const { manager } = await makeManager();
  await manager.makeDirectory('public', 'configs/nested');
  await manager.put('public', 'configs/settings.json', '{"theme":"green"}');

  const files = await manager.files('public', 'configs');
  const directories = await manager.directories('public', 'configs');

  assert.equal(files.includes('configs/settings.json'), true);
  assert.equal(directories.includes('configs/nested'), true);
  assert.deepEqual(await manager.json('public', 'configs/settings.json'), { theme: 'green' });

  await manager.deleteDirectory('public', 'configs');
  assert.equal(await manager.exists('public', 'configs/settings.json'), false);
});
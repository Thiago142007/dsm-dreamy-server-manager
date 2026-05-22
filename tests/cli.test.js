const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli');

async function withCapturedStdout(fn) {
  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const exitCode = await fn();
    return { exitCode, stdout: writes.join('') };
  } finally {
    process.stdout.write = original;
  }
}

test('cli prints version', async () => {
  const result = await withCapturedStdout(() => run(['-version']));
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /DSM version/);
});

test('cli prints info', async () => {
  const result = await withCapturedStdout(() => run(['-info']));
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Dreamy Server Manager/);
});

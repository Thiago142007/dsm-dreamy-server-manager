const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFlags } = require('../src/lib/flags');

test('parseFlags splits comma-separated values and trims whitespace', () => {
  assert.deepEqual(parseFlags('flag1, flag2,flag3'), ['flag1', 'flag2', 'flag3']);
});

test('parseFlags ignores empty entries and unknown spacing', () => {
  assert.deepEqual(parseFlags(' flag1 ,, , flag2  '), ['flag1', 'flag2']);
});
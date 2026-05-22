const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPlaceholders } = require('../src/lib/placeholders');

test('renderPlaceholders replaces known values and modifiers', () => {
  const output = renderPlaceholders('id={identifier}; upper={identifier!}; cap={identifier^}', {
    identifier: 'dreamy',
  });

  assert.equal(output, 'id=dreamy; upper=DREAMY; cap=Dreamy');
});

test('renderPlaceholders preserves escaped placeholders', () => {
  const output = renderPlaceholders('hello !{name}', { name: 'DSM' });
  assert.equal(output, 'hello {name}');
});
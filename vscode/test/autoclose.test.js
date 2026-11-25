'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decide, onDelete } = require('../lib/autoclose.js');
const scan = require('../lib/scan.js');

/** Types `keys` into `start` (| marks the cursor) the way the extension does; "⌫" is backspace. */
function type(start, keys, pairs) {
  let col = start.indexOf('|');
  let line = start.replace('|', '');
  let pending = null;
  for (const k of keys) {
    if (k === '⌫') {
      line = line.slice(0, col - 1) + line.slice(col);
      col--;
      const d = onDelete({ line, col, pending });
      if (d) { line = line.slice(0, col - d.before) + line.slice(col + d.after); col -= d.before; }
      pending = null;
      continue;
    }
    const inMath = scan.inMath(line, col);
    line = line.slice(0, col) + k + line.slice(col);
    col++;
    const a = decide({ line, col, typed: k, pairs, pending, inMath });
    if (!a) {
      if (pending && pending.at >= col - 1) pending = { ...pending, at: pending.at + 1, openEnd: pending.openEnd >= col ? pending.openEnd + 1 : pending.openEnd };
      continue;
    }
    if (a.insert !== undefined) line = line.slice(0, col) + a.insert + line.slice(col);
    if (a.remove) line = line.slice(0, col) + line.slice(col + a.remove);
    if (a.restore !== undefined) line = line.slice(0, col) + a.restore + line.slice(col);
    pending = a.pending;
  }
  return line.slice(0, col) + '|' + line.slice(col);
}

test('$ closes, and typing $ again leaves it', () => {
  assert.strictEqual(type('|', '$'), '$|$');
  assert.strictEqual(type('|', '$x'), '$x|$');
  assert.strictEqual(type('|', '$x$'), '$x$|');
  assert.strictEqual(type('Let |', '$x$ be'), 'Let $x$ be|');
});

test('$$ grows from $ and is typed over', () => {
  assert.strictEqual(type('|', '$$'), '$$|$$');
  assert.strictEqual(type('|', '$$x'), '$$x|$$');
  assert.strictEqual(type('|', '$$x$$'), '$$x$$|');
  assert.strictEqual(type('|', '$$x$y'), '$$x$y|$$');
});

test('\\( \\) and \\[ \\]', () => {
  assert.strictEqual(type('|', '\\('), '\\(|\\)');
  assert.strictEqual(type('|', '\\(x\\)'), '\\(x\\)|');
  assert.strictEqual(type('|', '\\[x\\]'), '\\[x\\]|');
  // A command right before the closer: the backslash is not swallowed.
  assert.strictEqual(type('|', '\\[a\\alpha'), '\\[a\\alpha|\\]');
});

test('no closing where it would be wrong', () => {
  // Like VS Code's own auto-closing, $ closes before the next character is known: $2^n$ is maths.
  assert.strictEqual(type('|', '$2^n$'), '$2^n$|');
  assert.strictEqual(type('|word', '$'), '$|word');
  assert.strictEqual(type('\\|', '$'), '\\$|');
  assert.strictEqual(type('\\\\|', '('), '\\\\(|');
  assert.strictEqual(type('% note |', '$'), '% note $|');
  // Closing maths typed by hand (no auto-closed $ waiting).
  assert.strictEqual(type('$x|', '$'), '$x$|');
});

test('backspace right after an auto-closed $ removes both', () => {
  assert.strictEqual(type('a |', '$⌫'), 'a |');
  assert.strictEqual(type('a |', '$x⌫⌫'), 'a |$');
  assert.strictEqual(type('a |', '$$⌫'), 'a |');
  assert.strictEqual(type('a |', '\\(⌫'), 'a |');
});

test('pairs are configurable', () => {
  const pairs = { '\\left(': '\\right)', $: '$' };
  assert.strictEqual(type('$|$', '\\left(', pairs), '$\\left(|\\right)$');
  assert.strictEqual(type('|', '\\(', pairs), '\\(|');
});

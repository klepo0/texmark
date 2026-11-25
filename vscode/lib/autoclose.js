'use strict';
// Auto-closing for maths delimiters ($ $, $$ $$, \( \), \[ \] and any pairs
// the reader adds in texmark.autoClose.pairs). VS Code's own auto-closing can't
// grow $ into $$ or type over a two-character closer like \), so the extension
// does it: after each typed character, decide() says what to add or remove.
// No VS Code API here, so the tests run in plain Node.
//
// A "pending" closer is one this code inserted and the cursor is still in
// front of: { open, close (what is left of it), full (the whole closer),
// openEnd (column after the opener), at (column where the closer starts) }.

const DEFAULT_PAIRS = { $: '$', $$: '$$', '\\(': '\\)', '\\[': '\\]' };

/** Characters that may follow the cursor for a pair to close (VS Code's autoCloseBefore idea). */
const CLOSE_BEFORE = /^($|[\s)\]},.;:!?'"`$\\])/;

/** True when the column `col` of `line` is inside a % comment (not \% and not 50%). */
function inComment(line, col) {
  for (let i = 0; i < col && i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === '%' && !/[0-9]/.test(line[i - 1] || '')) return true;
  }
  return false;
}

/**
 * What to do after `typed` was inserted, leaving the cursor at column `col`
 * of `line` (the line as it is now). `inMath` says whether the text before the
 * typed character was in maths. Returns null, or
 *   { insert: s, pending }      insert s at the cursor, cursor stays before it
 *   { remove: n, pending }      remove n characters after the cursor (typing over)
 *   { restore: s, pending }     insert s at the cursor: a half-typed-over closer is put back
 * where `pending` is the new pending closer (or null).
 */
function decide({ line, col, typed, pairs, pending, inMath }) {
  pairs = pairs || DEFAULT_PAIRS;
  const before = line.slice(0, col);
  const after = line.slice(col);
  // pending.at and pending.openEnd are columns from before the typed character went in.
  const at = col - typed.length;
  const pendingHere = pending && pending.at === at && after.startsWith(pending.close);

  if (pendingHere) {
    // $ typed straight after an auto-closed $: grow to $$ … $$.
    if (pending.openEnd === at && pending.close === pending.full) {
      const longer = pending.open + typed;
      const close = pairs[longer];
      if (close !== undefined && close.endsWith(pending.full)) {
        const add = close.slice(0, close.length - pending.full.length);
        return { insert: add, pending: { open: longer, close, full: close, openEnd: col, at: col } };
      }
    }
    // Typing the closer over the one already there.
    if (pending.close.startsWith(typed)) {
      const rest = pending.close.slice(typed.length);
      return { remove: typed.length, pending: rest ? { ...pending, close: rest, at: col } : null };
    }
    // Part of a two-character closer was typed over, then something else: put it back.
    if (pending.close !== pending.full) {
      const done = pending.full.slice(0, pending.full.length - pending.close.length);
      // The typed-over part is just before the typed character; it stays as typed text,
      // and the closer is restored in full after the cursor.
      if (before.slice(0, before.length - typed.length).endsWith(done)) {
        return { restore: done, pending: { ...pending, close: pending.full, at: col } };
      }
    }
  }

  if (inComment(line, col - typed.length)) return null;
  // Longest opener that ends at the cursor.
  const opens = Object.keys(pairs).filter((o) => o && o.endsWith(typed) && before.endsWith(o)).sort((a, b) => b.length - a.length);
  for (const open of opens) {
    const start = col - open.length;
    // Escaped: \$ is a dollar sign, \\( and \\[ are a line break and a bracket.
    if (line[start - 1] === '\\') continue;
    if (/^\$/.test(open) && inMath) continue; // this $ closes maths typed by hand
    if (/^\$/.test(open) && line[start - 1] === '$') continue; // the second $ of a hand-typed $$
    if (/^\$/.test(open) && /[0-9]/.test(after[0] || '')) continue;
    if (!CLOSE_BEFORE.test(after)) continue;
    const close = pairs[open];
    if (!close) continue;
    return { insert: close, pending: { open, close, full: close, openEnd: col, at: col } };
  }
  return null;
}

/**
 * After a backspace inside an empty pending pair ($|$, $$|$$, \(|\), **|**),
 * the rest of the pair goes too. `col` is the cursor after the backspace and
 * `line` the line as it is now. Returns { before, after }: how many characters
 * to remove before and after the cursor, or null.
 */
function onDelete({ line, col, pending }) {
  if (!pending || pending.close !== pending.full) return null;
  // The backspace removed the opener's last character, right in front of the closer.
  if (pending.openEnd !== col + 1 || pending.at !== col + 1) return null;
  const rest = pending.open.slice(0, -1);
  if (!line.slice(0, col).endsWith(rest) || !line.slice(col).startsWith(pending.full)) return null;
  return { before: rest.length, after: pending.full.length };
}

module.exports = { decide, onDelete, inComment, DEFAULT_PAIRS };

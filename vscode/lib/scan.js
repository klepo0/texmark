'use strict';
// Reads a TeXmark (.tmd) file for the editor: labels, macros, citation keys,
// the outline, and what the cursor is in the middle of typing. No VS Code
// API here, so the tests run in plain Node.

let TeXmark;
try { TeXmark = require('./texmark.js'); } catch { TeXmark = require('../../texmark.js'); }

const LABEL_CHARS = String.raw`[\w:.\-/]`;

const KIND_NAMES = {
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary',
  conjecture: 'Conjecture', claim: 'Claim', hypothesis: 'Hypothesis', definition: 'Definition',
  assumption: 'Assumption', example: 'Example', exercise: 'Exercise', problem: 'Problem',
  question: 'Question', notation: 'Notation', remark: 'Remark', note: 'Note', proof: 'Proof',
};
const ALIASES = {
  thm: 'theorem', lem: 'lemma', prop: 'proposition', cor: 'corollary', conj: 'conjecture',
  defn: 'definition', def: 'definition', rem: 'remark', ex: 'example', assum: 'assumption',
  hyp: 'hypothesis', nota: 'notation',
};
const HEADING_KINDS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];

/** The printed name of a block kind: "thm" and "theorem" give "Theorem". */
function kindName(kind) {
  const k = String(kind || '').replace(/\*$/, '');
  const full = ALIASES[k] || k;
  return KIND_NAMES[full] || (full ? full[0].toUpperCase() + full.slice(1) : '');
}

/** Lines of the file, with front matter and fenced code marked so they can be skipped. */
function lines(text) {
  const all = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let front = all[0] !== undefined && /^---\s*$/.test(all[0]);
  let fence = null;
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    let kind = 'body';
    if (front) {
      kind = 'front';
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(s)) front = false;
    } else if (fence) {
      kind = 'code';
      if (new RegExp('^\\s*' + fence + '\\s*$').test(s)) fence = null;
    } else {
      const m = /^\s*(`{3,}|~{3,})/.exec(s);
      if (m) { fence = m[1]; kind = 'code'; }
    }
    out.push({ text: s, kind, line: i });
  }
  return out;
}

/** Removes a % comment (not \% and not 50%). */
function stripComment(s) {
  return s.replace(/(^|[^\\0-9])%.*$/, '$1');
}

/** The end of the line, after `attrs`, with attribute blocks taken out. */
function plainTitle(s) {
  return s.replace(/\{(?:#|[.-])[^{}]*\}/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Labels the file defines: `{#id}` attributes and `\label{id}`.
 * Each has name, line, character, kind ("theorem", "section", "equation", …),
 * a printed kind ("Theorem") and a title or the line it sits on.
 */
function labels(text) {
  const out = [];
  const seen = new Set();
  let inMathEnv = false;
  for (const { text: raw, kind, line } of lines(text)) {
    if (kind !== 'body') continue;
    const s = stripComment(raw);
    let ctxKind = null, title = '';
    let m;
    if ((m = /^(#{1,5})\s+(.*)$/.exec(s))) {
      ctxKind = HEADING_KINDS[m[1].length - 1];
      title = plainTitle(m[2]);
    } else if ((m = /^\s*:{3,}\s*(?:\{([^}]*)\})?\s*([A-Za-z][\w-]*\*?)?\s*(?:\[([^\]]*)\])?/.exec(s)) && (m[1] || m[2])) {
      const cls = m[1] && /\.([A-Za-z][\w-]*)/.exec(m[1]);
      ctxKind = ALIASES[m[2]] || m[2] || (cls && (ALIASES[cls[1]] || cls[1])) || 'block';
      title = (m[3] || '').trim();
    } else if (/^\s*!\[/.test(s)) {
      ctxKind = 'figure';
      title = (/^\s*!\[([^\]]*)\]/.exec(s) || [])[1] || '';
    }
    const mathBefore = inMathEnv;
    if (((s.match(/\$\$/g) || []).length % 2) === 1) inMathEnv = !inMathEnv;
    if (/\\begin\s*\{(equation|align|gather|multline|flalign|eqnarray|alignat)\*?\}/.test(s)) inMathEnv = true;
    if (/\\end\s*\{(equation|align|gather|multline|flalign|eqnarray|alignat)\*?\}/.test(s)) inMathEnv = false;
    const re = /\{#([\w][\w:.\-/]*)[^}]*\}|\\label\s*\{([^}]+)\}/g;
    while ((m = re.exec(s))) {
      const name = (m[1] || m[2]).trim();
      if (seen.has(name)) continue;
      seen.add(name);
      let k = ctxKind;
      if (!k && s.slice(0, m.index).trimEnd().endsWith('$$')) k = 'equation';
      if (!k && m[2] && (mathBefore || inMathEnv)) k = 'equation';
      if (!k) k = guessFromPrefix(name) || 'label';
      out.push({
        name, line, character: m.index, kind: k, kindName: kindName(k) || k,
        title: title || raw.trim().slice(0, 80),
      });
    }
  }
  return out;
}

function guessFromPrefix(name) {
  const p = (/^([A-Za-z]+):/.exec(name) || [])[1];
  if (!p) return null;
  const map = { eq: 'equation', fig: 'figure', tab: 'table', sec: 'section', ch: 'chapter', app: 'appendix' };
  return map[p] || ALIASES[p] || (KIND_NAMES[p] ? p : null);
}

/** Reads a balanced {…} group starting at s[i] == '{'. Returns [content, endIndex]. */
function group(s, i) {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

/**
 * Macros the file defines: \newcommand, \renewcommand, \providecommand,
 * \DeclareMathOperator, \def, \let, \DeclarePairedDelimiter, \NewDocumentCommand.
 * Each has name (without the backslash), args, line and definition.
 */
function macros(text) {
  const src = lines(text).map((l) => (l.kind === 'body' ? stripComment(l.text) : '')).join('\n');
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineAt = (n) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= n) lo = mid; else hi = mid - 1; } return lo; };
  const out = [];
  const seen = new Set();
  const add = (name, args, at, definition, kind) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, args: args || 0, line: lineAt(at), definition: (definition || '').trim(), kind });
  };
  const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|DeclarePairedDelimiterX?|NewDocumentCommand|RenewDocumentCommand|DeclareDocumentCommand|newcommandx)\*?\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let name;
    if (src[i] === '{') {
      const g = group(src, i);
      name = g[0].trim();
      i = g[1];
    } else {
      const n = /^\\([A-Za-z@]+|.)/.exec(src.slice(i));
      if (!n) continue;
      name = n[0];
      i += n[0].length;
    }
    name = name.replace(/^\\/, '');
    if (!/^([A-Za-z@]+|.)$/.test(name)) continue;
    let args = 0;
    const rest = src.slice(i);
    if (/^NewDocumentCommand|^RenewDocumentCommand|^DeclareDocumentCommand/.test(m[1])) {
      const g = group(src, i + (rest.match(/^\s*/)[0].length));
      if (g) { args = (g[0].match(/[mgo]|[oOdD]\S|r\S\S|v/g) || []).length; i = g[1]; }
    } else if (/^DeclarePairedDelimiter/.test(m[1])) {
      args = 1;
    } else {
      const a = /^\s*\[(\d)\]/.exec(rest);
      if (a) { args = +a[1]; i += a[0].length; }
      const o = /^\s*\[[^\]]*\]/.exec(src.slice(i));
      if (o && a) i += o[0].length;
    }
    const after = src.slice(i).replace(/^\s*/, '');
    const def = after[0] === '{' ? group(after, 0)[0] : '';
    add(name, args, m.index, m[1] === 'DeclareMathOperator' ? '\\operatorname{' + def + '}' : def, m[1]);
  }
  const defRe = /\\(?:def|gdef|edef|xdef)\s*\\([A-Za-z@]+)((?:#\d)*)\s*\{/g;
  while ((m = defRe.exec(src))) {
    const g = group(src, defRe.lastIndex - 1);
    add(m[1], (m[2].match(/#/g) || []).length, m.index, g ? g[0] : '', 'def');
  }
  const letRe = /\\let\s*\\([A-Za-z@]+)\s*=?\s*(\\[A-Za-z@]+|.)/g;
  while ((m = letRe.exec(src))) add(m[1], 0, m.index, m[2], 'let');
  return out;
}

/** Environments the file declares with \newtheorem or \newenvironment. */
function environments(text) {
  const out = [];
  const re = /\\(?:newtheorem|newenvironment|renewenvironment|NewDocumentEnvironment)\*?\s*\{([^}]+)\}(?:\s*\[[^\]]*\])?(?:\s*\{([^}]*)\})?/g;
  let m;
  const src = lines(text).map((l) => (l.kind === 'body' ? stripComment(l.text) : '')).join('\n');
  while ((m = re.exec(src))) out.push({ name: m[1].trim(), printed: m[2] && !/\\/.test(m[2]) ? m[2] : '' });
  return out;
}

/** Splits BibTeX text into entries: key, type, and the title, author and year fields. */
function parseBib(text) {
  const out = [];
  const s = String(text);
  const re = /@\s*([A-Za-z]+)\s*([{(])\s*([^,\s{}()]+)\s*,/g;
  let m;
  while ((m = re.exec(s))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    // The entry runs until its brace closes.
    let depth = 1, j = re.lastIndex;
    const open = m[2], close = open === '{' ? '}' : ')';
    for (; j < s.length && depth; j++) {
      if (s[j] === open) depth++;
      else if (s[j] === close) depth--;
    }
    const body = s.slice(re.lastIndex, j - 1);
    const fields = {};
    const fr = /([A-Za-z][\w-]*)\s*=\s*/g;
    let f;
    while ((f = fr.exec(body))) {
      let k = fr.lastIndex, v;
      if (body[k] === '{') {
        let d = 0, e = k;
        for (; e < body.length; e++) { if (body[e] === '{') d++; else if (body[e] === '}' && --d === 0) break; }
        v = body.slice(k + 1, e);
        fr.lastIndex = e + 1;
      } else if (body[k] === '"') {
        const e = body.indexOf('"', k + 1);
        v = body.slice(k + 1, e < 0 ? body.length : e);
        fr.lastIndex = e < 0 ? body.length : e + 1;
      } else {
        v = (/^[^,]*/.exec(body.slice(k)) || [''])[0];
        fr.lastIndex = k + v.length;
      }
      fields[f[1].toLowerCase()] = v.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    }
    out.push({ key: m[3], type, title: fields.title || '', author: fields.author || '', year: fields.year || (fields.date || '').slice(0, 4), fields });
    re.lastIndex = j;
  }
  return out;
}

/** "Doe, Jane and Roe, R." → "Doe and Roe"; three or more → "Doe et al." */
function shortAuthors(author) {
  const names = String(author || '').split(/\s+and\s+/i).filter(Boolean).map((n) => {
    n = n.trim();
    if (n.includes(',')) return n.split(',')[0].trim();
    const parts = n.split(/\s+/);
    return parts[parts.length - 1];
  });
  if (names.length > 2) return names[0] + ' et al.';
  return names.join(' and ');
}

function frontMatter(text) {
  try { return TeXmark.parseFrontMatter(text) || {}; } catch { return {}; }
}

/** The .bib files the file names: `bib:` / `bibliography:` and \bibliography / \addbibresource. */
function bibFiles(text) {
  const meta = frontMatter(text);
  const out = [];
  for (const b of [].concat(meta.bib || [], meta.bibliography || [])) if (b) out.push(String(b));
  const re = /\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let m;
  for (const l of lines(text)) {
    if (l.kind !== 'body') continue;
    const s = stripComment(l.text);
    while ((m = re.exec(s))) out.push(...m[1].split(',').map((x) => x.trim()).filter(Boolean));
  }
  return [...new Set(out.map((b) => (/\.bib$/i.test(b) ? b : b + '.bib')))];
}

/** Files whose macros count too: `macros:` in the front matter and \input / \include. */
function macroFiles(text) {
  const meta = frontMatter(text);
  const out = [].concat(meta.macros || []).map(String);
  const re = /\\(?:input|include|usepackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let m;
  for (const l of lines(text)) {
    if (l.kind !== 'body') continue;
    const s = stripComment(l.text);
    while ((m = re.exec(s))) {
      for (const f of m[1].split(',').map((x) => x.trim())) {
        // \usepackage{mymacros} counts only if mymacros.sty sits next to the file; the caller checks.
        if (/^\\usepackage/.test(m[0])) out.push(f + '.sty');
        else out.push(f);
      }
    }
  }
  return [...new Set(out.filter(Boolean).map((f) => (/\.\w+$/.test(f) ? f : f + '.tex')))];
}

/**
 * The outline: headings and ::: blocks, nested.
 * Each item: { name, detail, kind: 'heading'|'block', level, line, endLine, children }.
 */
function outline(text) {
  const all = lines(text);
  const root = { level: 0, children: [] };
  const stack = [root];
  const blockStack = [];
  const last = all.length - 1;
  const close = (node, line) => { node.endLine = Math.max(node.line, line); };
  const parentFor = (level) => {
    while (stack.length > 1 && stack[stack.length - 1].level >= level) close(stack.pop(), currentLine - 1);
    return stack[stack.length - 1];
  };
  let currentLine = 0;
  for (const { text: raw, kind, line } of all) {
    currentLine = line;
    if (kind !== 'body') continue;
    const s = stripComment(raw);
    let m;
    if (!blockStack.length && (m = /^(#{1,5})\s+(.*?)\s*$/.exec(s))) {
      const level = m[1].length;
      const parent = parentFor(level);
      const lab = /\{#([^\s}]+)/.exec(m[2]);
      const node = {
        name: plainTitle(m[2]) || '(untitled)', detail: lab ? lab[1] : '', kind: 'heading',
        level, line, endLine: last, children: [],
      };
      parent.children.push(node);
      stack.push(node);
    } else if ((m = /^\s*:{3,}\s*(.*?)\s*$/.exec(s))) {
      const rest = m[1];
      if (!rest) {
        const node = blockStack.pop();
        if (node) {
          close(node, line);
          const i = stack.indexOf(node);
          if (i > 0) stack.splice(i);
        }
        continue;
      }
      const pandoc = /^\{([^}]*)\}/.exec(rest);
      let kindStr, title = '', label = '';
      if (pandoc) {
        kindStr = ((/\.([A-Za-z][\w-]*\*?)/.exec(pandoc[1]) || [])[1]) || 'block';
        label = ((/#([^\s}]+)/.exec(pandoc[1]) || [])[1]) || '';
      } else {
        const k = /^([A-Za-z][\w-]*\*?)\s*(?:\[([^\]]*)\])?\s*(?:\{([^}]*)\})?/.exec(rest);
        kindStr = k ? k[1] : rest;
        title = k && k[2] ? k[2].trim() : '';
        label = k && k[3] ? ((/#([^\s}]+)/.exec(k[3]) || [])[1] || '') : '';
      }
      const parent = stack[stack.length - 1];
      const node = {
        name: kindName(kindStr) + (title ? ' (' + title + ')' : ''), detail: label, kind: 'block',
        blockKind: ALIASES[kindStr.replace(/\*$/, '')] || kindStr.replace(/\*$/, ''),
        level: 99, line, endLine: last, children: [],
      };
      parent.children.push(node);
      stack.push(node);
      blockStack.push(node);
    }
  }
  while (stack.length > 1) close(stack.pop(), last);
  return root.children;
}

/**
 * What the cursor is typing, from the text of the line before it.
 * Returns { type, prefix, start } or null. Types:
 *   'label'   after @, or inside \ref{…} / \cref{…}
 *   'cite'    inside [@…] or \cite{…}
 *   'command' after a backslash
 *   'env'     inside \begin{…} or \end{…}
 *   'block'   after ::: at the start of a line
 *   'front'   a key at the start of a front-matter line
 */
function completionContext(before, opts) {
  opts = opts || {};
  let m;
  if (opts.inFrontMatter) {
    if ((m = /^([A-Za-z-]*)$/.exec(before))) return { type: 'front', prefix: m[1], start: 0 };
    return null;
  }
  if ((m = /^\s*:{3,}\s*([A-Za-z-]*)$/.exec(before))) return { type: 'block', prefix: m[1], start: before.length - m[1].length };
  if ((m = /\\(?:begin|end)\s*\{([A-Za-z*]*)$/.exec(before))) return { type: 'env', prefix: m[1], start: before.length - m[1].length };
  if ((m = new RegExp(String.raw`\\(?:[a-z]*cite[a-z]*\*?|nocite|Cite[a-z]*)\s*(?:\[[^\]]*\]\s*)*\{(?:[^}]*,)?\s*(${LABEL_CHARS}*)$`).exec(before))) {
    return { type: 'cite', prefix: m[1], start: before.length - m[1].length };
  }
  if ((m = new RegExp(String.raw`\\(?:[cC]ref|[cC]pageref|ref|eqref|pageref|autoref|nameref|labelcref|hyperref\[|crefrange|Crefrange)\s*\{?(?:[^}\]]*,)?\s*(${LABEL_CHARS}*)$`).exec(before))
    && /[{[]/.test(before.slice(before.lastIndexOf('\\')))) {
    return { type: 'label', prefix: m[1], start: before.length - m[1].length };
  }
  if ((m = new RegExp(String.raw`(?:^|[^\\])\[([^\[\]]*)(?<![\w\\@])@(${LABEL_CHARS}*)$`).exec(before))) {
    return { type: 'cite', prefix: m[2], start: before.length - m[2].length };
  }
  if ((m = new RegExp(String.raw`(?:^|[^\w\\@])@(${LABEL_CHARS}*)$`).exec(before))) {
    return { type: 'label', prefix: m[1], start: before.length - m[1].length };
  }
  if ((m = /\\([A-Za-z@]*)$/.exec(before)) && !/\\\\[A-Za-z@]*$/.test(before.slice(-m[0].length - 1))) {
    return { type: 'command', prefix: m[1], start: before.length - m[1].length - 1 };
  }
  return null;
}

/** True when the line is inside maths ($…$, $$…$$, \[…\], \(…\)) at that column, judged from the whole text up to it. */
function inMath(text, offset) {
  const s = String(text).slice(0, offset);
  let math = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      if (!math && (n === '[' || n === '(')) { math = n === '[' ? '\\]' : '\\)'; i++; continue; }
      if (math && ((n === ']' && math === '\\]') || (n === ')' && math === '\\)'))) { math = null; i++; continue; }
      i++;
      continue;
    }
    if (c === '%' && !/\d/.test(s[i - 1] || '')) { const e = s.indexOf('\n', i); if (e < 0) break; i = e; continue; }
    if (c === '$') {
      if (s[i + 1] === '$') {
        if (math === '$$') math = null; else if (!math) math = '$$';
        i++;
      } else if (math === '$') math = null;
      else if (!math && s[i + 1] && !/\s/.test(s[i + 1])) math = '$';
      continue;
    }
    if (c === '\n' && math === '$') math = null;
  }
  return !!math;
}

module.exports = {
  lines, labels, macros, environments, parseBib, shortAuthors, frontMatter, bibFiles, macroFiles,
  outline, completionContext, inMath, kindName, KIND_NAMES, ALIASES,
};

'use strict';
// TeXmark for VS Code: the .tmd language (colours, snippets, completion, outline,
// go to definition, hovers, reference checks), Convert to .tex, Build PDF with
// the reader's LaTeX, and a live preview through the TeXglass extension.

const vscode = require('vscode');
const path = require('path');
const scan = require('./lib/scan.js');
const build = require('./lib/build.js');
const LATEX = require('./lib/latex.js');
const autoclose = require('./lib/autoclose.js');

let TeXmark;
try { TeXmark = require('./lib/texmark.js'); } catch { TeXmark = require('../texmark.js'); }

const LANG = 'texmark';
const SELECTOR = [{ language: LANG }];
const TEXGLASS_ID = 'klepo1.texglass';
const isTmd = (doc) => !!doc && (doc.languageId === LANG || /\.tmd$/i.test(doc.fileName));
const cfg = () => vscode.workspace.getConfiguration('texmark');

// ------------------------------------------------------------------ files

/** Text of a file next to `doc` (open editors first), or null. Cached by modification time. */
const fileCache = new Map();
async function readNear(doc, rel) {
  const base = vscode.Uri.joinPath(doc.uri, '..');
  const uri = path.isAbsolute(rel) && doc.uri.scheme === 'file' ? vscode.Uri.file(rel) : vscode.Uri.joinPath(base, rel);
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return { uri, text: open.getText() };
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    const key = uri.toString();
    const hit = fileCache.get(key);
    if (hit && hit.mtime === stat.mtime) return { uri, text: hit.text };
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    fileCache.set(key, { mtime: stat.mtime, text });
    return { uri, text };
  } catch {
    return null;
  }
}

/** Citation entries from the .bib files the document names: [{ key, …, uri, offset }]. */
async function bibEntries(doc) {
  const out = [];
  for (const f of scan.bibFiles(doc.getText())) {
    const file = await readNear(doc, f);
    if (!file) continue;
    for (const e of scan.parseBib(file.text)) {
      const at = new RegExp('@\\s*\\w+\\s*[{(]\\s*' + e.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,').exec(file.text);
      out.push({ ...e, uri: file.uri, offset: at ? at.index : 0, text: file.text });
    }
  }
  return out;
}

/** Macros from the document and from its macro files (front matter `macros:`, \input, local .sty). */
async function allMacros(doc) {
  const text = doc.getText();
  const out = scan.macros(text).map((m) => ({ ...m, uri: doc.uri }));
  for (const f of scan.macroFiles(text)) {
    const file = await readNear(doc, f);
    if (file) out.push(...scan.macros(file.text).map((m) => ({ ...m, uri: file.uri })));
  }
  return out;
}

// ------------------------------------------------------------- completion

function rangeFrom(position, start) {
  return new vscode.Range(position.line, start, position.line, position.character);
}

/** True when `position` sits in the front matter. */
function inFrontMatter(doc, position) {
  if (!/^---\s*$/.test(doc.lineAt(0).text)) return false;
  for (let i = 1; i < doc.lineCount && i <= position.line; i++) {
    if (/^(---|\.\.\.)\s*$/.test(doc.lineAt(i).text)) return i > position.line;
  }
  return true;
}

const completion = {
  async provideCompletionItems(doc, position) {
    const before = doc.lineAt(position.line).text.slice(0, position.character);
    const front = inFrontMatter(doc, position);
    const ctx = scan.completionContext(before, { inFrontMatter: front });
    const on = (k) => cfg().get('completion.' + k, true);
    if (!ctx) return front || !on('snippets') ? undefined : snippetItems(before, position);
    const range = rangeFrom(position, ctx.start);
    const items = [];
    const text = doc.getText();

    if ((ctx.type === 'label' && on('labels')) || (ctx.type === 'cite' && on('labels') && on('citations'))) {
      for (const l of scan.labels(text)) {
        const it = new vscode.CompletionItem(l.name, vscode.CompletionItemKind.Reference);
        it.range = range;
        it.detail = l.kindName + (l.title ? ' · ' + l.title : '');
        it.documentation = new vscode.MarkdownString().appendCodeblock(doc.lineAt(l.line).text, LANG);
        it.sortText = (ctx.type === 'cite' ? '1' : '0') + String(l.line).padStart(6, '0');
        items.push(it);
      }
    }
    if (ctx.type === 'cite' && on('citations')) {
      for (const e of await bibEntries(doc)) {
        const it = new vscode.CompletionItem(e.key, vscode.CompletionItemKind.Value);
        it.range = range;
        it.detail = [scan.shortAuthors(e.author), e.year].filter(Boolean).join(' ');
        it.documentation = new vscode.MarkdownString(bibMarkdown(e));
        it.filterText = [e.key, e.title, e.author, e.year].join(' ');
        it.sortText = '0' + e.key.toLowerCase();
        items.push(it);
      }
    }
    if (ctx.type === 'command') {
      const math = scan.inMath(text, doc.offsetAt(position));
      for (const m of on('macros') ? await allMacros(doc) : []) {
        const it = new vscode.CompletionItem('\\' + m.name, vscode.CompletionItemKind.Function);
        it.range = range;
        it.insertText = new vscode.SnippetString('\\\\' + m.name + Array.from({ length: m.args }, (_, i) => '{${' + (i + 1) + '}}').join(''));
        it.detail = m.definition ? m.definition.slice(0, 80) : (m.kind || 'macro');
        it.documentation = new vscode.MarkdownString('Defined ' + (m.uri.toString() === doc.uri.toString() ? 'on line ' + (m.line + 1) : 'in ' + path.basename(m.uri.path)));
        it.sortText = '0' + m.name;
        items.push(it);
      }
      const add = (list, kind, rank) => {
        for (const [name, body, detail] of list) {
          const it = new vscode.CompletionItem('\\' + name, kind);
          it.range = range;
          it.insertText = new vscode.SnippetString('\\\\' + (body || name.replace(/[$}\\]/g, '\\$&')));
          if (detail) it.detail = detail;
          // \begin opens the environment list, which fills in arguments, body and \end.
          if (name === 'begin') it.command = { command: 'editor.action.triggerSuggest', title: 'Environments' };
          it.sortText = rank + name;
          items.push(it);
        }
      };
      if (on('latexCommands')) {
        add(LATEX.MATH, vscode.CompletionItemKind.Constant, math ? '1' : '3');
        add(LATEX.TEXT, vscode.CompletionItemKind.Keyword, math ? '3' : '1');
      }
      // The reader's own commands (texmark.completion.extraCommands), first.
      const extra = (cfg().get('completion.extraCommands', []) || []).map((c) => (typeof c === 'string'
        ? [c.replace(/^\\/, '')]
        : c && c.name ? [String(c.name).replace(/^\\/, ''), c.snippet ? String(c.snippet).replace(/^\\/, '') : undefined, c.detail] : null)).filter(Boolean);
      add(extra, vscode.CompletionItemKind.Function, '0');
    }
    if (ctx.type === 'env' && on('environments')) {
      const isBegin = /\\begin\s*\{[A-Za-z*]*$/.test(before);
      const after = doc.lineAt(position.line).text.slice(position.character);
      const rest = /^[A-Za-z*]*/.exec(after)[0];
      const hasClose = after[rest.length] === '}';
      // Is the matching \end already there? The \begin completion (and a snippet)
      // writes \end{env} with the same name, which mirrors what is typed here.
      const word = ctx.prefix + rest;
      const ahead = text.slice(doc.offsetAt(position), doc.offsetAt(position) + 4000);
      const next = /\\(begin|end)\s*\{([^}]*)\}/.exec(ahead.slice(rest.length + (hasClose ? 1 : 0)));
      const endThere = !!next && next[1] === 'end' && next[2] === word;
      const addEnd = isBegin && on('environmentEnd') && !endThere && !/\\end\s*\{/.test(after);
      const theoremKinds = new Set(Object.keys(scan.KIND_NAMES).filter((k) => k !== 'proof')
        .concat(scan.environments(text).filter((e) => e.theorem).map((e) => e.name)));
      const envs = LATEX.ENVIRONMENTS.concat(scan.environments(text).map((e) => [e.name, e.printed || 'declared in this file']));
      const seen = new Set();
      for (const [name, detail] of envs) {
        if (seen.has(name)) continue;
        seen.add(name);
        const it = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
        if (detail) it.detail = detail;
        if (addEnd) {
          const indent = /^\s*/.exec(doc.lineAt(position.line).text)[0];
          it.range = new vscode.Range(position.line, ctx.start, position.line, position.character + rest.length + (hasClose ? 1 : 0));
          it.insertText = new vscode.SnippetString(envSnippet(name, indent, theoremKinds));
        } else {
          // Only the name, inside the braces, so a snippet's mirrored \end{…} follows it.
          it.range = new vscode.Range(position.line, ctx.start, position.line, position.character + rest.length);
          it.insertText = hasClose ? name : name + '}';
        }
        items.push(it);
      }
    }
    if (ctx.type === 'block' && on('blocks')) {
      const kinds = Object.keys(scan.KIND_NAMES).concat(scan.environments(text).map((e) => e.name));
      // ":::" with no space yet gets one.
      const space = /\s$/.test(before.slice(0, ctx.start)) ? '' : ' ';
      [...new Set(kinds)].forEach((k, i) => {
        const it = new vscode.CompletionItem(k, vscode.CompletionItemKind.Struct);
        it.range = range;
        it.detail = scan.kindName(k);
        const prefix = scan.labelPrefix(k);
        // Tab stops: the title, then the label, then the body. Delete [Title] or {#…} when not wanted.
        it.insertText = k === 'proof'
          ? new vscode.SnippetString(space + 'proof\n$0\n:::')
          : new vscode.SnippetString(space + k + ' [${1:Title}] {#' + prefix + ':${2:label}\\}\n$0\n:::');
        it.filterText = k;
        it.sortText = String(i).padStart(3, '0');
        items.push(it);
      });
    }
    if (ctx.type === 'front' && on('frontMatter')) {
      for (const [key, body, detail] of LATEX.FRONT_MATTER) {
        const it = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
        it.range = range;
        it.insertText = new vscode.SnippetString(body);
        it.detail = detail;
        items.push(it);
      }
    }
    return new vscode.CompletionList(items, false);
  },
};

// Snippets are offered here rather than through a snippets contribution, so
// they stay out of \begin{…}, \commands and @labels: "align" after \begin{
// is the environment name, not a second \begin{align}.
const SNIPPETS = require('./snippets/texmark.json');

/**
 * The snippet after "\\begin{" for environment `name`: its arguments, the body
 * with tab stops, and the \\end. Theorem kinds get [Title] and a label.
 */
function envSnippet(name, indent, theoremKinds) {
  let t = LATEX.ENV_TEMPLATES[name];
  if (!t && theoremKinds.has(name.replace(/\*$/, ''))) {
    t = /\*$/.test(name)
      ? { args: '[${1:Title}]', body: '${2}' }
      : { args: '[${1:Title}]\\label{' + scan.labelPrefix(name) + ':${2:label}}', body: '${3}' };
  }
  t = t || { body: '' };
  const inner = indent + '\t';
  const body = (t.body || '').split('\n').map((l) => (l.startsWith('\t') ? inner + l : inner + l)).join('\n');
  const close = indent + '\\end{' + name.replace(/[$}\\]/g, '\\$&') + '}';
  return name.replace(/[$}\\]/g, '\\$&') + '}' + (t.args || '') + '\n' + body + (t.body ? '' : '$0') + '\n' + close + (t.body ? '$0' : '');
}

function snippetItems(before, position) {
  const word = /[A-Za-z*]*$/.exec(before)[0];
  // Not in the middle of a word that follows a backslash, @, : or {.
  const prev = before[before.length - word.length - 1];
  if (prev && /[\\@:{\w]/.test(prev)) return undefined;
  const range = rangeFrom(position, position.character - word.length);
  const items = [];
  // texmark.completion.customSnippets adds snippets, replaces built-in ones by
  // name, and removes one set to null.
  const all = { ...SNIPPETS, ...(cfg().get('completion.customSnippets', {}) || {}) };
  for (const [name, sn] of Object.entries(all)) {
    if (!sn || !sn.prefix || !sn.body) continue;
    for (const prefix of [].concat(sn.prefix)) {
      const it = new vscode.CompletionItem({ label: prefix, description: name }, vscode.CompletionItemKind.Snippet);
      it.range = range;
      it.insertText = new vscode.SnippetString([].concat(sn.body).join('\n'));
      it.detail = sn.description;
      it.documentation = new vscode.MarkdownString().appendCodeblock([].concat(sn.body).join('\n').replace(/\$\{\d+:?([^{}]*)\}|\$\d/g, '$1').replace(/\\\\/g, '\\'), LANG);
      it.sortText = '~' + prefix;
      items.push(it);
    }
  }
  return new vscode.CompletionList(items, false);
}

function bibMarkdown(e) {
  const parts = [];
  if (e.author) parts.push(e.author.replace(/\s+and\s+/gi, ', '));
  if (e.year) parts.push('(' + e.year + ')');
  let md = parts.join(' ');
  if (e.title) md += (md ? '. ' : '') + '*' + e.title + '*';
  const venue = e.fields.journal || e.fields.booktitle || e.fields.publisher || '';
  if (venue) md += '. ' + venue;
  return md + '\n\n`' + e.key + '` in ' + path.basename(e.uri.path);
}

// ------------------------------------------------- what is under the cursor

const KEY = /[\w][\w:.\-/]*[\w]|[\w]/;

/** The label or citation key at `position`: { key, kind: 'label' | 'cite' | 'either', range } or a macro. */
function keyAt(doc, position) {
  const line = doc.lineAt(position.line).text;
  const range = doc.getWordRangeAtPosition(position, /\\[A-Za-z@]+|[\w][\w:.\-/]*[\w]|[\w]/);
  if (!range) return null;
  const word = doc.getText(range);
  const before = line.slice(0, range.start.character);
  if (word.startsWith('\\')) return { key: word.slice(1), kind: 'macro', range };
  const ctx = scan.completionContext(before);
  if (ctx && (ctx.type === 'label' || ctx.type === 'cite') && ctx.prefix === '') {
    if (!KEY.test(word)) return null;
    return { key: word, kind: ctx.type === 'cite' ? 'either' : 'label', range };
  }
  if (/\{#$/.test(before)) return { key: word, kind: 'label', range };
  return null;
}

const definition = {
  async provideDefinition(doc, position) {
    const at = keyAt(doc, position);
    if (!at) return undefined;
    if (at.kind === 'macro') {
      const m = (await allMacros(doc)).find((x) => x.name === at.key);
      if (!m) return undefined;
      if (m.uri.toString() === doc.uri.toString()) return new vscode.Location(doc.uri, new vscode.Position(m.line, 0));
      return new vscode.Location(m.uri, new vscode.Position(m.line, 0));
    }
    const l = scan.labels(doc.getText()).find((x) => x.name === at.key);
    if (l) return new vscode.Location(doc.uri, new vscode.Position(l.line, l.character));
    if (at.kind !== 'label') {
      const e = (await bibEntries(doc)).find((x) => x.key === at.key);
      if (e) {
        const before = e.text.slice(0, e.offset);
        const line = (before.match(/\n/g) || []).length;
        return new vscode.Location(e.uri, new vscode.Position(line, 0));
      }
    }
    return undefined;
  },
};

const hover = {
  async provideHover(doc, position) {
    if (!cfg().get('hover.enabled', true)) return undefined;
    const at = keyAt(doc, position);
    if (!at) return undefined;
    if (at.kind === 'macro') {
      const m = (await allMacros(doc)).find((x) => x.name === at.key);
      if (!m) return undefined;
      const md = new vscode.MarkdownString();
      md.appendCodeblock('\\' + m.name + (m.args ? '  (' + m.args + ' argument' + (m.args > 1 ? 's' : '') + ')' : '') + (m.definition ? '  →  ' + m.definition : ''), 'latex');
      return new vscode.Hover(md, at.range);
    }
    const l = scan.labels(doc.getText()).find((x) => x.name === at.key);
    if (l) {
      const md = new vscode.MarkdownString('**' + l.kindName + '**' + (l.title && l.kind !== 'equation' ? ' · ' + l.title : '') + ' · line ' + (l.line + 1));
      const lines = [];
      for (let i = l.line; i < Math.min(doc.lineCount, l.line + 6); i++) {
        const t = doc.lineAt(i).text;
        if (i > l.line && (/^\s*:::\s*$/.test(t) || !t.trim())) break;
        lines.push(t);
      }
      md.appendCodeblock(lines.join('\n'), LANG);
      return new vscode.Hover(md, at.range);
    }
    if (at.kind !== 'label') {
      const e = (await bibEntries(doc)).find((x) => x.key === at.key);
      if (e) return new vscode.Hover(new vscode.MarkdownString(bibMarkdown(e)), at.range);
    }
    return undefined;
  },
};

// ------------------------------------------------- outline and folding

const SYMBOL_KIND = {
  theorem: vscode.SymbolKind.Class, lemma: vscode.SymbolKind.Class, proposition: vscode.SymbolKind.Class,
  corollary: vscode.SymbolKind.Class, definition: vscode.SymbolKind.Interface, proof: vscode.SymbolKind.Event,
  remark: vscode.SymbolKind.String, example: vscode.SymbolKind.Struct,
};

const symbols = {
  provideDocumentSymbols(doc) {
    const toSymbol = (n) => {
      const end = doc.lineAt(Math.min(n.endLine, doc.lineCount - 1)).range.end;
      const range = new vscode.Range(n.line, 0, end.line, end.character);
      const sel = doc.lineAt(n.line).range;
      const kind = n.kind === 'heading' ? vscode.SymbolKind.Namespace : (SYMBOL_KIND[n.blockKind] || vscode.SymbolKind.Object);
      const s = new vscode.DocumentSymbol(n.name, n.detail || '', kind, range, sel);
      s.children = n.children.map(toSymbol);
      return s;
    };
    return scan.outline(doc.getText()).map(toSymbol);
  },
};

const folding = {
  provideFoldingRanges(doc) {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        let end = n.endLine;
        // A section folds up to (not including) the blank lines before the next one.
        if (n.kind === 'heading') while (end > n.line && !doc.lineAt(end).text.trim()) end--;
        if (end > n.line) out.push(new vscode.FoldingRange(n.line, end, vscode.FoldingRangeKind.Region));
        walk(n.children);
      }
    };
    walk(scan.outline(doc.getText()));
    const ls = scan.lines(doc.getText());
    let start = null, open = null;
    for (const l of ls) {
      if (l.kind === 'front' && start === null && l.line === 0) start = 0;
      if (start === 0 && l.kind !== 'front') { out.push(new vscode.FoldingRange(0, l.line - 1)); start = -1; }
      if (l.kind === 'body') {
        const n = (l.text.match(/\$\$/g) || []).length;
        if (n % 2 === 1) {
          if (open === null) open = l.line;
          else { if (l.line > open) out.push(new vscode.FoldingRange(open, l.line)); open = null; }
        }
      }
    }
    return out;
  },
};

// ------------------------------------------------- reference checks

const lint = vscode.languages.createDiagnosticCollection('texmark');

async function checkReferences(doc) {
  if (!isTmd(doc)) return;
  const lintRefs = cfg().get('lint.references', true), lintCites = cfg().get('lint.citations', true);
  if (!lintRefs && !lintCites) { lint.delete(doc.uri); return; }
  const text = doc.getText();
  const labels = new Set(scan.labels(text).map((l) => l.name));
  const bibs = scan.bibFiles(text);
  let keys = null;
  if (bibs.length) {
    const entries = await bibEntries(doc);
    // Only judge citations when every named .bib file was found.
    let found = 0;
    for (const f of bibs) if (await readNear(doc, f)) found++;
    if (found === bibs.length) keys = new Set(entries.map((e) => e.key));
  }
  const diags = [];
  for (const { text: raw, kind, line } of scan.lines(text)) {
    if (kind !== 'body') continue;
    const s = raw.replace(/(^|[^\\0-9])%.*$/, '$1').replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length));
    const masked = s.replace(/\$\$[^$]*\$\$|\$[^$\s][^$]*\$/g, (m) => ' '.repeat(m.length));
    let m;
    // [@key; @other]: citations, or references when the key is a label.
    const cite = /\[([^\[\]]*?(?<![\w\\@])@[^\[\]]*)\]/g;
    const inCite = [];
    while ((m = cite.exec(masked))) {
      inCite.push([m.index, m.index + m[0].length]);
      const kr = /(?<![\w\\@])@([\w][\w:.\-/]*[\w]|[\w])/g;
      let k;
      while ((k = kr.exec(m[1]))) {
        const key = k[1];
        if (labels.has(key) || !keys || keys.has(key)) continue;
        const col = m.index + 1 + k.index + 1;
        if (lintCites) diags.push(warn(line, col, key.length, `No entry "${key}" in ${bibs.join(', ')}.`));
      }
    }
    // @label outside brackets: \cref when the key is a label or contains ':'.
    const ref = /(?<![\w\\@])@([\w][\w:.\-/]*[\w]|[\w])/g;
    while ((m = ref.exec(masked))) {
      if (inCite.some(([a, b]) => m.index >= a && m.index < b)) continue;
      const key = m[1];
      if (labels.has(key) || !key.includes(':')) continue;
      if (lintRefs) diags.push(warn(line, m.index + 1, key.length, `No label "${key}" in this file.`));
    }
    const tex = /\\(?:[cC]ref|ref|eqref|autoref|pageref|nameref)\s*\{([^}]*)\}/g;
    while ((m = tex.exec(masked))) {
      let col = m.index + m[0].indexOf('{') + 1;
      for (const part of m[1].split(',')) {
        const key = part.trim();
        if (lintRefs && key && !labels.has(key)) diags.push(warn(line, col + part.indexOf(key), key.length, `No label "${key}" in this file.`));
        col += part.length + 1;
      }
    }
  }
  lint.set(doc.uri, diags);
}

function warn(line, col, len, message) {
  const d = new vscode.Diagnostic(new vscode.Range(line, col, line, col + len), message, vscode.DiagnosticSeverity.Warning);
  d.source = 'TeXmark';
  return d;
}

// ------------------------------------------------------------ commands

function targetUri(arg) {
  if (arg instanceof vscode.Uri) return arg;
  const ed = vscode.window.activeTextEditor;
  if (ed && isTmd(ed.document)) return ed.document.uri;
  return null;
}

async function sourceText(uri) {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  return open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

async function exists(uri) {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

async function convertToTex(arg) {
  const uri = targetUri(arg);
  if (!uri) { vscode.window.showInformationMessage('Open a TeXmark (.tmd) file to convert it to .tex.'); return null; }
  const target = uri.with({ path: uri.path.replace(/\.tmd$/i, '') + '.tex' });
  const name = path.basename(target.path);
  if (await exists(target)) {
    const ok = await vscode.window.showWarningMessage(`${name} already exists. Replace it?`, { modal: true }, 'Replace');
    if (ok !== 'Replace') return null;
  }
  const latex = TeXmark.convert(await sourceText(uri)).latex;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(latex));
  // Not awaited: the command finishes while the notification stays up.
  vscode.window.showInformationMessage(`Wrote ${name}.`, 'Open').then((open) => {
    if (open) vscode.window.showTextDocument(target, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  });
  return target;
}

async function preview(arg) {
  const uri = targetUri(arg);
  if (vscode.extensions.getExtension(TEXGLASS_ID)) {
    return vscode.commands.executeCommand('texglass.openPreviewToSide', uri || undefined);
  }
  const pick = await vscode.window.showInformationMessage(
    'The live preview of TeXmark files comes from the TeXglass extension: rendered maths, numbered theorems, working references, no LaTeX needed.',
    'Install TeXglass', 'Build PDF instead');
  if (pick === 'Install TeXglass') {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', TEXGLASS_ID);
    if (vscode.extensions.getExtension(TEXGLASS_ID)) return vscode.commands.executeCommand('texglass.openPreviewToSide', uri || undefined);
    vscode.commands.executeCommand('workbench.extensions.search', TEXGLASS_ID);
  } else if (pick === 'Build PDF instead') {
    return buildPdf(uri);
  }
  return null;
}

let output;
const buildDiags = vscode.languages.createDiagnosticCollection('texmark-build');
let running = null;

function log(s) {
  if (!output) output = vscode.window.createOutputChannel('TeXmark');
  output.appendLine(s);
}

function runStep(step, token) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    log('> ' + build.describe(step));
    let child;
    try {
      // No shell: paths with spaces ("OneDrive - University") stay one argument each.
      child = spawn(step.cmd, step.args, { cwd: step.cwd, env: { ...process.env, ...(step.env || {}) } });
    } catch (e) {
      resolve({ code: -1, missing: true, error: e });
      return;
    }
    const kill = token && token.onCancellationRequested(() => child.kill());
    child.stdout.on('data', (d) => output.append(d.toString()));
    child.stderr.on('data', (d) => output.append(d.toString()));
    child.on('error', (e) => { if (kill) kill.dispose(); resolve({ code: -1, missing: e.code === 'ENOENT', error: e }); });
    child.on('close', (code) => {
      if (kill) kill.dispose();
      resolve({ code });
    });
  });
}

async function buildPdf(arg, opts) {
  opts = opts || {};
  const uri = targetUri(arg);
  if (!uri) { vscode.window.showInformationMessage('Open a TeXmark (.tmd) file to build it.'); return null; }
  if (uri.scheme !== 'file') { vscode.window.showInformationMessage('Building a PDF needs a file on this computer and an installed LaTeX.'); return null; }
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open && open.isDirty) await open.save();
  if (running) { running.cancel(); await running.done; }

  const c = cfg();
  const text = await sourceText(uri);
  const result = TeXmark.convert(text, { compact: true });
  const p = build.plan({
    tmdPath: uri.fsPath,
    outDir: c.get('build.outDir', '.texmark'),
    tool: c.get('build.tool', 'latexmk'),
    engine: c.get('build.engine', 'pdflatex'),
    hasBib: !!(result.meta.bib || result.meta.bibliography) || /\\bibliography\s*\{/.test(text),
  });
  const outDirUri = vscode.Uri.file(p.outDir);
  await vscode.workspace.fs.createDirectory(outDirUri);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(p.texPath), new TextEncoder().encode(result.latex));

  if (!output) output = vscode.window.createOutputChannel('TeXmark');
  output.clear();
  log(`Building ${path.basename(uri.fsPath)} (${new Date().toLocaleTimeString()})`);

  const cts = new vscode.CancellationTokenSource();
  let finish;
  running = { cancel: () => cts.cancel(), done: new Promise((r) => { finish = r; }) };
  const status = vscode.window.setStatusBarMessage('$(sync~spin) TeXmark: building ' + path.basename(uri.fsPath));
  let ok = true, missing = null;
  try {
    for (const step of p.steps) {
      if (cts.token.isCancellationRequested) { ok = false; break; }
      const r = await runStep(step, cts.token);
      if (r.missing) {
        if (step.optional) continue;
        missing = step.cmd; ok = false; break;
      }
      if (r.code !== 0 && !step.optional) { ok = false; if (step.cmd !== 'latexmk' && r.code === null) break; }
    }
  } finally {
    status.dispose();
    running = null;
    cts.dispose();
    finish();
  }

  if (missing) {
    const msg = missing === 'latexmk'
      ? 'latexmk was not found. Install a TeX distribution (TeX Live or MiKTeX), or set "TeXmark: Build Tool" to run the engine directly.'
      : `${missing} was not found. Install a TeX distribution such as TeX Live or MiKTeX to build PDFs.`;
    vscode.window.showErrorMessage(msg, 'Settings').then((pick) => {
      if (pick) vscode.commands.executeCommand('workbench.action.openSettings', 'texmark.build');
    });
    return null;
  }

  // Problems from the log, on the .tmd lines (compact conversion keeps line numbers).
  let problems = [];
  try {
    const logText = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(p.logPath)));
    problems = build.parseLog(logText, path.basename(p.texPath));
  } catch { /* no log */ }
  const doc = open || await vscode.workspace.openTextDocument(uri);
  buildDiags.set(uri, problems.map((pr) => {
    const line = Math.max(0, Math.min(pr.line - 1, doc.lineCount - 1));
    const d = new vscode.Diagnostic(doc.lineAt(line).range, pr.message,
      pr.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
    d.source = 'LaTeX';
    return d;
  }));

  const pdf = vscode.Uri.file(p.pdfPath);
  const errors = problems.filter((x) => x.severity === 'error').length;
  if (!(await exists(pdf))) {
    vscode.window.showErrorMessage(`The build failed${errors ? ' with ' + errors + ' error' + (errors > 1 ? 's' : '') : ''}. See Problems or the TeXmark output.`, 'Show output')
      .then((pick) => { if (pick) output.show(true); });
    return null;
  }
  let finalPdf = pdf;
  if (c.get('build.copyPdfNextToSource', true)) {
    finalPdf = uri.with({ path: uri.path.replace(/\.tmd$/i, '') + '.pdf' });
    try { await vscode.workspace.fs.copy(pdf, finalPdf, { overwrite: true }); } catch (e) {
      log('Could not copy the PDF next to the source (is it open in a PDF viewer that locks it?): ' + e.message);
      finalPdf = pdf;
    }
  }
  if (!ok || errors) {
    vscode.window.showWarningMessage(`Built ${path.basename(finalPdf.path)} with ${errors} error${errors === 1 ? '' : 's'}. See Problems.`, 'Show output', 'View PDF')
      .then((pick) => {
        if (pick === 'Show output') output.show(true);
        if (pick === 'View PDF') viewPdf(uri);
      });
  } else {
    vscode.window.setStatusBarMessage('$(check) TeXmark: built ' + path.basename(finalPdf.path), 4000);
    if (opts.view || (!opts.onSave && c.get('build.openPdf', false))) await viewPdf(uri);
  }
  return finalPdf;
}

async function pdfFor(uri) {
  const next = uri.with({ path: uri.path.replace(/\.tmd$/i, '') + '.pdf' });
  if (await exists(next)) return next;
  const p = build.plan({ tmdPath: uri.fsPath, outDir: cfg().get('build.outDir', '.texmark') });
  const inBuild = vscode.Uri.file(p.pdfPath);
  return (await exists(inBuild)) ? inBuild : null;
}

async function viewPdf(arg) {
  const uri = targetUri(arg);
  if (!uri) return null;
  const pdf = await pdfFor(uri);
  if (!pdf) {
    const pick = await vscode.window.showInformationMessage('There is no PDF yet.', 'Build PDF');
    if (pick) return buildPdf(uri, { view: true });
    return null;
  }
  // A PDF viewer extension (LaTeX Workshop, vscode-pdf …) opens it in a tab; otherwise the system viewer.
  const viewers = ['James-Yu.latex-workshop', 'tomoki1207.pdf', 'mathematic.vscode-pdf', 'analytic-signal.preview-pdf'];
  if (cfg().get('pdf.viewer', 'auto') === 'tab' || (cfg().get('pdf.viewer', 'auto') === 'auto' && viewers.some((id) => vscode.extensions.getExtension(id)))) {
    return vscode.commands.executeCommand('vscode.open', pdf, vscode.ViewColumn.Beside);
  }
  return vscode.env.openExternal(pdf);
}

/** Wraps the selection in `mark` (** or *), or removes it when it is already there. */
async function toggleWrap(mark) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return;
  const doc = ed.document;
  await ed.edit((e) => {
    for (const sel of ed.selections) {
      let range = sel;
      if (sel.isEmpty) range = doc.getWordRangeAtPosition(sel.active) || sel;
      const t = doc.getText(range);
      const startOff = doc.offsetAt(range.start), endOff = doc.offsetAt(range.end);
      const full = doc.getText();
      const n = mark.length;
      const outside = full.slice(startOff - n, startOff) === mark && full.slice(endOff, endOff + n) === mark
        && (n === 2 || (full[startOff - 2] !== '*' && full[endOff + 1] !== '*'));
      if (t.length >= 2 * n && t.startsWith(mark) && t.endsWith(mark) && (n === 2 || !t.startsWith('**'))) {
        e.replace(range, t.slice(n, t.length - n));
      } else if (outside) {
        e.delete(new vscode.Range(doc.positionAt(endOff), doc.positionAt(endOff + n)));
        e.delete(new vscode.Range(doc.positionAt(startOff - n), doc.positionAt(startOff)));
      } else {
        e.replace(range, mark + t + mark);
      }
    }
  });
  // An empty selection with no word: put the cursor between the marks.
  if (ed.selections.length === 1 && ed.selection.isEmpty) {
    const pos = ed.selection.active;
    const doc2 = ed.document;
    const back = doc2.getText(new vscode.Range(pos.translate(0, -Math.min(pos.character, 2 * mark.length)), pos));
    if (back === mark + mark) {
      const p = pos.translate(0, -mark.length);
      ed.selection = new vscode.Selection(p, p);
      // Typing ** goes over the closing marks, and backspace removes both sides.
      pendingClose.set(doc2.uri.toString(), { line: p.line, open: mark, close: mark, full: mark, openEnd: p.character, at: p.character });
    }
  }
}

// ------------------------------------------------------------ auto-closing

const pendingClose = new Map(); // document uri -> { line, ...autoclose pending }
let applying = false;

function autoClosePairs() {
  const pairs = cfg().get('autoClose.pairs', autoclose.DEFAULT_PAIRS) || {};
  const out = {};
  for (const [open, close] of Object.entries(pairs)) if (open && typeof close === 'string' && close) out[open] = close;
  return out;
}

async function onTyped(e) {
  if (applying || !isTmd(e.document) || e.contentChanges.length !== 1) return;
  if (e.reason) { pendingClose.delete(e.document.uri.toString()); return; } // undo or redo
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document !== e.document || ed.selections.length !== 1) return;
  const key = e.document.uri.toString();
  const ch = e.contentChanges[0];
  const lineNo = ch.range.start.line;
  const p = pendingClose.get(key);
  const pending = p && p.line === lineNo ? p : null;
  if (!cfg().get('autoClose.enabled', true)) { pendingClose.delete(key); return; }
  const line = e.document.lineAt(lineNo).text;
  let act = null;
  let col;
  if (ch.rangeLength === 0 && ch.text.length === 1 && ch.text !== '\n') {
    col = ch.range.start.character + 1;
    const typed = ch.text;
    const inMath = typed === '$' ? scan.inMath(e.document.getText(), e.document.offsetAt(ch.range.start)) : false;
    act = autoclose.decide({ line, col, typed, pairs: autoClosePairs(), pending, inMath });
    if (!act && pending) {
      // Typed somewhere else on the line: keep the closer's column right.
      const c = ch.range.start.character;
      if (c <= pending.at) pendingClose.set(key, { ...pending, at: pending.at + 1, openEnd: c < pending.openEnd ? pending.openEnd + 1 : pending.openEnd });
      return;
    }
  } else if (ch.rangeLength === 0 && /^(\(\)|\[\]|\{\})$/.test(ch.text)) {
    // VS Code closed a bracket itself: ( gave (). After a backslash that may be
    // our \( or \[, whose closer then replaces VS Code's.
    col = ch.range.start.character + 1;
    const virtual = line.slice(0, col) + line.slice(col + 1);
    const a = autoclose.decide({ line: virtual, col, typed: ch.text[0], pairs: autoClosePairs(), pending, inMath: false });
    if (!a || a.insert === undefined) return;
    act = { ...a, replaceOne: true };
  } else if (ch.text === '' && ch.rangeLength === 1 && ch.range.isSingleLine) {
    col = ch.range.start.character;
    const d = autoclose.onDelete({ line, col, pending });
    if (d) act = { removeBefore: d.before, removeAfter: d.after, pending: null };
    else if (pending) {
      if (col < pending.at) pendingClose.set(key, { ...pending, at: pending.at - 1, openEnd: col < pending.openEnd ? pending.openEnd - 1 : pending.openEnd });
      else pendingClose.delete(key);
      return;
    }
  } else {
    pendingClose.delete(key);
    return;
  }
  if (!act) return;
  const pos = new vscode.Position(lineNo, col);
  applying = true;
  try {
    await ed.edit((b) => {
      if (act.replaceOne) b.replace(new vscode.Range(pos, pos.translate(0, 1)), act.insert);
      else if (act.insert !== undefined && act.insert) b.insert(pos, act.insert);
      if (act.restore !== undefined && act.restore) b.insert(pos, act.restore);
      if (act.remove) b.delete(new vscode.Range(pos, pos.translate(0, act.remove)));
      if (act.removeAfter) b.delete(new vscode.Range(pos.translate(0, -act.removeBefore), pos.translate(0, act.removeAfter)));
    }, { undoStopBefore: false, undoStopAfter: false });
    const at = act.removeBefore ? pos.translate(0, -act.removeBefore) : pos;
    ed.selection = new vscode.Selection(at, at);
  } finally {
    applying = false;
  }
  if (act.pending) pendingClose.set(key, { line: lineNo, ...act.pending });
  else pendingClose.delete(key);
}

function onSelection(e) {
  const key = e.textEditor.document.uri.toString();
  const p = pendingClose.get(key);
  if (!p || applying) return;
  // The editor's selection now, not the event's: events from our own edits arrive late.
  const sels = e.textEditor.selections;
  const s = sels[0];
  if (sels.length !== 1 || !s.isEmpty || s.active.line !== p.line || s.active.character < p.openEnd || s.active.character > p.at) {
    pendingClose.delete(key);
  }
}

// ------------------------------------------------------------- activate

function activate(context) {
  const sub = (d) => context.subscriptions.push(d);
  sub(lint);
  sub(buildDiags);
  sub(vscode.languages.registerCompletionItemProvider(SELECTOR, completion, '@', '\\', '{', ',', ':'));
  sub(vscode.languages.registerDefinitionProvider(SELECTOR, definition));
  sub(vscode.languages.registerHoverProvider(SELECTOR, hover));
  sub(vscode.languages.registerDocumentSymbolProvider(SELECTOR, symbols, { label: 'TeXmark' }));
  sub(vscode.languages.registerFoldingRangeProvider(SELECTOR, folding));

  sub(vscode.commands.registerCommand('texmark.convertToTex', convertToTex));
  sub(vscode.commands.registerCommand('texmark.build', (u) => buildPdf(u)));
  sub(vscode.commands.registerCommand('texmark.viewPdf', viewPdf));
  sub(vscode.commands.registerCommand('texmark.preview', preview));
  sub(vscode.commands.registerCommand('texmark.toggleBold', () => toggleWrap('**')));
  sub(vscode.commands.registerCommand('texmark.toggleItalic', () => toggleWrap('*')));

  const timers = new Map();
  const later = (doc) => {
    if (!isTmd(doc)) return;
    const k = doc.uri.toString();
    clearTimeout(timers.get(k));
    timers.set(k, setTimeout(() => { timers.delete(k); checkReferences(doc); }, 400));
  };
  sub(vscode.workspace.onDidOpenTextDocument(later));
  sub(vscode.workspace.onDidChangeTextDocument((e) => { later(e.document); onTyped(e); }));
  sub(vscode.window.onDidChangeTextEditorSelection(onSelection));
  sub(vscode.workspace.onDidCloseTextDocument((doc) => { lint.delete(doc.uri); buildDiags.delete(doc.uri); }));
  sub(vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId === 'bibtex' || /\.bib$/i.test(doc.fileName)) {
      for (const d of vscode.workspace.textDocuments) later(d);
    }
    if (isTmd(doc) && cfg().get('build.onSave', false)) buildPdf(doc.uri, { onSave: true });
  }));
  sub(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('texmark.lint')) vscode.workspace.textDocuments.forEach(later);
  }));
  vscode.workspace.textDocuments.forEach(later);

  // TeXglass shows its own preview button on .tmd files; ours only stands in when it is missing.
  const texglass = () => vscode.commands.executeCommand('setContext', 'texmark.texglassInstalled', !!vscode.extensions.getExtension(TEXGLASS_ID));
  texglass();
  sub(vscode.extensions.onDidChange(texglass));
}

function deactivate() {
  if (running) running.cancel();
}

module.exports = { activate, deactivate };

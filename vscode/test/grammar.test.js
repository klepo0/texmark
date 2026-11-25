'use strict';
// Tokenizes .tmd text with the real TextMate engine, the TeXmark grammar and
// VS Code's LaTeX grammars (fetched once from jlelong/vscode-latex-basics, the
// source of VS Code's built-in LaTeX colouring, into test/.cache).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const LATEX_BASICS = 'https://raw.githubusercontent.com/jlelong/vscode-latex-basics/5b0f2805fca2e3e27eb089010af5b6164bd8a8fe/syntaxes/';
const CACHE = path.join(__dirname, '.cache');

async function fetchGrammar(name) {
  const file = path.join(CACHE, name);
  if (!fs.existsSync(file)) {
    const res = await fetch(LATEX_BASICS + name);
    if (!res.ok) throw new Error('fetch ' + name + ': ' + res.status);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, await res.text());
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let grammarPromise;
function grammar() {
  if (grammarPromise) return grammarPromise;
  grammarPromise = (async () => {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer;
    await oniguruma.loadWASM(wasm);
    const files = {
      'text.tex.texmark': JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'syntaxes', 'texmark.tmLanguage.json'), 'utf8')),
      'text.tex.latex': await fetchGrammar('LaTeX.tmLanguage.json'),
      'text.tex': await fetchGrammar('TeX.tmLanguage.json'),
      'source.yaml': { scopeName: 'source.yaml', patterns: [{ match: '^\\s*[\\w-]+(?=:)', name: 'entity.name.tag.yaml' }] },
    };
    const registry = new vsctm.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (p) => new oniguruma.OnigScanner(p),
        createOnigString: (s) => new oniguruma.OnigString(s),
      }),
      loadGrammar: async (scope) => files[scope] || null,
    });
    return registry.loadGrammar('text.tex.texmark');
  })();
  return grammarPromise;
}

/** [[text, scopes]] for every token of every line. */
async function tokens(src) {
  const g = await grammar();
  let state = vsctm.INITIAL;
  const out = [];
  for (const line of src.split('\n')) {
    const r = g.tokenizeLine(line, state);
    for (const t of r.tokens) out.push([line.slice(t.startIndex, t.endIndex), t.scopes.join(' ')]);
    state = r.ruleStack;
  }
  return out;
}

/** The scopes of the first token whose text is `text` (after `after`, if given). */
async function scopeOf(src, text, after) {
  const all = await tokens(src);
  let i = 0;
  if (after) { i = all.findIndex(([t]) => t.includes(after)); assert.ok(i >= 0, 'no token ' + after); }
  const hit = all.slice(i).find(([t]) => t === text || t.trim() === text);
  assert.ok(hit, `no token "${text}" in\n${all.map(([t, s]) => JSON.stringify(t) + '  ' + s).join('\n')}`);
  return hit[1];
}

test('front matter is YAML, only at the top', async () => {
  const src = '---\ntitle: Heat\n---\n\n---';
  assert.match(await scopeOf(src, 'title'), /meta\.embedded\.block\.frontmatter.*entity\.name\.tag\.yaml/);
  const all = await tokens(src);
  assert.match(all[all.length - 1][1], /meta\.separator\.markdown/);
});

test('headings, with labels', async () => {
  const src = '## Main results {#sec:main}';
  assert.match(await scopeOf(src, '##'), /punctuation\.definition\.heading\.markdown/);
  assert.match(await scopeOf(src, 'Main results'), /markup\.heading\.markdown.*entity\.name\.section/);
  assert.match(await scopeOf(src, 'sec:main'), /variable\.parameter\.definition\.label/);
});

test('maths in a heading is maths', async () => {
  assert.match(await scopeOf('# The case $p = 2$', 'p ='), /markup\.heading.*meta\.math\.block/);
});

test('theorem blocks: kind, title, label, closing fence', async () => {
  const src = '::: theorem [Convergence of $u$] {#thm:main}\nText.\n:::';
  assert.match(await scopeOf(src, ':::'), /keyword\.control\.block\.texmark/);
  assert.match(await scopeOf(src, 'theorem'), /entity\.name\.type\.environment/);
  assert.match(await scopeOf(src, 'Convergence of '), /entity\.name\.section\.theorem-title/);
  assert.match(await scopeOf(src, 'u', 'Convergence'), /meta\.math\.block/);
  assert.match(await scopeOf(src, 'thm:main'), /variable\.parameter\.definition\.label/);
  const all = await tokens(src);
  assert.match(all[all.length - 1][1], /keyword\.control\.block\.texmark/);
});

test('inline maths hands over to LaTeX', async () => {
  const src = 'Let $u : M \\to \\R$ be smooth.';
  assert.match(await scopeOf(src, '$'), /punctuation\.definition\.string\.begin\.tex/);
  assert.match(await scopeOf(src, 'to'), /meta\.math\.block\.tex.*constant\.other\.general\.math\.tex/);
  assert.doesNotMatch(await scopeOf(src, ' be smooth.'), /math/);
});

test('a price is not maths', async () => {
  const src = 'It costs $5 and $6 today.';
  for (const [t, s] of await tokens(src)) assert.doesNotMatch(s, /math/, t);
});

test('display maths with a label', async () => {
  const src = 'Then\n$$\n  \\partial_t u = \\Delta u .\n$$ {#eq:heat}\nso';
  assert.match(await scopeOf(src, 'partial'), /meta\.math\.block\.texmark/);
  assert.match(await scopeOf(src, 'eq:heat'), /variable\.parameter\.definition\.label/);
  assert.doesNotMatch(await scopeOf(src, 'so'), /math/);
});

test('emphasis, bold, code', async () => {
  const src = 'A *heat equation* and **mean** with `x_1` and snake_case_name.';
  assert.match(await scopeOf(src, 'heat equation'), /markup\.italic\.markdown/);
  assert.match(await scopeOf(src, 'mean'), /markup\.bold\.markdown/);
  assert.match(await scopeOf(src, 'x_1'), /markup\.inline\.raw/);
  for (const [t, s] of await tokens(src)) if (/snake/.test(t)) assert.doesNotMatch(s, /italic/);
});

test('a star in maths is not emphasis', async () => {
  for (const [t, s] of await tokens('Take $a * b$ and $c*d$ here.')) {
    if (t.includes('here')) assert.doesNotMatch(s, /italic/);
  }
});

test('references and citations', async () => {
  const src = 'By @thm:main and [@evans2010, Ch. 7; @lax].';
  assert.match(await scopeOf(src, 'thm:main'), /constant\.other\.reference\.label/);
  assert.match(await scopeOf(src, 'evans2010'), /meta\.citation\.texmark.*constant\.other\.reference\.citation/);
  assert.match(await scopeOf(src, 'lax'), /constant\.other\.reference\.citation/);
  // An e-mail address is not a reference.
  for (const [t, s] of await tokens('Write to a@b.org')) assert.doesNotMatch(s, /reference/, t);
});

test('links, figures, footnotes', async () => {
  assert.match(await scopeOf('See [the code](https://x.org/a).', 'https://x.org/a'), /markup\.underline\.link/);
  assert.match(await scopeOf('See [above](#thm:main).', 'thm:main'), /constant\.other\.reference\.label/);
  const fig = '![A plot of $u$](plot.pdf){#fig:plot width=60%}';
  assert.match(await scopeOf(fig, 'plot.pdf'), /markup\.underline\.link\.image/);
  assert.match(await scopeOf(fig, 'fig:plot'), /variable\.parameter\.definition\.label/);
  assert.match(await scopeOf('Sharp.^[Take $\\lambda_1$.]', 'Take '), /meta\.footnote/);
});

test('lists and quotes', async () => {
  assert.match(await scopeOf('- one\n  1. two', '-'), /punctuation\.definition\.list\.begin\.markdown/);
  assert.match(await scopeOf('- one\n  1. two', '1.'), /punctuation\.definition\.list\.begin\.markdown/);
  assert.match(await scopeOf('> quoted', '>'), /punctuation\.definition\.quote/);
});

test('comments, but not 50%', async () => {
  assert.match(await scopeOf('Text % a note', 'a note'), /comment\.line\.percentage/);
  for (const [t, s] of await tokens('About 50% of it')) assert.doesNotMatch(s, /comment/, t);
});

test('raw LaTeX environments are LaTeX; Markdown inside prose environments still works', async () => {
  const src = '\\begin{align}\n  a &= *b* \\label{eq:x}\n\\end{align}\n\\begin{center}\nA *word*.\n\\end{center}';
  const all = await tokens(src);
  const star = all.find(([t]) => t.includes('*b*') || t === 'b');
  assert.ok(star && !/italic/.test(star[1]), 'no emphasis inside align');
  assert.match(await scopeOf(src, 'word'), /markup\.italic\.markdown/);
});

test('fenced code is raw', async () => {
  const src = '```\n$x$ *y*\n```\nafter *z*';
  assert.match(await scopeOf(src, '$x$ *y*'), /markup\.raw\.block/);
  assert.match(await scopeOf(src, 'z'), /markup\.italic/);
});

test('the example file tokenizes without leaking state', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'examples', 'heat.tmd'), 'utf8');
  const all = await tokens(src);
  const last = all.filter(([t]) => t.trim()).pop();
  assert.doesNotMatch(last[1], /math|italic|bold|raw|frontmatter/, 'state leaked to the end: ' + last[1]);
});

test('the grammar file is up to date with scripts/build-grammar.js', () => {
  const { text, OUT } = require('../scripts/build-grammar.js');
  assert.strictEqual(fs.readFileSync(OUT, 'utf8'), text, 'run: node scripts/build-grammar.js');
});

test('prose environments match the converter', () => {
  const { PROSE_ENVS } = require('../scripts/build-grammar.js');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'texmark.js'), 'utf8');
  const block = /const PROSE_ENVS = new Set\(\[([\s\S]*?)\.\.\.Object\.keys\(KINDS\)/.exec(src)[1];
  const names = block.match(/'([^']+)'/g).map((s) => s.slice(1, -1)).filter((n) => !['em', 'bfseries', 'itshape'].includes(n));
  for (const n of names) assert.ok(PROSE_ENVS.includes(n), n + ' is prose in texmark.js but not in the grammar');
});

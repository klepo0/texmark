'use strict';
const test = require('node:test');
const assert = require('node:assert');
const scan = require('../lib/scan.js');

const DOC = String.raw`---
title: Heat flow
bib: refs.bib
macros: [defs.tex]
---

\newcommand{\R}{\mathbb{R}}
\newcommand\norm[1]{\lVert #1 \rVert}
\DeclareMathOperator{\vol}{vol}
\def\eps{\varepsilon}
% \newcommand{\hidden}{no}

# Introduction {#sec:intro}

$$
  \partial_t u = \Delta u .
$$ {#eq:heat}

::: theorem [Convergence] {#thm:main}
If $M$ is compact, then $u(t) \to \bar u$.
:::

::: proof
By @eq:heat and [@evans2010, Ch. 7].
\begin{align}
  a &= b \label{eq:rate}
\end{align}
:::

## A picture {-}

![A plot](plot.pdf){#fig:plot width=60%}

::: {#lem:pandoc .lemma}
Text.
:::

` + '```\n{#not:a-label}\n```\n';

test('labels: kind, title and line', () => {
  const ls = scan.labels(DOC);
  const by = Object.fromEntries(ls.map((l) => [l.name, l]));
  assert.deepStrictEqual(ls.map((l) => l.name), ['sec:intro', 'eq:heat', 'thm:main', 'eq:rate', 'fig:plot', 'lem:pandoc']);
  assert.strictEqual(by['sec:intro'].kind, 'section');
  assert.strictEqual(by['sec:intro'].title, 'Introduction');
  assert.strictEqual(by['eq:heat'].kind, 'equation');
  assert.strictEqual(by['thm:main'].kindName, 'Theorem');
  assert.strictEqual(by['thm:main'].title, 'Convergence');
  assert.strictEqual(by['thm:main'].line, 18);
  assert.strictEqual(by['eq:rate'].kind, 'equation');
  assert.strictEqual(by['fig:plot'].kind, 'figure');
  assert.strictEqual(by['lem:pandoc'].kindName, 'Lemma');
});

test('macros, with arguments and definitions; comments skipped', () => {
  const ms = scan.macros(DOC);
  const by = Object.fromEntries(ms.map((m) => [m.name, m]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['R', 'eps', 'norm', 'vol']);
  assert.strictEqual(by.R.definition, '\\mathbb{R}');
  assert.strictEqual(by.norm.args, 1);
  assert.strictEqual(by.vol.definition, '\\operatorname{vol}');
  assert.strictEqual(by.eps.definition, '\\varepsilon');
  assert.strictEqual(by.R.line, 6);
});

test('macros: \\NewDocumentCommand, \\DeclarePairedDelimiter, \\renewcommand*', () => {
  const ms = scan.macros('\\NewDocumentCommand{\\pair}{m m}{(#1,#2)}\n\\DeclarePairedDelimiter\\abs{\\lvert}{\\rvert}\n\\renewcommand*{\\x}[2][a]{#1#2}');
  const by = Object.fromEntries(ms.map((m) => [m.name, m]));
  assert.strictEqual(by.pair.args, 2);
  assert.strictEqual(by.abs.args, 1);
  assert.strictEqual(by.x.args, 2);
});

test('bib and macro files from front matter and commands', () => {
  assert.deepStrictEqual(scan.bibFiles(DOC), ['refs.bib']);
  assert.deepStrictEqual(scan.bibFiles('x\n\\bibliography{a,b}\n'), ['a.bib', 'b.bib']);
  assert.deepStrictEqual(scan.macroFiles(DOC), ['defs.tex']);
  assert.deepStrictEqual(scan.macroFiles('\\input{notation}\n\\usepackage{mymacros}'), ['notation.tex', 'mymacros.sty']);
});

test('parseBib: keys, fields, nested braces, quotes; @string and @comment skipped', () => {
  const bib = `@string{ams = "AMS"}
@comment{ignore me}
@book{evans2010,
  author = {Evans, Lawrence C.},
  title = {Partial Differential Equations},
  publisher = ams,
  year = 2010,
}
@article{doe-roe:2020, title = "On {T}oy {S}urfaces", author = {Doe, J. and Roe, R. and Poe, P.}, year = {2020}}
`;
  const es = scan.parseBib(bib);
  assert.deepStrictEqual(es.map((e) => e.key), ['evans2010', 'doe-roe:2020']);
  assert.strictEqual(es[0].title, 'Partial Differential Equations');
  assert.strictEqual(es[0].year, '2010');
  assert.strictEqual(es[1].title, 'On Toy Surfaces');
  assert.strictEqual(scan.shortAuthors(es[0].author), 'Evans');
  assert.strictEqual(scan.shortAuthors(es[1].author), 'Doe et al.');
  assert.strictEqual(scan.shortAuthors('Jane Doe and Richard Roe'), 'Doe and Roe');
});

test('outline: sections nest, blocks inside sections, ranges end where they should', () => {
  const o = scan.outline(DOC);
  assert.strictEqual(o.length, 1);
  const intro = o[0];
  assert.strictEqual(intro.name, 'Introduction');
  assert.strictEqual(intro.detail, 'sec:intro');
  assert.deepStrictEqual(intro.children.map((c) => c.name), ['Theorem (Convergence)', 'Proof', 'A picture']);
  const thm = intro.children[0];
  assert.strictEqual(thm.detail, 'thm:main');
  assert.strictEqual(thm.endLine, 20);
  const pic = intro.children[2];
  assert.strictEqual(pic.level, 2);
  assert.deepStrictEqual(pic.children.map((c) => c.name), ['Lemma']);
  assert.ok(intro.endLine >= pic.endLine);
});

test('outline: a # inside a block is not a heading, and fences close nested blocks', () => {
  const o = scan.outline('# A\n::: theorem\n::: proof\nx\n:::\n# not a heading? it is text in a block\n:::\n# B\n');
  assert.deepStrictEqual(o.map((n) => n.name), ['A', 'B']);
  assert.deepStrictEqual(o[0].children.map((n) => n.name), ['Theorem']);
  assert.deepStrictEqual(o[0].children[0].children.map((n) => n.name), ['Proof']);
  assert.strictEqual(o[0].children[0].endLine, 6);
});

test('completion context', () => {
  const c = (s, o) => scan.completionContext(s, o);
  assert.deepStrictEqual(c('By @thm:m'), { type: 'label', prefix: 'thm:m', start: 4 });
  assert.deepStrictEqual(c('By @'), { type: 'label', prefix: '', start: 4 });
  assert.strictEqual(c('mail a@b'), null);
  assert.deepStrictEqual(c('as in [@ev'), { type: 'cite', prefix: 'ev', start: 8 });
  assert.deepStrictEqual(c('as in [see @a, p. 3; @b'), { type: 'cite', prefix: 'b', start: 22 });
  assert.deepStrictEqual(c('\\cite{a,'), { type: 'cite', prefix: '', start: 8 });
  assert.deepStrictEqual(c('\\citep[p.~3]{ev'), { type: 'cite', prefix: 'ev', start: 13 });
  assert.deepStrictEqual(c('\\cref{thm'), { type: 'label', prefix: 'thm', start: 6 });
  assert.deepStrictEqual(c('\\eqref{'), { type: 'label', prefix: '', start: 7 });
  assert.deepStrictEqual(c('$\\fr'), { type: 'command', prefix: 'fr', start: 1 });
  assert.deepStrictEqual(c('\\begin{al'), { type: 'env', prefix: 'al', start: 7 });
  assert.deepStrictEqual(c('::: th'), { type: 'block', prefix: 'th', start: 4 });
  assert.deepStrictEqual(c('tit', { inFrontMatter: true }), { type: 'front', prefix: 'tit', start: 0 });
  assert.strictEqual(c('title: x', { inFrontMatter: true }), null);
  assert.strictEqual(c('line break \\\\'), null);
});

test('inMath', () => {
  const s = 'Let $x + \\alpha$ and $$ y \\beta $$ then \\[ z \\] and costs $ 5.';
  assert.strictEqual(scan.inMath(s, s.indexOf('\\alpha') + 2), true);
  assert.strictEqual(scan.inMath(s, s.indexOf(' and')), false);
  assert.strictEqual(scan.inMath(s, s.indexOf('\\beta')), true);
  assert.strictEqual(scan.inMath(s, s.indexOf('then')), false);
  assert.strictEqual(scan.inMath(s, s.indexOf('z')), true);
  assert.strictEqual(scan.inMath(s, s.length), false);
});

test('kind names and aliases', () => {
  assert.strictEqual(scan.kindName('thm'), 'Theorem');
  assert.strictEqual(scan.kindName('theorem*'), 'Theorem');
  assert.strictEqual(scan.kindName('center'), 'Center');
});

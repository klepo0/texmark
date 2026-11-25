'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const build = require('../lib/build.js');

test('plan: latexmk from the .tmd folder into the build folder', () => {
  const tmd = path.resolve('/work/paper/heat.tmd');
  const p = build.plan({ tmdPath: tmd, tool: 'latexmk', engine: 'xelatex' });
  assert.strictEqual(p.cwd, path.dirname(tmd));
  assert.strictEqual(p.texPath, path.join(path.dirname(tmd), '.texmark', 'heat.tex'));
  assert.strictEqual(p.pdfPath, path.join(path.dirname(tmd), '.texmark', 'heat.pdf'));
  assert.strictEqual(p.steps.length, 1);
  assert.strictEqual(p.steps[0].cmd, 'latexmk');
  assert.ok(p.steps[0].args.includes('-xelatex'));
  assert.ok(p.steps[0].args.includes('-file-line-error'));
  assert.strictEqual(p.steps[0].args[p.steps[0].args.length - 1], path.join('.texmark', 'heat.tex'));
  assert.ok(p.steps[0].args.includes('-outdir=.texmark'));
  const abs = build.plan({ tmdPath: tmd, outDir: path.resolve('/elsewhere/build') });
  assert.ok(abs.steps[0].args.includes('-outdir=' + path.resolve('/elsewhere/build')));
});

test('plan: engine, bibtex, engine twice', () => {
  const p = build.plan({ tmdPath: path.resolve('/w/a.tmd'), outDir: 'out', tool: 'engine', hasBib: true });
  assert.deepStrictEqual(p.steps.map((s) => s.cmd), ['pdflatex', 'bibtex', 'pdflatex', 'pdflatex']);
  assert.strictEqual(p.steps[1].cwd, path.resolve('/w/out'));
  assert.ok(p.steps[1].env.BIBINPUTS.startsWith(path.resolve('/w')));
  const q = build.plan({ tmdPath: path.resolve('/w/a.tmd'), tool: 'engine', hasBib: false });
  assert.deepStrictEqual(q.steps.map((s) => s.cmd), ['pdflatex', 'pdflatex', 'pdflatex']);
});

test('parseLog: file-line errors, classic errors, warnings on input lines', () => {
  const log = String.raw`This is pdfTeX
(./.texmark/heat.tex
./.texmark/heat.tex:23: Undefined control sequence.
l.23 Let $u \foo
                 = 1$
! Missing $ inserted.
<inserted text>
                $
l.31 $x^2

LaTeX Warning: Reference ` + "`" + String.raw`thm:nope' on page 1 undefined on input line 40.

Package natbib Warning: Citation ` + "`" + String.raw`x' on page 2 undefined on input
(natbib)                line 44.

./.texmark/other.tex:5: Something else.
)`;
  const ps = build.parseLog(log, 'heat.tex');
  assert.deepStrictEqual(ps, [
    { line: 23, message: 'Undefined control sequence. \\foo', severity: 'error' },
    { line: 31, message: 'Missing $ inserted.', severity: 'error' },
    { line: 40, message: "Reference `thm:nope' on page 1 undefined.", severity: 'warning' },
    { line: 44, message: "Citation `x' on page 2 undefined.", severity: 'warning' },
  ]);
});

test('parseLog: Windows paths', () => {
  const ps = build.parseLog('C:\\Users\\k\\p\\.texmark\\heat.tex:7: Undefined control sequence.\n', 'heat.tex');
  assert.deepStrictEqual(ps.map((p) => p.line), [7]);
});

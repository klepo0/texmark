// Runs inside VS Code (see run.js): the extension against a copy of examples/heat.tmd.
const vscode = require('vscode');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const WS = process.env.TEXMARK_TEST_WS;
async function check(name, fn) {
  try { await fn(); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
exports.run = async function () {
  const file = path.join(WS, 'heat.tmd');
  const doc = await vscode.workspace.openTextDocument(file);
  const ed = await vscode.window.showTextDocument(doc);
  await sleep(1500);
  const text = doc.getText();
  const pos = (needle, extra = 0) => doc.positionAt(text.indexOf(needle) + extra);
  await check('language id', () => assert.strictEqual(doc.languageId, 'texmark'));
  await check('extension active', () => assert.ok(vscode.extensions.getExtension('klepo1.texmark').isActive));
  const labels = async (p, trig) => (await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, p, trig)).items.map((i) => typeof i.label === 'string' ? i.label : i.label.label);
  await check('@ completes labels', async () => {
    const ls = await labels(pos('@eq:heat by', 1), '@');
    for (const k of ['thm:main', 'eq:heat', 'sec:intro', 'eq:rate']) assert.ok(ls.includes(k), k + ' in ' + ls.slice(0, 20));
  });
  await check('[@ completes bib keys', async () => {
    const ls = await labels(pos('@evans2010', 1), '@');
    assert.ok(ls.includes('evans2010'), ls.slice(0, 30).join(','));
  });
  await check('backslash completes own macros and LaTeX', async () => {
    const ls = await labels(pos('\\R$', 1), '\\');
    for (const k of ['\\R', '\\vol', '\\frac', '\\alpha']) assert.ok(ls.includes(k), k);
  });
  await check('snippets present', async () => {
    const ls = await labels(new vscode.Position(doc.lineCount - 1, 0));
    assert.ok(ls.includes('thm'), 'thm snippet: ' + ls.length);
  });
  await check('::: and \\begin{ complete kinds and environments', async () => {
    const line = doc.lineCount - 1;
    await ed.edit((e) => e.insert(new vscode.Position(line, 0), '::: le\n\\begin{al\n'));
    const kinds = await labels(new vscode.Position(line, 6), ':');
    assert.ok(kinds.includes('lemma'), kinds.join(','));
    const envs = await labels(new vscode.Position(line + 1, 9), '{');
    assert.ok(envs.includes('align'), envs.join(','));
    await ed.edit((e) => e.delete(new vscode.Range(line, 0, line + 2, 0)));
  });
  await check('hover on @thm:main', async () => {
    const hs = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos('@thm:main', 3));
    const md = hs.map((h) => h.contents.map((c) => c.value || c).join('\n')).join('\n');
    assert.match(md, /Theorem/);
  });
  await check('hover on citation', async () => {
    const hs = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos('@evans2010', 3));
    const md = hs.map((h) => h.contents.map((c) => c.value || c).join('\n')).join('\n');
    assert.match(md, /Evans/);
  });
  await check('go to definition of @eq:heat', async () => {
    const ds = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, pos('@eq:heat', 3));
    const line = (ds[0].range || ds[0].targetRange).start.line;
    assert.strictEqual(line, doc.positionAt(text.indexOf('{#eq:heat}')).line);
  });
  await check('outline', async () => {
    const ss = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri);
    const names = ss.map((s) => s.name);
    assert.deepStrictEqual(names, ['Introduction', 'A picture']);
    assert.deepStrictEqual(ss[0].children.map((s) => s.name), ['Theorem (Convergence)', 'Proof', 'Remark']);
  });
  await check('folding', async () => {
    const fs_ = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', doc.uri);
    assert.ok(fs_.length >= 4, String(fs_.length));
  });
  await check('missing reference warned', async () => {
    await ed.edit((e) => e.insert(new vscode.Position(doc.lineCount - 1, 0), 'See @thm:nope and [@nokey].\n'));
    await sleep(1200);
    const ds = vscode.languages.getDiagnostics(doc.uri).map((d) => d.message);
    assert.ok(ds.some((m) => /thm:nope/.test(m)), ds.join('|'));
    assert.ok(ds.some((m) => /nokey/.test(m)), ds.join('|'));
    assert.ok(!ds.some((m) => /thm:main|evans/.test(m)), ds.join('|'));
    await vscode.commands.executeCommand('undo');
  });
  await check('toggle bold', async () => {
    const line = doc.lineCount - 1;
    await ed.edit((e) => e.insert(new vscode.Position(line, 0), 'word\n'));
    ed.selection = new vscode.Selection(line, 0, line, 4);
    await vscode.commands.executeCommand('texmark.toggleBold');
    assert.strictEqual(doc.lineAt(line).text, '**word**');
    ed.selection = new vscode.Selection(line, 2, line, 6);
    await vscode.commands.executeCommand('texmark.toggleBold');
    assert.strictEqual(doc.lineAt(line).text, 'word');
    await vscode.commands.executeCommand('texmark.toggleItalic');
    assert.strictEqual(doc.lineAt(line).text, '*word*');
    await ed.edit((e) => e.delete(doc.lineAt(line).rangeIncludingLineBreak));
  });
  await check('convert to .tex', async () => {
    const tex = path.join(WS, 'heat.tex');
    try { fs.unlinkSync(tex); } catch {}
    await doc.save();
    const p = vscode.commands.executeCommand('texmark.convertToTex', doc.uri);
    for (let i = 0; i < 20 && !fs.existsSync(tex); i++) await sleep(200);
    assert.ok(fs.existsSync(tex));
    assert.match(fs.readFileSync(tex, 'utf8'), /\\begin\{theorem\}\[Convergence\]\\label\{thm:main\}/);
  });
  const hasTeX = require('child_process').spawnSync('latexmk', ['-v']).status === 0;
  if (hasTeX) {
    await check('build PDF', async () => {
      const pdf = await vscode.commands.executeCommand('texmark.build', doc.uri);
      assert.ok(pdf && fs.existsSync(pdf.fsPath), 'pdf ' + (pdf && pdf.fsPath));
      assert.ok(fs.existsSync(path.join(WS, 'heat.pdf')));
    });
    await check('build errors land on .tmd lines', async () => {
      const bad = path.join(WS, 'bad.tmd');
      fs.writeFileSync(bad, '# Intro\n\nOne line.\n\nThen $\\undefinedmacro x$ here.\n');
      const d2 = await vscode.workspace.openTextDocument(bad);
      await vscode.window.showTextDocument(d2);
      await vscode.commands.executeCommand('texmark.build', d2.uri);
      const ds = vscode.languages.getDiagnostics(d2.uri).filter((d) => d.source === 'LaTeX');
      assert.ok(ds.length, 'no diagnostics');
      assert.strictEqual(ds[0].range.start.line, 4, ds.map((d) => d.range.start.line + ':' + d.message).join('|'));
      assert.match(ds[0].message, /undefinedmacro/);
    });
  } else results.push('SKIP build (no latexmk)');
  fs.writeFileSync(path.join(WS, 'results.txt'), results.join('\n') + '\n');
};

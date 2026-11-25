#!/usr/bin/env node
'use strict';
// Starts VS Code with the extension and runs suite.js in it:
//   npm run test:vscode          (on Linux without a display: xvfb-run -a npm run test:vscode)
// Downloads VS Code into .vscode-test the first time. The build checks run
// when latexmk is installed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

(async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'texmark-ws-'));
  for (const f of ['heat.tmd', 'refs.bib']) fs.copyFileSync(path.join(__dirname, '..', '..', '..', 'examples', f), path.join(ws, f));
  try {
    await runTests({
      extensionDevelopmentPath: path.join(__dirname, '..', '..'),
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      extensionTestsEnv: { TEXMARK_TEST_WS: ws },
      launchArgs: [ws, '--disable-extensions', '--no-sandbox', '--disable-gpu', '--disable-workspace-trust'],
    });
  } catch (e) {
    console.error('VS Code tests failed:', e.message || e);
    process.exitCode = 1;
  }
  const results = path.join(ws, 'results.txt');
  // The extension host's console does not reach this terminal; the suite writes its results here.
  if (fs.existsSync(results)) {
    const text = fs.readFileSync(results, 'utf8');
    console.log(text);
    if (/^FAIL/m.test(text)) process.exitCode = 1;
  } else {
    console.error('The suite wrote no results.');
    process.exitCode = 1;
  }
})();

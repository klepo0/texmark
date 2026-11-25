#!/usr/bin/env node
/*
 * Packages a dev build without touching the version:
 *
 *   npm run package:dev      (inside vscode/)
 *
 * writes texmark-<version>-dev.<commit>.vsix, so a test build can't be
 * mistaken for (or overwrite) a released .vsix of the same version.
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');

const dir = path.join(__dirname, '..');
const { version } = require('../package.json');
let commit = 'local';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {}
const out = `texmark-${version}-dev.${commit}.vsix`;
execSync(`npx vsce package -o ${out}`, { cwd: dir, stdio: 'inherit' });
console.log('Dev build:', out);

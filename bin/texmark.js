#!/usr/bin/env node
'use strict';
// texmark paper.tmd            writes paper.tex next to it
// texmark paper.tmd -o out.tex writes out.tex ("-o -" prints to the terminal)
// texmark --body paper.tmd     only the converted body, line for line
const fs = require('fs');
const path = require('path');
const TeXmark = require('../texmark.js');

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) {
  console.log('Usage: texmark <file.tmd> [-o <file.tex> | -o -] [--body]\n' +
    'Converts a TeXmark file (Markdown that is secretly LaTeX) into a LaTeX document.');
  process.exit(args.length ? 0 : 1);
}
if (args.includes('-v') || args.includes('--version')) { console.log(TeXmark.VERSION); process.exit(0); }

let out = null;
let bodyOnly = false;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o' || args[i] === '--output') out = args[++i];
  else if (args[i] === '--body') bodyOnly = true;
  else files.push(args[i]);
}
if (files.length !== 1) { console.error('texmark: give exactly one input file'); process.exit(1); }

const input = files[0];
const src = input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input, 'utf8');
const result = TeXmark.convert(src);
const text = bodyOnly ? result.body + '\n' : result.latex;
if (out === '-' || (input === '-' && !out)) process.stdout.write(text);
else {
  const dest = out || input.replace(/\.tmd$/i, '') + '.tex';
  fs.writeFileSync(dest, text);
  console.error(`texmark: wrote ${path.relative(process.cwd(), dest) || dest}`);
}

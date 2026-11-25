#!/usr/bin/env node
'use strict';
// The extension ships its own copy of the converter (../texmark.js), so the
// .vsix works on its own. Run before packaging and testing.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', '..', 'texmark.js');
const to = path.join(__dirname, '..', 'lib', 'texmark.js');
fs.copyFileSync(from, to);
console.log('copied texmark.js into lib/');

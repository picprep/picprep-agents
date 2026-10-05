'use strict';
// Copies the skills from a checkout of the app (test/lib/app-src.js says where one is looked for) over the copies
// here, while the app repo still holds the originals. test/plugin.js fails when the two differ.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = require('../test/lib/app-src').appSrc();
const src = app && path.join(app, 'skills');
if (!src || !fs.existsSync(src)) { console.error('no checkout of the app with skills/ beside this repo (set PICPREP_SRC to it)'); process.exit(1); }
const dest = path.join(root, 'skills');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('copied ' + fs.readdirSync(dest).join(', ') + ' from ' + src);

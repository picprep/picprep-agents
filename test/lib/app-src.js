'use strict';
// Where a checkout of the PicPrep app is, when there is one beside this repo: some checks compare this repo
// with the app itself (its user folder, its skills, its tools). PICPREP_SRC names it; else a folder called
// picprep next to this one, or the older name photoprep. Null when there is none (CI, and anyone without the app's
// source): those checks then say they were skipped and the rest still run.
const fs = require('fs');
const path = require('path');

function appSrc() {
  const root = path.join(__dirname, '..', '..');
  const given = process.env.PICPREP_SRC || process.env.PHOTOPREP_SRC;   // PHOTOPREP_SRC: the older name
  const tries = given ? [path.resolve(given)] : [path.join(root, '..', 'picprep'), path.join(root, '..', 'photoprep')];   // photoprep: the older folder name
  return tries.find(d => fs.existsSync(path.join(d, 'src', 'mcp.js'))) || null;
}

module.exports = { appSrc };

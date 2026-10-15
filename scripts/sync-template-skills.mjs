// Copies the stage skills into the assistant template, so an AI connected only through the connector has them.
// skills/ is the single source; run this after changing a stage skill (test/template.js fails when they differ).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = ['select', 'sort', 'compose', 'watermark', 'export'].map(n => 'picprep-' + n);
// Each skill is shipped once, in .agents/skills; PicPrep links .claude/skills to it when it makes an assistant.
for (const s of STAGE) {
  const from = path.join(root, 'skills', s), to = path.join(root, 'template', '.agents/skills', s);
  if (!fs.existsSync(from)) throw new Error('missing stage skill ' + from);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}
console.log('stage skills copied into template/.agents/skills');

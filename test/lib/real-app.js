'use strict';
// The real PicPrep server from an app checkout, with no window, for test/parity.js:
//   node real-app.js <app checkout> <licensed|unlicensed>
// It runs in its own process with a throwaway PICPREP_HOME (the caller sets it), never reaches the licence
// service (no weekly check, and its address points at a closed local port), and prints READY when it serves.
// It ends when its stdin closes, so it never outlives the test that started it, however that test ended.
const path = require('path');

const [src, licence] = process.argv.slice(2);
if (!src || !process.env.PICPREP_HOME) { process.stderr.write('real-app: needs <app checkout> and PICPREP_HOME\n'); process.exit(2); }
if (licence === 'licensed') require(path.join(src, 'test', 'lib', 'fake-license')).seedLicense(process.env.PICPREP_HOME);
process.stdin.on('end', () => process.exit(0)).on('error', () => process.exit(0)).resume();
const { createServer } = require(path.join(src, 'src', 'server'));
createServer({ idleMs: 0, licenseWeekly: false }).listen(0).then(() => process.stdout.write('READY\n'), e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });

#!/usr/bin/env node
'use strict';
// The command an assistant's MCP settings run: `npx -y picprep-mcp`.
const bridge = require('../bridge');

const arg = process.argv[2];
if (!arg) {
  bridge.run().then(() => process.exit(0));
} else if (arg === '--check') {
  bridge.check().then(code => process.exit(code), e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
} else if (arg === '--version') {
  process.stdout.write(bridge.VERSION + '\n');
} else if (arg === '--help') {
  process.stdout.write([
    'picprep-mcp ' + bridge.VERSION + ': connects an assistant to the PicPrep app on this computer.',
    '',
    '  picprep-mcp            serve MCP over stdio (what an assistant runs)',
    '  picprep-mcp --check    say whether PicPrep is found and running',
    '  picprep-mcp --version',
    '',
    'PICPREP_APP=<path>   the app to start, when it is not where the installer puts it',
    'PICPREP_HOME=<dir>   the app\'s state folder, when the app runs with a different one',
    '',
  ].join('\n'));
} else {
  process.stderr.write('picprep-mcp: unknown option ' + arg + ' (see --help)\n');
  process.exit(2);
}

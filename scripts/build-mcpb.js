'use strict';
// Builds dist/picprep.mcpb, the one-click Claude Desktop bundle: a zip of mcpb/manifest.json, the
// icon, and the picprep-mcp bridge as server/. `node scripts/build-mcpb.js [out]`.
//
// The zip is written here rather than with a zip tool or package (no dependencies, and Windows has no
// `zip`). Entries are stored, not compressed: the bundle is small, and a stored zip is a few lines.
// Dates are fixed, so the same sources always give the same bytes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const pkgDir = path.join(root, 'packages', 'picprep-mcp');

// The files of the bundle: [path inside the zip, contents].
function entries() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mcpb', 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('mcpb/manifest.json is version ' + manifest.version + ' but picprep-mcp is ' + pkg.version + ': bump them together');
  return [
    ['manifest.json', fs.readFileSync(path.join(root, 'mcpb', 'manifest.json'))],
    ['icon.png', fs.readFileSync(path.join(root, 'mcpb', 'icon.png'))],
    ['server/index.js', Buffer.from("'use strict';\n// Claude Desktop runs this (mcpb/manifest.json): the picprep-mcp bridge over stdio.\nrequire('./bridge').run().then(() => process.exit(0));\n")],
    ['server/bridge.js', fs.readFileSync(path.join(pkgDir, 'bridge.js'))],
    ['server/package.json', fs.readFileSync(path.join(pkgDir, 'package.json'))],
    ['server/LICENSE', fs.readFileSync(path.join(root, 'LICENSE'))],
  ];
}

function zip(files) {
  const DOS_TIME = 0, DOS_DATE = (1980 - 1980) << 9 | 1 << 5 | 1;   // 1980-01-01 00:00
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'utf8'), crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);   // UTF-8 names
    local.writeUInt16LE(0, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6);   // made by Unix, so modes apply
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += local.length + n.length + data.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function build(out = path.join(root, 'dist', 'picprep.mcpb')) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zip(entries()));
  return out;
}

module.exports = { build, entries };

if (require.main === module) {
  const out = build(process.argv[2] && path.resolve(process.argv[2]));
  console.log('built ' + path.relative(process.cwd(), out));
}

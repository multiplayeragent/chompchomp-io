// Bundles the authoritative room logic: powerups.js + sim.js + server/logic.js -> dist/server.js.
// The room runtime has no imports, so the shared game rules are concatenated in.
// Usage: node build.js
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const src = [
  'var window = globalThis;',
  read('powerups.js'),
  read('sim.js'),
  read('server/logic.js'),
].join('\n;\n');

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/server.js'), src);
console.log(`dist/server.js: ${(src.length / 1024).toFixed(1)} KB`);

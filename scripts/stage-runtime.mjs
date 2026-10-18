// Copies the Node binary that will run the sidecar services into resources/.
// electron-builder ships this folder so a friend's machine does not need Node.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const destDir = path.resolve(here, '../resources/runtime');
const exe = process.platform === 'win32' ? 'node.exe' : 'node';
const dest = path.join(destDir, exe);

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(process.execPath, dest);
if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
console.log(`stage-runtime: ${process.execPath} -> ${dest}`);

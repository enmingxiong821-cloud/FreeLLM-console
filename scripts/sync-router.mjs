// Keeps the packaged router in sync. The desktop repository ships its own copy
// so a standalone clone builds without the surrounding workspace.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const local = path.resolve(here, '../task-router.js');
const upstream = path.resolve(here, '../../router-task-router.js');
const src = fs.existsSync(local) ? local : upstream;
const dest = path.resolve(here, '../resources/task-router.cjs');

if (!fs.existsSync(src)) {
  console.error('sync-router: task-router.js not found');
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`sync-router: ${src} -> ${dest}`);

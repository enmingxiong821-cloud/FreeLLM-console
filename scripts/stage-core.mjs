// Stages a runnable FreeLLMAPI core next to the desktop app. The allowlist is
// deliberate: keys, databases, logs and personal credentials never leave the
// source machine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyCoreSanitized } from './core-copy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..');
const source = process.env.FREELLM_CORE_SOURCE || path.join(repo, 'freellmapi');
const dest = path.join(desktop, 'resources', 'core');

if (!fs.existsSync(path.join(source, 'server', 'dist', 'index.js'))) {
  console.error(`stage-core: ${source} has no built server/dist/index.js`);
  process.exit(1);
}

copyCoreSanitized(source, dest);

const notices = path.join(desktop, 'THIRD_PARTY_NOTICES.md');
if (fs.existsSync(notices)) fs.copyFileSync(notices, path.join(dest, 'THIRD_PARTY_NOTICES.md'));

console.log('stage-core: wrote sanitized core (keys/admin/data removed)');

console.log(`stage-core: staged ${source} -> ${dest}`);

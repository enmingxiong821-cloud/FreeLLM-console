// Builds the sanitized core that electron-builder ships as extraResources.
// Keeping it in build/ means a release can never pick up the developer's
// resources/core keys or database by accident.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyCoreSanitized, findReleaseLeaks } from './core-copy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const source = path.join(desktop, 'resources', 'core');
const target = path.join(desktop, 'build', 'core');
const hasCore = fs.existsSync(path.join(source, 'server', 'dist', 'index.js'));

if (!hasCore) {
  fs.mkdirSync(target, { recursive: true });
  console.warn('stage-release-core: no built core found; the installer will ask for one');
  process.exit(0);
}

copyCoreSanitized(source, target);
const leaks = findReleaseLeaks(target);
if (leaks.length) {
  console.error('stage-release-core: sanitized core still contains sensitive files:');
  for (const leak of leaks) console.error(`  ${leak}`);
  process.exit(1);
}

const notices = path.join(desktop, 'THIRD_PARTY_NOTICES.md');
if (fs.existsSync(notices)) fs.copyFileSync(notices, path.join(target, 'THIRD_PARTY_NOTICES.md'));
console.log(`stage-release-core: ${target}`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COPY_DIRS = [
  ['server/dist', 'server/dist'],
  ['server/node_modules', 'server/node_modules'],
  ['client/dist', 'client/dist'],
  ['node_modules', 'node_modules'],
];

const COPY_FILES = [
  'package.json',
  'model-catalog.json',
  '模型标签表.md',
  'LICENSE',
  'NOTICE',
];

const SECRET_FIELDS = ['apiKey', 'key', 'token', 'secret', 'password'];

export function sanitizedConfig(sourceFile) {
  const config = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  delete config.keys;
  delete config.admin;
  delete config.auth;
  delete config.users;
  for (const provider of config.customProviders || []) {
    for (const field of SECRET_FIELDS) {
      if (provider[field] && provider[field] !== 'no-key') delete provider[field];
    }
  }
  return config;
}

// Copies only the runtime files that may be redistributed. Keys, databases,
// credentials, logs and local configuration never enter a release artifact.
export function copyCoreSanitized(source, target) {
  if (!fs.existsSync(path.join(source, 'server', 'dist', 'index.js'))) {
    throw new Error(`core is missing server/dist/index.js: ${source}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  for (const [from, to] of COPY_DIRS) {
    const src = path.join(source, from);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(target, to), { recursive: true });
  }

  for (const name of COPY_FILES) {
    const src = path.join(source, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(target, name));
  }
  if (!fs.existsSync(path.join(target, 'LICENSE'))) {
    const fallback = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../licenses/FreeLLMAPI-LICENSE');
    if (fs.existsSync(fallback)) fs.copyFileSync(fallback, path.join(target, 'LICENSE'));
  }

  const configFile = path.join(source, 'freeapi.config.json');
  if (fs.existsSync(configFile)) {
    fs.writeFileSync(
      path.join(target, 'freeapi.config.json'),
      JSON.stringify(sanitizedConfig(configFile), null, 2),
      'utf8',
    );
  }

  for (const name of ['cloudflared.exe', 'cloudflared']) {
    const src = path.join(source, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, name));
  }
}

export function findReleaseLeaks(root) {
  const blocked = new Set([
    '.env',
    'secrets.json',
    'UNIFIED_API_KEY.txt',
    'friend-key.txt',
    'friend-usage.json',
    'public-url.txt',
    'freeapi.db',
  ]);
  const leaks = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (entry.name === 'data' || entry.name === 'credentials' || entry.name === 'logs' || entry.name === '.git') {
          leaks.push(full);
          continue;
        }
        walk(full);
      } else if (blocked.has(entry.name) || entry.name.startsWith('.env.')) {
        leaks.push(full);
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return leaks;
}

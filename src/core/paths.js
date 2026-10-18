import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

const here = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(here, '../..');
export const repoRoot = path.resolve(appRoot, '..');

export function homeDir() {
  return os.homedir();
}

export function expandHome(value) {
  if (!value) return value;
  if (value === '~') return homeDir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homeDir(), value.slice(2));
  }
  return value;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function hasCore(dir) {
  if (!dir) return false;
  const root = path.resolve(expandHome(dir));
  const server = path.join(root, 'server', 'dist', 'index.js');
  const source = path.join(root, 'server', 'src', 'index.ts');
  const modules = path.join(root, 'node_modules');
  return fs.existsSync(server) && fs.existsSync(modules)
    || fs.existsSync(source) && fs.existsSync(modules);
}

export function coreCandidates({ configured, resourcesPath, env = process.env }) {
  const list = [];
  if (configured) list.push(expandHome(configured));
  if (env.FREELLM_CORE) list.push(expandHome(env.FREELLM_CORE));
  if (resourcesPath) list.push(path.join(resourcesPath, 'core'));
  list.push(path.join(homeDir(), 'FreeLLMAPI'));
  if (isWindows) list.push('D:\\FreeLLMAPI');
  list.push(path.join(repoRoot, 'freellmapi'));
  list.push(path.join(repoRoot, 'FreeLLMAPI'));
  list.push(repoRoot);
  return [...new Set(list.map((item) => path.resolve(item)))];
}

export function resolveCoreDir(options) {
  for (const candidate of coreCandidates(options)) {
    if (hasCore(candidate)) return candidate;
  }
  return options.configured ? path.resolve(expandHome(options.configured)) : '';
}

export function resolveNode({ resourcesPath, env = process.env }) {
  if (env.FREELLM_NODE && fs.existsSync(env.FREELLM_NODE)) return env.FREELLM_NODE;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'runtime', isWindows ? 'node.exe' : 'node');
    if (fs.existsSync(bundled)) return bundled;
  }
  const local = path.join(appRoot, 'resources', 'runtime', isWindows ? 'node.exe' : 'node');
  if (fs.existsSync(local)) return local;
  return 'node';
}

export function resolveOllama({ env = process.env } = {}) {
  if (env.FREELLM_OLLAMA) return env.FREELLM_OLLAMA;
  const candidates = [];
  if (isWindows) {
    candidates.push('D:\\Ollama\\ollama.exe');
    candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'));
  } else if (isMac) {
    candidates.push('/Applications/Ollama.app/Contents/Resources/ollama');
  } else {
    candidates.push('/usr/local/bin/ollama', '/usr/bin/ollama');
  }
  for (const file of candidates) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {}
  }
  return '';
}

export function resolveRouter({ resourcesPath }) {
  if (resourcesPath) {
    for (const name of ['task-router.cjs', 'task-router.js']) {
      const packaged = path.join(resourcesPath, name);
      if (fs.existsSync(packaged)) return packaged;
    }
  }
  for (const name of ['task-router.cjs', 'task-router.js']) {
    const local = path.join(appRoot, 'resources', name);
    if (fs.existsSync(local)) return local;
  }
  const standalone = path.join(appRoot, 'task-router.js');
  if (fs.existsSync(standalone)) return standalone;
  return path.join(repoRoot, 'router-task-router.js');
}

export function dataLayout(userDataDir, portableRoot) {
  const dataDir = portableRoot || userDataDir;
  return {
    dataDir,
    logDir: path.join(dataDir, 'logs'),
    configFile: path.join(dataDir, 'config.json'),
    secretsFile: path.join(dataDir, 'secrets.json'),
    envFile: path.join(dataDir, '.env'),
    dbFile: path.join(dataDir, 'freeapi.db'),
    publicUrlFile: path.join(dataDir, 'public-url.txt'),
  };
}

export function coreLayout(coreDir) {
  if (!coreDir) return null;
  const firstFile = (...candidates) => candidates.find((file) => {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  }) || '';
  return {
    root: coreDir,
    serverEntry: path.join(coreDir, 'server', 'dist', 'index.js'),
    clientDist: path.join(coreDir, 'client', 'dist'),
    catalog: path.join(coreDir, 'model-catalog.json'),
    configFile: path.join(coreDir, 'freeapi.config.json'),
    labels: path.join(coreDir, '模型标签表.md'),
    ownerKeyFile: path.join(coreDir, 'UNIFIED_API_KEY.txt'),
    friendKeyFile: path.join(coreDir, 'friend-key.txt'),
    usageFile: path.join(coreDir, 'friend-usage.json'),
    routerLog: path.join(coreDir, 'router.log'),
    envFile: firstFile(path.join(coreDir, '.env')),
    dbFile: firstFile(
      path.join(coreDir, 'server', 'data', 'freeapi.db'),
      path.join(coreDir, 'data', 'freeapi.db'),
      path.join(coreDir, 'freeapi.db'),
    ),
  };
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

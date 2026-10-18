import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, isWindows } from './paths.js';

export const DEFAULT_CONFIG = {
  version: 1,
  onboardingComplete: false,
  mode: 'hybrid',
  coreDir: '',
  ports: { dashboard: 3001, router: 3002, ollama: 11434, share: 3004 },
  autostart: false,
  closeToTray: true,
  stopServicesOnQuit: true,
  autoStartServices: true,
  lanShare: false,
  shareLan: false,
  shareEnabled: false,
  theme: 'dark',
  accent: 'amber',
  language: 'zh-CN',
  feedbackGroup: '',
  lastCatalogSync: '',
  modelMode: 'auto',
  pinnedModel: 'auto:code',
  local: {
    ollamaPath: '',
    modelsDir: '',
    context: 16384,
    parallel: 1,
    maxLoaded: 1,
    keepAlive: '2m',
    privacyModel: '',
    profile: 'balanced',
  },
  customModules: [],
  catalogMode: 'usable',
  publicTunnel: false,
  lastRoute: { model: 'auto:code', prompt: '帮我审查这段 TypeScript 代码，找边界条件问题' },
  window: { width: 1280, height: 820, x: null, y: null, maximized: false },
  createdAt: null,
  updatedAt: null,
};

function merge(base, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(out[key], value)
      : value;
  }
  return out;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

export function restrictFile(file) {
  try {
    if (isWindows) {
      const user = os.userInfo().username || process.env.USERNAME;
      if (!user) return;
      spawnSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:(M)`], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      fs.chmodSync(file, 0o600);
    }
  } catch {
    // A restrictive ACL is best effort; the app still works if policy blocks it.
  }
}

export class Store {
  constructor(layout) {
    this.layout = layout;
    ensureDir(layout.dataDir);
    ensureDir(layout.logDir);
    this.config = merge(DEFAULT_CONFIG, readJson(layout.configFile, {}));
    this.secrets = readJson(layout.secretsFile, {});
  }

  getConfig() {
    return this.config;
  }

  patchConfig(patch) {
    this.config = merge(this.config, patch);
    this.config.updatedAt = new Date().toISOString();
    if (!this.config.createdAt) this.config.createdAt = this.config.updatedAt;
    writeJsonAtomic(this.layout.configFile, this.config);
    return this.config;
  }

  setSecret(key, value) {
    this.secrets = { ...this.secrets, [key]: value };
    writeJsonAtomic(this.layout.secretsFile, this.secrets);
    restrictFile(this.layout.secretsFile);
    return value;
  }

  getSecret(key) {
    return this.secrets[key] || '';
  }
}

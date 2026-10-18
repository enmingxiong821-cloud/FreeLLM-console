import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchJson, run, spawnLogged, stopProcess, commandPath, waitForHealth } from './process.js';
import { ensureDir, isWindows, resolveOllama } from './paths.js';
import { restrictFile } from './store.js';
import { friendKey as newFriendKey } from './keys.js';

function tail(file, maxLines = 120) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split(/\r?\n/).slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

export class ServiceManager {
  constructor({ layout, store, coreDir, core, routerPath, nodePath, getConfig, onChange }) {
    this.layout = layout;
    this.store = store;
    this.coreDir = coreDir;
    this.core = core;
    this.routerPath = routerPath;
    this.nodePath = nodePath;
    this.getConfig = getConfig;
    this.onChange = onChange || (() => {});
    this.children = new Map();
    this.pending = new Map();
    this.lastError = {};
    this.ownerKeyFile = path.join(layout.dataDir, 'UNIFIED_API_KEY.txt');
    this.friendKeyFile = path.join(layout.dataDir, 'friend-key.txt');
    this.usageFile = path.join(layout.dataDir, 'friend-usage.json');
    this.routerLog = path.join(layout.logDir, 'router-task.log');
  }

  setCore(coreDir, core) {
    this.coreDir = coreDir;
    this.core = core;
  }

  port(name) {
    const key = name === 'server' ? 'dashboard' : name;
    return Number(this.getConfig()?.ports?.[key] || { dashboard: 3001, router: 3002, ollama: 11434 }[key]);
  }

  url(name) {
    return `http://127.0.0.1:${this.port(name)}`;
  }

  ensureEnvFile() {
    if (this.core?.envFile) return '';
    ensureDir(this.layout.dataDir);
    let text = '';
    try {
      text = fs.readFileSync(this.layout.envFile, 'utf8');
    } catch {}
    if (!/^ENCRYPTION_KEY=/m.test(text)) {
      const key = this.store.getSecret('encryptionKey')
        || crypto.randomBytes(32).toString('hex');
      this.store.setSecret('encryptionKey', key);
      text = `${text.trim()}\nENCRYPTION_KEY=${key}\n`.replace(/^\n/, '');
      fs.writeFileSync(this.layout.envFile, text, 'utf8');
      restrictFile(this.layout.envFile);
    }
    return text;
  }

  readOwnerKey() {
    try {
      const value = fs.readFileSync(this.ownerKeyFile, 'utf8').trim();
      if (value) return value;
    } catch {}
    const stored = this.store.getSecret('ownerKey') || '';
    if (stored) return stored;
    if (!this.core) return '';
    try {
      const legacy = fs.readFileSync(this.core.ownerKeyFile, 'utf8').trim();
      if (legacy) return legacy;
    } catch {}
    return this.store.getSecret('ownerKey') || '';
  }

  writeOwnerKey(key) {
    if (!key) return;
    ensureDir(path.dirname(this.ownerKeyFile));
    fs.writeFileSync(this.ownerKeyFile, key, 'utf8');
    restrictFile(this.ownerKeyFile);
    this.store.setSecret('ownerKey', key);
  }

  readFriendKey() {
    try {
      const value = fs.readFileSync(this.friendKeyFile, 'utf8').trim();
      if (value) return value;
    } catch {}
    const stored = this.store.getSecret('friendKey') || '';
    if (stored) return stored;
    if (!this.core) return '';
    try {
      const legacy = fs.readFileSync(this.core.friendKeyFile, 'utf8').trim();
      if (legacy) return legacy;
    } catch {}
    return this.store.getSecret('friendKey') || '';
  }

  writeFriendKey(key) {
    if (!key) return;
    ensureDir(path.dirname(this.friendKeyFile));
    fs.writeFileSync(this.friendKeyFile, key, 'utf8');
    restrictFile(this.friendKeyFile);
    this.store.setSecret('friendKey', key);
  }

  ensureFriendKey() {
    const existing = this.readFriendKey();
    if (existing) return existing;
    const key = newFriendKey();
    this.writeFriendKey(key);
    return key;
  }

  async syncOwnerFromServer() {
    try {
      const session = await fetchJson(`${this.url('dashboard')}/api/auth/desktop-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!session.ok || !session.data?.token) return this.readOwnerKey();
      const keyResult = await fetchJson(`${this.url('dashboard')}/api/settings/api-key`, {
        headers: { Authorization: `Bearer ${session.data.token}` },
      });
      const key = keyResult.ok ? keyResult.data?.apiKey : '';
      if (key) {
        // The server reads this value from its own database, so it is the
        // authoritative key for the instance we just started. Keep the file in
        // sync even when a previous database left an older key behind.
        if (key !== this.readOwnerKey()) this.writeOwnerKey(key);
        return key;
      }
      return this.readOwnerKey();
    } catch {
      return this.readOwnerKey();
    }
  }

  async health(name) {
    const target = name === 'server'
      ? `${this.url('dashboard')}/api/ping`
      : name === 'router'
        ? `${this.url('router')}/health`
        : `${this.url('ollama')}/api/tags`;
    try {
      const result = await fetchJson(target, { timeout: 1600 });
      return result.ok;
    } catch {
      return false;
    }
  }

  async status() {
    const [server, router, ollama] = await Promise.all([
      this.health('server'),
      this.health('router'),
      this.health('ollama'),
    ]);
    const entry = (name, running) => ({
      running,
      external: running && !this.children.has(name),
      pid: this.children.get(name)?.pid || null,
      port: this.port(name),
      error: this.lastError[name] || '',
      log: tail(path.join(this.layout.logDir, `${name}.log`), 40),
    });
    return {
      server: entry('server', server),
      router: entry('router', router),
      ollama: entry('ollama', ollama),
    };
  }

  async startServer() {
    return this.dedupe('server', async () => {
      if (await this.health('server')) return { ok: true, already: true };
      if (!this.core?.serverEntry || !fs.existsSync(this.core.serverEntry)) {
        throw new Error('没有找到 FreeLLMAPI 服务端。请在设置里选择包含 server/dist 的安装目录。');
      }
      this.ensureEnvFile();
      const env = {
        NODE_ENV: 'production',
        FREEAPI_DESKTOP: '1',
        FREEAPI_ENV_PATH: this.core.envFile || this.layout.envFile,
        FREEAPI_DB_PATH: this.core.dbFile || this.layout.dbFile,
        PORT: String(this.port('dashboard')),
        HOST: '127.0.0.1',
      };
      if (this.core.clientDist && fs.existsSync(this.core.clientDist)) {
        env.CLIENT_DIST = this.core.clientDist;
      }
      if (this.core.configFile && fs.existsSync(this.core.configFile)) {
        env.FREEAPI_CONFIG_PATH = this.core.configFile;
      }
      const child = spawnLogged(this.nodePath, [this.core.serverEntry], {
        cwd: this.coreDir,
        env,
        logFile: path.join(this.layout.logDir, 'server.log'),
      });
      this.children.set('server', child);
      child.once('exit', () => {
        this.children.delete('server');
        this.onChange();
      });
      const ready = await waitForHealth(`${this.url('dashboard')}/api/ping`, { timeout: 25000 });
      if (!ready) {
        this.lastError.server = '服务端启动超时，请查看日志。';
        throw new Error(this.lastError.server);
      }
      this.lastError.server = '';
      await this.syncOwnerFromServer();
      this.onChange();
      return { ok: true };
    });
  }

  async startRouter() {
    return this.dedupe('router', async () => {
      if (await this.health('router')) return { ok: true, already: true };
      if (!this.core) throw new Error('先选择 FreeLLMAPI 安装目录。');
      const owner = await this.syncOwnerFromServer();
      if (!owner) {
        throw new Error('统一 Key 尚未就绪。先启动 FreeLLMAPI 服务，或在设置里粘贴统一 Key。');
      }
      this.ensureFriendKey();
      if (!fs.existsSync(this.routerPath)) throw new Error('找不到任务路由程序。');
      if (!fs.existsSync(this.core.catalog)) {
        throw new Error('找不到模型目录 model-catalog.json，请先运行模型目录构建。');
      }
      const config = this.getConfig();
      const env = {
        FREELLM_HOME: this.coreDir,
        FREELLM_CATALOG: this.core.catalog,
        FREELLM_OWNER_KEY_FILE: this.ownerKeyFile,
        FREELLM_FRIEND_KEY_FILE: this.friendKeyFile,
        FREELLM_USAGE_FILE: this.usageFile,
        FREELLM_ROUTER_LOG: this.routerLog,
        FREELLM_UPSTREAM_HOST: '127.0.0.1',
        FREELLM_UPSTREAM_PORT: String(this.port('dashboard')),
        FREELLM_ROUTER_PORT: String(this.port('router')),
        FREELLM_PRIVACY_MODEL: config.local?.privacyModel || '',
        FREELLM_BIND_HOST: config.lanShare ? '0.0.0.0' : '127.0.0.1',
      };
      const child = spawnLogged(this.nodePath, [this.routerPath], {
        cwd: this.coreDir,
        env,
        logFile: path.join(this.layout.logDir, 'router.log'),
      });
      this.children.set('router', child);
      child.once('exit', () => {
        this.children.delete('router');
        this.onChange();
      });
      const ready = await waitForHealth(`${this.url('router')}/health`, { timeout: 20000 });
      if (!ready) {
        this.lastError.router = '任务路由启动超时，请查看日志。';
        throw new Error(this.lastError.router);
      }
      this.lastError.router = '';
      this.onChange();
      return { ok: true };
    });
  }

  async startOllama() {
    return this.dedupe('ollama', async () => {
      if (await this.health('ollama')) return { ok: true, already: true };
      const local = this.getConfig()?.local || {};
      const command = local.ollamaPath || resolveOllama() || commandPath('ollama');
      if (!command) throw new Error('未安装 Ollama。纯云端模式不需要它。');
      const ollamaRoot = path.dirname(command);
      const modelsDir = local.modelsDir || path.join(ollamaRoot, 'models');
      const child = spawnLogged(command, ['serve'], {
        env: {
          OLLAMA_HOST: `127.0.0.1:${this.port('ollama')}`,
          OLLAMA_NUM_PARALLEL: String(local.parallel || 1),
          OLLAMA_MAX_LOADED_MODELS: String(local.maxLoaded || 1),
          OLLAMA_CONTEXT_LENGTH: String(local.context || 16384),
          OLLAMA_KEEP_ALIVE: local.keepAlive || '2m',
          OLLAMA_KV_CACHE_TYPE: 'q8_0',
          OLLAMA_FLASH_ATTENTION: '1',
          ...(fs.existsSync(modelsDir) ? { OLLAMA_MODELS: modelsDir } : {}),
        },
        logFile: path.join(this.layout.logDir, 'ollama.log'),
      });
      this.children.set('ollama', child);
      child.once('exit', () => {
        this.children.delete('ollama');
        this.onChange();
      });
      const ready = await waitForHealth(`${this.url('ollama')}/api/tags`, { timeout: 15000 });
      if (!ready) {
        this.lastError.ollama = 'Ollama 启动超时。';
        throw new Error(this.lastError.ollama);
      }
      this.lastError.ollama = '';
      this.onChange();
      return { ok: true };
    });
  }

  dedupe(name, fn) {
    if (this.pending.has(name)) return this.pending.get(name);
    const promise = fn().finally(() => this.pending.delete(name));
    this.pending.set(name, promise);
    return promise;
  }

  async startAll() {
    const mode = this.getConfig()?.mode || 'hybrid';
    const results = {};
    results.server = await this.startServer().catch((error) => ({ ok: false, error: error.message }));
    results.router = await this.startRouter().catch((error) => ({ ok: false, error: error.message }));
    if (mode !== 'cloud') {
      results.ollama = await this.startOllama().catch((error) => ({ ok: false, error: error.message }));
    }
    this.onChange();
    return results;
  }

  async stop(name) {
    const child = this.children.get(name);
    if (!child) return { ok: true, already: true };
    await stopProcess(child);
    this.children.delete(name);
    this.onChange();
    return { ok: true };
  }

  async stopAll() {
    for (const name of ['router', 'server', 'ollama']) {
      await this.stop(name);
    }
    return { ok: true };
  }

  pullModel(model) {
    const name = String(model || '').trim();
    if (!/^[a-zA-Z0-9._:\/-]{2,120}$/.test(name)) throw new Error('模型名不合法');
    const local = this.getConfig()?.local || {};
    const command = local.ollamaPath || resolveOllama() || commandPath('ollama');
    if (!command) throw new Error('未找到 Ollama。请先安装，或把 ollama 放到 D:\\Ollama。');
    const ollamaRoot = path.dirname(command);
    const modelsDir = local.modelsDir || path.join(ollamaRoot, 'models');
    const child = spawnLogged(command, ['pull', name], {
      env: {
        ...(fs.existsSync(modelsDir) ? { OLLAMA_MODELS: modelsDir } : {}),
        OLLAMA_KEEP_ALIVE: '2m',
      },
      logFile: path.join(this.layout.logDir, 'ollama-pull.log'),
    });
    child.once('exit', () => this.onChange());
    return { ok: true, model: name, pid: child.pid };
  }

  async warmModel(model) {
    const name = String(model || '').trim();
    if (!/^[a-zA-Z0-9._:\/-]{2,120}$/.test(name)) throw new Error('模型名不合法');
    if (!(await this.health('ollama'))) throw new Error('Ollama 未启动，先启动或一键修复。');
    const started = Date.now();
    const request = (numCtx) => fetchJson(`${this.url('ollama')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: name,
        prompt: ' ',
        stream: false,
        keep_alive: this.getConfig()?.local?.keepAlive || '10m',
        options: { num_predict: 1, num_ctx: numCtx },
      }),
      timeout: 120000,
    });
    let result = await request(Number(this.getConfig()?.local?.context) || 16384);
    let errorText = String(result.data?.error || result.text || '');
    let fallbackContext = 0;
    if (!result.ok && /out of memory|alloc|cuda/i.test(errorText)) {
      fallbackContext = 4096;
      result = await request(fallbackContext);
      errorText = String(result.data?.error || result.text || '');
    }
    return {
      ok: result.ok && !result.data?.error,
      status: result.status,
      ms: Date.now() - started,
      model: name,
      fallbackContext,
      hint: /out of memory|alloc|cuda/i.test(errorText)
        ? '显存不足：降低上下文、关闭占显存的程序，或换 8B 级模型。'
        : '',
      error: result.ok && !result.data?.error
        ? ''
        : (errorText.slice(0, 240) || `HTTP ${result.status}`),
    };
  }

  async repairOllama() {
    const local = this.getConfig()?.local || {};
    const command = local.ollamaPath || resolveOllama() || commandPath('ollama');
    if (!command) {
      return {
        ok: false,
        error: '没有找到 Ollama。请先安装，或把 ollama 放到 D:\\Ollama。',
        installUrl: 'https://ollama.com/download',
      };
    }
    const modelsDir = local.modelsDir || path.join(path.dirname(command), 'models');
    if (local.modelsDir && !fs.existsSync(local.modelsDir)) {
      this.store.patchConfig({ local: { ...local, modelsDir: '' } });
    }
    await this.stop('ollama');
    const started = await this.startOllama().catch((error) => ({ ok: false, error: error.message }));
    if (!started.ok) {
      return { ok: false, error: started.error || 'Ollama 启动失败', command, modelsDir };
    }
    const version = await run(command, ['--version'], { timeout: 5000 });
    const tags = await fetchJson(`${this.url('ollama')}/api/tags`, { timeout: 5000 }).catch(() => null);
    const models = (tags?.data?.models || []).map((item) => item.name).filter(Boolean);
    return {
      ok: true,
      command,
      modelsDir,
      version: version.ok ? version.stdout.split(/\r?\n/)[0] : '',
      count: models.length,
      models: models.slice(0, 20),
    };
  }

  logs(name, lines = 160) {
    const safe = ['server', 'router', 'ollama', 'ollama-pull', 'install', 'tunnel', 'renderer'].includes(name) ? name : 'router';
    return tail(path.join(this.layout.logDir, `${safe}.log`), Math.min(600, Math.max(20, lines)));
  }

  dispose() {
    for (const child of this.children.values()) {
      try { child.kill(); } catch {}
    }
    this.children.clear();
  }
}

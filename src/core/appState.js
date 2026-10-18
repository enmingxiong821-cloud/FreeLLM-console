import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadCatalog } from './catalog.js';
import { integrationSnapshot, snippetFor, writeIntegration } from './integrations.js';
import { mask, friendKey as makeFriendKey } from './keys.js';
import { fetchJson } from './process.js';
import { resolveOllama } from './paths.js';
import { installSpec } from './installers.js';
import { FREE_SOURCES, SIMILAR_PROJECTS, CLOSED_PROVIDERS } from './providers.js';
import { LOCAL_MODELS } from './localModels.js';
import { APP_META } from './meta.js';

function readVersion(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).version || '';
  } catch {
    return '';
  }
}

export class AppState {
  constructor({ layout, store, services, tunnel, share, system, coreDir, core, appVersion, resourcesPath }) {
    this.layout = layout;
    this.store = store;
    this.services = services;
    this.tunnel = tunnel;
    this.share = share;
    this.system = system;
    this.coreDir = coreDir;
    this.core = core;
    this.appVersion = appVersion;
    this.resourcesPath = resourcesPath;
    this.localCache = null;
    this.localCacheAt = 0;
  }

  context() {
    return {
      home: process.env.HOME || process.env.USERPROFILE || '',
      appData: process.env.APPDATA || (process.platform === 'darwin'
        ? path.join(process.env.HOME || '', 'Library', 'Application Support')
        : path.join(process.env.HOME || '', '.config')),
      platform: process.platform,
      ports: { ...this.store.getConfig().ports },
      ownerKey: this.services.readOwnerKey(),
      friendKey: this.services.readFriendKey(),
      dataDir: this.layout.dataDir,
      coreDir: this.coreDir,
      nodePath: this.services.nodePath,
      mode: this.store.getConfig().mode,
      modelMode: this.store.getConfig().modelMode || 'auto',
      pinnedModel: this.store.getConfig().pinnedModel || 'auto:code',
      customModules: this.store.getConfig().customModules || [],
    };
  }

  async snapshot() {
    const ctx = this.context();
    const [serviceStatus, catalog, localModels] = await Promise.all([
      this.services.status(),
      Promise.resolve(loadCatalog(this.core?.catalog || path.join(this.coreDir || this.layout.dataDir, 'model-catalog.json'))),
      this.localModels(),
    ]);
    const config = this.store.getConfig();
    const dashboard = `http://127.0.0.1:${config.ports.dashboard}`;
    const router = `http://127.0.0.1:${config.ports.router}`;
    const aliases = [
      { id: 'auto', name: '自动 · 按任务选择', usableNow: true },
      { id: 'auto:code', name: '自动 · 代码', usableNow: true },
      { id: 'auto:office', name: '自动 · 办公', usableNow: true },
      { id: 'auto:reasoning', name: '自动 · 推理', usableNow: true },
      { id: 'auto:vision', name: '自动 · 视觉', usableNow: true },
      { id: 'auto:long', name: '自动 · 长文本', usableNow: true },
      { id: 'smart', name: '质量优先', usableNow: true },
      { id: 'fast', name: '速度优先', usableNow: true },
    ];
    const seenModels = new Set(aliases.map((item) => item.id));
    const modelOptions = [...aliases];
    for (const model of catalog.all) {
      if (!model.id || seenModels.has(model.id)) continue;
      seenModels.add(model.id);
      modelOptions.push({
        id: model.id,
        name: model.name,
        usableNow: model.usableNow,
        local: model.local,
        platform: model.platform,
      });
    }
    const localConfig = config.local || {};
    let recommendation = this.system?.recommendation
      ? { ...this.system.recommendation }
      : null;
    if (recommendation && localConfig.profile === 'memory') {
      recommendation = {
        ...recommendation,
        level: 'light',
        model: 'qwen3:8b',
        title: '省内存模式',
        detail: '优先低占用和快速启动；复杂任务仍可临时切到云端。',
      };
    } else if (recommendation && localConfig.profile === 'quality' && this.system.ramGB >= 24) {
      const heavy = (this.system.gpu || []).some((gpu) => Number(gpu.vramGB) >= 20);
      recommendation = {
        ...recommendation,
        level: heavy ? 'heavy' : 'strong',
        model: heavy ? 'qwen3:30b-a3b' : 'gpt-oss:20b',
        title: '质量优先模式',
        detail: heavy ? '显存足够时优先 30B；仍不会自动加载。' : '优先 20B，复杂代码和推理更稳。',
      };
    }
    if (recommendation?.model) {
      const installed = localModels.find((model) => model.name.startsWith(recommendation.model));
      if (installed) {
        recommendation.model = installed.name;
        recommendation.title = `${recommendation.title} · 已安装`;
        recommendation.detail = `已下载 ${installed.name}（${installed.sizeGB} GB），可以直接在隐私请求里使用。`;
      }
    }
    return {
      app: {
        version: this.appVersion,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron || '',
        node: process.versions.node || '',
      },
      config: {
        ...config,
        coreDir: this.coreDir || config.coreDir,
        dataDir: this.layout.dataDir,
        logDir: this.layout.logDir,
      },
      system: this.system,
      services: serviceStatus,
      tunnel: this.tunnel.status(),
      share: this.share ? {
        ready: this.share.ready,
        enabled: Boolean(config.shareEnabled),
        localUrl: this.share.localUrl(),
        publicUrl: this.share.publicUrl(),
        lanUrl: this.share.lanUrl(),
        port: this.share.port,
        lan: Boolean(config.shareLan),
      } : null,
      keys: {
        ownerMasked: mask(ctx.ownerKey),
        friendMasked: mask(ctx.friendKey),
        hasOwner: Boolean(ctx.ownerKey),
        hasFriend: Boolean(ctx.friendKey),
      },
      urls: {
        openai: `${router}/v1`,
        anthropic: router,
        dashboard,
        publicUrl: this.tunnel.status().url,
      },
      core: {
        dir: this.coreDir,
        exists: Boolean(this.core),
        serverVersion: readVersion(path.join(this.coreDir || '', 'package.json')),
        catalog: this.core?.catalog || '',
      },
      integrations: [
        ...integrationSnapshot(ctx).map((app) => {
          const spec = installSpec(app.id);
          return { ...app, autoInstall: Boolean(spec), installLabel: spec?.label || '', installKind: spec?.kind || '' };
        }),
        ...(config.customModules || []).map((module) => ({
          id: `custom:${module.id}`,
          name: module.name,
          mono: 'CM',
          desc: module.note || '用户自定义的 OpenAI 兼容入口',
          category: '自定义',
          installed: true,
          configured: true,
          auto: false,
          custom: true,
          note: `${module.baseUrl} · ${module.model}${module.keyStored ? ' · 密钥已本地保存' : ''}`,
          action: '复制配置',
          snippetId: `custom:${module.id}`,
          module,
        })),
      ],
      customModules: config.customModules || [],
      catalog: {
        total: catalog.total,
        usableCount: catalog.usableCount,
        generatedAt: catalog.generatedAt,
        models: catalog.usable,
        all: catalog.all,
      },
      modelOptions,
      freeSources: FREE_SOURCES,
      similarProjects: SIMILAR_PROJECTS,
      closedProviders: CLOSED_PROVIDERS,
      localCatalog: LOCAL_MODELS,
      meta: APP_META,
      local: {
        ollamaPath: localConfig.ollamaPath || resolveOllama() || '',
        modelsDir: localConfig.modelsDir || '',
        context: localConfig.context || 16384,
        parallel: localConfig.parallel || 1,
        maxLoaded: localConfig.maxLoaded || 1,
        keepAlive: localConfig.keepAlive || '2m',
        profile: localConfig.profile || 'balanced',
        privacyModel: localConfig.privacyModel || '',
        effectivePrivacyModel: localConfig.privacyModel || recommendation?.model || '',
        models: localModels,
        recommendation,
      },
    };
  }

  async localModels() {
    const now = Date.now();
    if (this.localCache && now - this.localCacheAt < 5000) return this.localCache;
    try {
      const result = await fetchJson(`http://127.0.0.1:${this.store.getConfig().ports.ollama}/api/tags`, { timeout: 1200 });
      if (!result.ok) return this.localCache || [];
      const models = (result.data?.models || []).map((model) => ({
        name: model.name,
        sizeGB: Math.round((Number(model.size) || 0) / 1e9 * 10) / 10,
        modifiedAt: model.modified_at || '',
      }));
      this.localCache = models;
      this.localCacheAt = now;
      return models;
    } catch {
      return this.localCache || [];
    }
  }

  async testRoute({ model = 'auto:code', prompt = '只回复 OK' } = {}) {
    const ctx = this.context();
    if (!ctx.ownerKey) throw new Error('统一 Key 尚未就绪，先启动全部服务。');
    const started = Date.now();
    const result = await fetchJson(`${this.services.url('router')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.ownerKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 96,
        stream: false,
      }),
      timeout: 60000,
    });
    const content = result.data?.choices?.[0]?.message?.content
      || result.data?.content?.[0]?.text
      || result.text.slice(0, 1200);
    return {
      ok: result.ok,
      status: result.status,
      ms: Date.now() - started,
      task: result.headers.get('x-task-router') || '',
      model: result.headers.get('x-model-selected') || model,
      privacy: result.headers.get('x-privacy-guard') || 'normal',
      attempt: result.headers.get('x-router-attempt') || '',
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };
  }

  integrationContext() {
    return this.context();
  }

  writeIntegrations(targets) {
    const ctx = this.context();
    const list = Array.isArray(targets) && targets.length ? targets : ['all'];
    const results = {};
    for (const target of list) {
      try {
        results[target] = { ok: true, files: writeIntegration(target, ctx) };
      } catch (error) {
        results[target] = { ok: false, error: error.message };
      }
    }
    return results;
  }

  snippet(id) {
    if (String(id).startsWith('custom:')) {
      const module = (this.store.getConfig().customModules || []).find((item) => `custom:${item.id}` === id);
      if (module) return this.customSnippet(module);
    }
    return snippetFor(id, this.context());
  }

  customSnippet(module) {
    const key = this.services.store.getSecret(`moduleKey:${module.id}`)
      || (module.useFriend ? this.services.readFriendKey() : this.services.readOwnerKey());
    if (module.protocol === 'anthropic') {
      return `ANTHROPIC_BASE_URL: ${module.baseUrl}
ANTHROPIC_AUTH_TOKEN: ${key}
ANTHROPIC_MODEL: ${module.model || 'claude-sonnet-4-5'}`;
    }
    return `Base URL: ${module.baseUrl}
API Key: ${key}
Model: ${module.model || 'auto'}`;
  }

  addModule(input) {
    const name = String(input?.name || '').trim();
    let baseUrl = String(input?.baseUrl || '').trim().replace(/\/+$/, '');
    const model = String(input?.model || 'auto').trim();
    if (!name) throw new Error('给模块起一个名字。');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL 必须是 http/https 地址。');
    const protocol = input?.protocol === 'anthropic' ? 'anthropic' : 'openai';
    if (protocol === 'openai' && !/\/(v1|v1beta|v1beta\/openai)$/i.test(baseUrl)) {
      baseUrl = `${baseUrl}/v1`;
    }
    if (protocol === 'anthropic') baseUrl = baseUrl.replace(/\/v1$/i, '');
    const module = {
      id: crypto.randomUUID(),
      name: name.slice(0, 60),
      baseUrl,
      model: model.slice(0, 120),
      note: String(input?.note || '').slice(0, 160),
      useFriend: Boolean(input?.useFriend),
      protocol,
      keyStored: Boolean(String(input?.apiKey || '').trim()),
      createdAt: new Date().toISOString(),
    };
    if (module.keyStored) this.services.store.setSecret(`moduleKey:${module.id}`, String(input.apiKey).trim());
    const modules = [...(this.store.getConfig().customModules || []), module];
    this.store.patchConfig({ customModules: modules });
    return { ok: true, ...module };
  }

  removeModule(id) {
    const modules = (this.store.getConfig().customModules || []).filter((item) => item.id !== id);
    this.store.patchConfig({ customModules: modules });
    this.services.store.setSecret(`moduleKey:${id}`, '');
    return { ok: true };
  }

  async quotas() {
    try {
      const session = await fetchJson(`${this.services.url('dashboard')}/api/auth/desktop-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!session.ok || !session.data?.token) {
        return { ok: false, error: '网关不是由控制台启动，无法读取额度。' };
      }
      const result = await fetchJson(`${this.services.url('dashboard')}/api/free-tier`, {
        headers: { Authorization: `Bearer ${session.data.token}` },
        timeout: 8000,
      });
      if (!result.ok) return { ok: false, error: `额度接口返回 ${result.status}` };
      const rawPools = result.data?.pools || [];
      const customPools = rawPools.filter((pool) => pool.platform === 'custom');
      const pools = rawPools.filter((pool) => pool.platform !== 'custom');
      if (customPools.length) {
        pools.push({
          platform: 'custom',
          poolKey: 'custom::*',
          modelCount: customPools.reduce((sum, pool) => sum + (pool.modelCount || 0), 0),
          keyCount: Math.max(...customPools.map((pool) => pool.keyCount || 0)),
          documentedBudget: customPools.reduce((sum, pool) => sum + (pool.documentedBudget || 0), 0),
          bestLabel: `${customPools.length} 个自定义/本地源`,
          kind: 'custom',
          quota: null,
        });
      }
      const grouped = new Map();
      for (const pool of pools) {
        const key = `${pool.platform}|${pool.bestLabel || pool.kind}`;
        const current = grouped.get(key);
        if (current) {
          current.modelCount += pool.modelCount || 0;
          current.keyCount = Math.max(current.keyCount, pool.keyCount || 0);
          current.documentedBudget = Math.max(current.documentedBudget, pool.documentedBudget || 0);
          if (!current.quota && pool.quota) current.quota = pool.quota;
        } else {
          grouped.set(key, {
            platform: pool.platform,
            poolKey: pool.poolKey,
            modelCount: pool.modelCount || 0,
            keyCount: pool.keyCount || 0,
            documentedBudget: pool.documentedBudget || 0,
            bestLabel: pool.bestLabel,
            kind: pool.kind,
            quota: pool.quota || null,
          });
        }
      }
      return {
        ok: true,
        generatedAt: result.data?.generatedAt,
        summary: { ...(result.data?.summary || {}), poolCount: grouped.size },
        pools: [...grouped.values()]
          .sort((a, b) => (b.documentedBudget || 0) - (a.documentedBudget || 0))
          .slice(0, 10)
          .map((pool) => ({
          platform: pool.platform,
          poolKey: pool.poolKey,
          modelCount: pool.modelCount,
          keyCount: pool.keyCount,
          budget: pool.documentedBudget,
          label: pool.bestLabel,
          kind: pool.kind,
          quota: pool.quota,
        })),
      };
    } catch (error) {
      const message = /fetch failed|ECONNREFUSED|timeout/i.test(error.message)
        ? '网关暂时不可达，确认服务在线后再刷新。'
        : error.message;
      return { ok: false, error: message };
    }
  }

  async syncCatalog() {
    try {
      const session = await fetchJson(`${this.services.url('dashboard')}/api/auth/desktop-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!session.ok || !session.data?.token) {
        return { ok: false, error: '网关不是由控制台启动，无法同步目录。' };
      }
      const result = await fetchJson(`${this.services.url('dashboard')}/api/premium/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.data.token}`, 'Content-Type': 'application/json' },
        body: '{}',
        timeout: 30000,
      });
      if (result.ok) this.store.patchConfig({ lastCatalogSync: new Date().toISOString() });
      return {
        ok: result.ok,
        status: result.status,
        sync: result.data?.sync || result.data || null,
        error: result.ok ? '' : (result.data?.error || `目录同步返回 ${result.status}`),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  regenerateFriendKey() {
    const key = makeFriendKey();
    this.services.writeFriendKey(key);
    return { ok: true, masked: mask(key) };
  }

  setOwnerKey(key) {
    const value = String(key || '').trim();
    if (value.length < 16) throw new Error('Key 太短，请粘贴 FreeLLMAPI 的完整统一 Key。');
    this.services.writeOwnerKey(value);
    return { ok: true, masked: mask(value) };
  }

  setModel({ mode, model, apply } = {}) {
    const nextMode = mode === 'manual' ? 'manual' : 'auto';
    const nextModel = String(model || this.store.getConfig().pinnedModel || 'auto:code').trim();
    if (!nextModel) throw new Error('请选择一个模型');
    this.store.patchConfig({ modelMode: nextMode, pinnedModel: nextModel });
    let write = null;
    if (apply) write = this.writeIntegrations(['all']);
    return { ok: true, mode: nextMode, model: nextModel, write };
  }

  shareInfo() {
    if (!this.share?.ready) return { ok: false, error: '朋友入口未启动' };
    const localUrl = this.share.localUrl();
    const publicUrl = this.share.publicUrl();
    const lanUrl = this.share.lanUrl();
    const base = this.tunnel.status().url
      || (this.store.getConfig().shareLan && lanUrl
        ? lanUrl.replace(/\/share\/.*$/, '')
        : `http://127.0.0.1:${this.share.port}`);
    return {
      ok: true,
      localUrl,
      publicUrl,
      lanUrl,
      packageText: this.share.packageText(base),
      lan: Boolean(this.store.getConfig().shareLan),
    };
  }
}

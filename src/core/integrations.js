import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandPath } from './process.js';
import { expandHome, isWindows, ensureDir } from './paths.js';
import { readJson, restrictFile, writeJsonAtomic } from './store.js';
import { resolveWorkbench } from './workbench.js';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const devCcSwitchHelper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../resources/ccswitch-db.cjs');
const ccSwitchHelper = process.resourcesPath
  && fs.existsSync(path.join(process.resourcesPath, 'ccswitch-db.cjs'))
  ? path.join(process.resourcesPath, 'ccswitch-db.cjs')
  : devCcSwitchHelper;

function backup(file) {
  try {
    if (!fs.existsSync(file)) return '';
    const target = `${file}.freellm-backup-${stamp()}`;
    fs.copyFileSync(file, target);
    restrictFile(target);
    return target;
  } catch {
    return '';
  }
}

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

function writeText(file, text, mode = 0o600) {
  ensureDir(path.dirname(file));
  backup(file);
  fs.writeFileSync(file, text, 'utf8');
  if (isWindows) restrictFile(file);
  else fs.chmodSync(file, mode);
}

function baseUrl(ctx) {
  return `http://127.0.0.1:${ctx.ports.router}`;
}

function activeModel(ctx, fallback = 'auto') {
  return ctx.modelMode === 'manual' && ctx.pinnedModel ? ctx.pinnedModel : fallback;
}

function codexToml(ctx, { model, contextWindow }) {
  return `model = "${model}"
model_provider = "freellm"
model_context_window = ${contextWindow}
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.freellm]
name = "FreeLLM Console"
base_url = "${baseUrl(ctx)}/v1"
env_key = "FREELLM_API_KEY"
wire_api = "responses"
`;
}

export function snippets(ctx) {
  const model = activeModel(ctx, 'auto');
  return {
    openai: `Base URL: ${baseUrl(ctx)}/v1
API Key: ${ctx.ownerKey}
Model: ${model}`,
    claude: `ANTHROPIC_BASE_URL=${baseUrl(ctx)}
ANTHROPIC_AUTH_TOKEN=${ctx.ownerKey}
ANTHROPIC_MODEL=${activeModel(ctx, 'claude-sonnet-4-5')}`,
    codex: codexToml(ctx, { model: activeModel(ctx, 'smart'), contextWindow: 131072 }),
    cline: `API Provider: OpenAI Compatible
Base URL: ${baseUrl(ctx)}/v1
API Key: ${ctx.ownerKey}
Model: ${activeModel(ctx, 'auto:code')}
Context Window: 32768
Max Output: 4096`,
    cherry: `类型: OpenAI 兼容
API 地址: ${baseUrl(ctx)}
API 密钥: ${ctx.ownerKey}
模型: ${activeModel(ctx, 'auto')} / auto:code / auto:office / auto:vision`,
    continue: `provider: openai
apiBase: ${baseUrl(ctx)}/v1
apiKey: ${ctx.ownerKey}
model: ${activeModel(ctx, 'auto:code')}`,
    pi: `// ~/.pi/agent/models.json
{
  "providers": {
    "freellm": {
      "baseUrl": "${baseUrl(ctx)}/v1",
      "api": "openai-completions",
      "authHeader": true,
      "models": [{ "id": "${activeModel(ctx, 'auto:code')}" }]
    }
  }
}
// ~/.pi/agent/auth.json
{ "freellm": { "type": "api_key", "key": "${ctx.ownerKey}" } }
// ~/.pi/agent/settings.json
{ "defaultProvider": "freellm", "defaultModel": "${activeModel(ctx, 'auto:code')}" }`,
    aider: `OPENAI_API_BASE=${baseUrl(ctx)}/v1
OPENAI_API_KEY=${ctx.ownerKey}
aider --model openai/${activeModel(ctx, 'gpt-oss-20b')}`,
  };
}

export function writeCodex(ctx) {
  const dir = path.join(ctx.home, '.codex');
  const local = path.join(dir, 'freellm.config.toml');
  const smart = path.join(dir, 'freellm-smart.config.toml');
  writeText(local, codexToml(ctx, { model: 'gpt-oss-20b', contextWindow: 16384 }));
  writeText(smart, codexToml(ctx, { model: activeModel(ctx, 'smart'), contextWindow: 131072 }));
  return [local, smart];
}

export function writeClaude(ctx) {
  const dir = path.join(ctx.home, '.claude');
  const settingsFile = path.join(dir, 'settings.json');
  const settings = readJson(settingsFile, {});
  backup(settingsFile);
  writeJsonAtomic(settingsFile, merge(settings, {
    env: {
      ANTHROPIC_BASE_URL: baseUrl(ctx),
      ANTHROPIC_AUTH_TOKEN: ctx.ownerKey,
      ANTHROPIC_MODEL: activeModel(ctx, 'claude-sonnet-4-5'),
      ANTHROPIC_SMALL_FAST_MODEL: 'claude-haiku-4-5',
    },
  }));
  restrictFile(settingsFile);

  const launcherDir = path.join(ctx.home, '.freellm');
  const launcher = path.join(launcherDir, isWindows ? 'claude-freellm.cmd' : 'claude-freellm.sh');
  const text = isWindows
    ? `@echo off\r\nset ANTHROPIC_BASE_URL=${baseUrl(ctx)}\r\nset ANTHROPIC_AUTH_TOKEN=${ctx.ownerKey}\r\nset ANTHROPIC_MODEL=${activeModel(ctx, 'claude-sonnet-4-5')}\r\nset ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5\r\nclaude %*\r\n`
    : `#!/usr/bin/env sh\nexport ANTHROPIC_BASE_URL="${baseUrl(ctx)}"\nexport ANTHROPIC_AUTH_TOKEN="${ctx.ownerKey}"\nexport ANTHROPIC_MODEL="${activeModel(ctx, 'claude-sonnet-4-5')}"\nexport ANTHROPIC_SMALL_FAST_MODEL="claude-haiku-4-5"\nexec claude "$@"\n`;
  writeText(launcher, text, 0o700);
  return [settingsFile, launcher];
}

function claudeProvider(ctx) {
  return {
    id: 'freellm',
    name: 'FreeLLM Console',
    category: 'aggregator',
    icon: 'anthropic',
    iconColor: '#D97757',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: baseUrl(ctx),
        ANTHROPIC_AUTH_TOKEN: ctx.ownerKey,
        ANTHROPIC_MODEL: activeModel(ctx, 'claude-sonnet-4-5'),
        ANTHROPIC_SMALL_FAST_MODEL: 'claude-haiku-4-5',
      },
    },
  };
}

function codexProvider(ctx, id, name, model, contextWindow) {
  return {
    id,
    name,
    category: id.includes('local') ? 'local' : 'aggregator',
    icon: 'openai',
    iconColor: id.includes('local') ? '#10A37F' : '#2563EB',
    settingsConfig: {
      auth: { OPENAI_API_KEY: ctx.ownerKey },
      config: `model_provider = "custom"
model = "${model}"
model_reasoning_effort = "high"
model_context_window = ${contextWindow}
disable_response_storage = true

[model_providers.custom]
name = "${name}"
base_url = "${baseUrl(ctx)}/v1"
wire_api = "responses"
requires_openai_auth = true`,
    },
  };
}

export function writeCcSwitch(ctx) {
  const dir = path.join(ctx.home, '.cc-switch');
  const dbFile = path.join(dir, 'cc-switch.db');
  const legacyFile = path.join(dir, 'config.json');
  const providers = [
    {
      ...claudeProvider(ctx),
      appType: 'claude',
      websiteUrl: 'https://github.com/enmingxiong821-cloud/FreeLLM-console',
      notes: 'FreeLLM Console 写入；重启 CC Switch 生效',
      meta: { commonConfigEnabled: true, endpointAutoSelect: true, apiFormat: 'anthropic' },
    },
    ...[
      ['freellm-local', 'FreeLLM Console 本地', 'gpt-oss-20b', 16384],
      ['freellm-smart', 'FreeLLM Console 云端', activeModel(ctx, 'smart'), 131072],
    ].map(([id, name, model, contextWindow]) => ({
      ...codexProvider(ctx, id, name, model, contextWindow),
      appType: 'codex',
      websiteUrl: 'https://github.com/enmingxiong821-cloud/FreeLLM-console',
      notes: 'FreeLLM Console 写入；重启 CC Switch 生效',
      meta: { commonConfigEnabled: true, endpointAutoSelect: true, apiFormat: 'openai_responses', isFullUrl: true },
    })),
  ];

  // CC Switch v3 uses SQLite as its source of truth. Write there when the
  // database exists; the bundled Node runtime carries the matching native
  // better-sqlite3 build.
  if (fs.existsSync(dbFile)) {
    backup(dbFile);
    const result = spawnSync(ctx.nodePath || 'node', [ccSwitchHelper], {
      input: JSON.stringify({ dbPath: dbFile, providers }),
      env: { ...process.env, FREELLM_CORE: ctx.coreDir || '' },
      timeout: 20000,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0) {
      const detail = String(result.stderr || result.error?.message || '').trim().slice(-400);
      throw new Error(`CC Switch 数据库写入失败，请关闭 CC Switch 后重试${detail ? `：${detail}` : ''}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.freellm'), JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      providers: providers.map((item) => `${item.appType}:${item.id}`),
    }, null, 2), 'utf8');
    return [dbFile];
  }

  // Legacy v2 JSON remains for older CC Switch installs.
  const cfg = readJson(legacyFile, { version: 2 });
  cfg.version = 2;
  cfg.claude = cfg.claude || { providers: {}, current: '' };
  cfg.codex = cfg.codex || { providers: {}, current: '' };
  cfg.claude.providers = cfg.claude.providers || {};
  cfg.codex.providers = cfg.codex.providers || {};
  const legacy = ({ appType, websiteUrl, notes, meta, ...rest }) => rest;
  cfg.claude.providers.freellm = legacy(providers[0]);
  cfg.codex.providers['freellm-local'] = legacy(providers[1]);
  cfg.codex.providers['freellm-smart'] = legacy(providers[2]);
  if (!cfg.claude.current) cfg.claude.current = 'freellm';
  if (!cfg.codex.current) cfg.codex.current = 'freellm-local';
  backup(legacyFile);
  writeJsonAtomic(legacyFile, cfg);
  restrictFile(legacyFile);
  return [legacyFile];
}

export function writeEchoBird(ctx) {
  const file = path.join(ctx.home, '.echobird', 'config', 'models.json');
  const list = readJson(file, []);
  const arr = Array.isArray(list) ? list : [];
  const base = {
    baseUrl: `${baseUrl(ctx)}/v1`,
    anthropicUrl: baseUrl(ctx),
    apiKey: ctx.ownerKey,
    type: 'CLOUD',
  };
  const entries = [
    { internalId: 'freellm-auto', name: 'FreeLLM 自动', modelId: activeModel(ctx, 'auto'), ...base },
    { internalId: 'freellm-code', name: 'FreeLLM 代码', modelId: activeModel(ctx, 'auto:code'), ...base },
    { internalId: 'freellm-office', name: 'FreeLLM 办公', modelId: activeModel(ctx, 'auto:office'), ...base },
    { internalId: 'freellm-reasoning', name: 'FreeLLM 推理', modelId: activeModel(ctx, 'auto:reasoning'), ...base },
    { internalId: 'freellm-vision', name: 'FreeLLM 视觉', modelId: activeModel(ctx, 'auto:vision'), ...base },
    { internalId: 'freellm-local', name: 'FreeLLM 本地 GPT-OSS', modelId: 'gpt-oss-20b', ...base },
  ];
  const ids = new Set(arr.map((item) => item.internalId));
  for (const entry of entries) {
    if (ids.has(entry.internalId)) {
      const index = arr.findIndex((item) => item.internalId === entry.internalId);
      arr[index] = { ...arr[index], ...entry };
    } else {
      arr.push(entry);
    }
  }
  backup(file);
  writeJsonAtomic(file, arr);
  restrictFile(file);
  return [file];
}

export function writeContinue(ctx) {
  const file = path.join(ctx.home, '.continue', 'config.json');
  const cfg = readJson(file, {});
  const models = Array.isArray(cfg.models) ? cfg.models : [];
  const entry = {
    title: 'FreeLLM Console',
    provider: 'openai',
    model: activeModel(ctx, 'auto:code'),
    apiBase: `${baseUrl(ctx)}/v1`,
    apiKey: ctx.ownerKey,
  };
  const index = models.findIndex((item) => item?.title === entry.title);
  if (index >= 0) models[index] = { ...models[index], ...entry };
  else models.push(entry);
  backup(file);
  writeJsonAtomic(file, merge(cfg, { models }));
  restrictFile(file);
  return [file];
}

export function writePi(ctx) {
  const file = path.join(ctx.home, '.pi', 'agent', 'models.json');
  const cfg = readJson(file, {});
  const providers = cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : {};
  const defaultModel = activeModel(ctx, 'auto:code');
  const modelIds = [...new Set([
    defaultModel,
    'auto', 'auto:code', 'auto:office', 'auto:reasoning', 'auto:vision', 'smart', 'fast',
  ])];
  const models = modelIds.map((id) => ({
    id,
    name: id === 'auto' ? 'FreeLLM Auto' : `FreeLLM ${id}`,
    contextWindow: 131072,
    maxTokens: 8192,
    input: ['text'],
  }));
  const next = merge(cfg, {
    providers: {
      ...providers,
      freellm: {
        ...(providers.freellm || {}),
        name: 'FreeLLM Console',
        baseUrl: `${baseUrl(ctx)}/v1`,
        api: 'openai-completions',
        authHeader: true,
        models,
      },
    },
  });
  delete next.providers.freellm.apiKey;
  backup(file);
  writeJsonAtomic(file, next);
  restrictFile(file);

  const dir = path.dirname(file);
  const authFile = path.join(dir, 'auth.json');
  const auth = readJson(authFile, {});
  backup(authFile);
  writeJsonAtomic(authFile, merge(auth, {
    freellm: { type: 'api_key', key: ctx.ownerKey },
  }));
  restrictFile(authFile);

  const settingsFile = path.join(dir, 'settings.json');
  const settings = readJson(settingsFile, {});
  backup(settingsFile);
  writeJsonAtomic(settingsFile, merge(settings, {
    defaultProvider: 'freellm',
    defaultModel,
  }));
  restrictFile(settingsFile);
  return [file, authFile, settingsFile];
}

export function writeLaunchers(ctx) {
  const dir = path.join(ctx.home, '.freellm');
  const output = [];
  const claude = path.join(dir, isWindows ? 'claude-freellm.cmd' : 'claude-freellm.sh');
  const aider = path.join(dir, isWindows ? 'aider-freellm.cmd' : 'aider-freellm.sh');
  const claudeText = isWindows
    ? `@echo off\r\nset ANTHROPIC_BASE_URL=${baseUrl(ctx)}\r\nset ANTHROPIC_AUTH_TOKEN=${ctx.ownerKey}\r\nset ANTHROPIC_MODEL=${activeModel(ctx, 'claude-sonnet-4-5')}\r\nclaude %*\r\n`
    : `#!/usr/bin/env sh\nexport ANTHROPIC_BASE_URL="${baseUrl(ctx)}"\nexport ANTHROPIC_AUTH_TOKEN="${ctx.ownerKey}"\nexport ANTHROPIC_MODEL="${activeModel(ctx, 'claude-sonnet-4-5')}"\nexec claude "$@"\n`;
  const aiderText = isWindows
    ? `@echo off\r\nset OPENAI_API_BASE=${baseUrl(ctx)}/v1\r\nset OPENAI_API_KEY=${ctx.ownerKey}\r\naider --model openai/${activeModel(ctx, 'gpt-oss-20b')} %*\r\n`
    : `#!/usr/bin/env sh\nexport OPENAI_API_BASE="${baseUrl(ctx)}/v1"\nexport OPENAI_API_KEY="${ctx.ownerKey}"\nexec aider --model openai/${activeModel(ctx, 'gpt-oss-20b')} "$@"\n`;
  writeText(claude, claudeText, 0o700);
  writeText(aider, aiderText, 0o700);
  output.push(claude, aider);
  return output;
}

export function writeSnippets(ctx) {
  const dir = path.join(ctx.dataDir, 'connect');
  ensureDir(dir);
  const map = snippets(ctx);
  const files = [];
  for (const [name, text] of Object.entries(map)) {
    const file = path.join(dir, `${name}.txt`);
    fs.writeFileSync(file, `${text}\n`, 'utf8');
    restrictFile(file);
    files.push(file);
  }
  fs.writeFileSync(path.join(dir, 'README.md'), `# FreeLLM 连接信息

所有软件共用同一个地址和 Key：

- OpenAI Base URL: ${baseUrl(ctx)}/v1
- Anthropic Base URL: ${baseUrl(ctx)}
- 当前默认模型: ${activeModel(ctx, 'auto')}
- 可用别名: auto / auto:code / auto:office / auto:reasoning / auto:vision / smart / fast

这个目录含完整 Key，不要上传或发给不信任的人。
`, 'utf8');
  restrictFile(path.join(dir, 'README.md'));
  return files;
}

function hasAny(paths) {
  return paths.some((file) => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  });
}

function fileIncludes(file, needle) {
  try {
    return fs.readFileSync(file, 'utf8').includes(String(needle));
  } catch {
    return false;
  }
}

function extensionInstalled(home, names, pattern) {
  for (const name of names) {
    const dir = path.join(home, name, 'extensions');
    try {
      if (fs.readdirSync(dir).some((item) => pattern.test(item))) return true;
    } catch {}
  }
  return false;
}

export function integrationSnapshot(ctx) {
  const home = ctx.home;
  const cc = readJson(path.join(home, '.cc-switch', 'config.json'), {});
  const echo = readJson(path.join(home, '.echobird', 'config', 'models.json'), []);
  const continueCfg = readJson(path.join(home, '.continue', 'config.json'), {});
  const piCfg = readJson(path.join(home, '.pi', 'agent', 'models.json'), {});
  const claudeSettings = readJson(path.join(home, '.claude', 'settings.json'), {});
  const codexFile = path.join(home, '.codex', 'freellm.config.toml');
  const launcher = path.join(home, '.freellm', isWindows ? 'claude-freellm.cmd' : 'claude-freellm.sh');
  const aiderLauncher = path.join(home, '.freellm', isWindows ? 'aider-freellm.cmd' : 'aider-freellm.sh');
  const cherryPaths = isWindows
    ? [
      path.join(ctx.appData, 'CherryStudio'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CherryStudio', 'CherryStudio.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'CherryStudio', 'CherryStudio.exe'),
      'D:\\CherryStudio\\CherryStudio.exe',
    ]
    : process.platform === 'darwin'
      ? ['/Applications/Cherry Studio.app', path.join(home, 'Applications/Cherry Studio.app')]
      : ['/opt/CherryStudio/cherrystudio', '/usr/bin/cherrystudio'];

  const external = ({ id, name, mono, desc, category, installUrl, installCommand = '', paths = [], commands = [], note, snippet = 'openai' }) => ({
    id,
    name,
    mono,
    desc,
    category,
    installed: hasAny(paths) || commands.some((command) => Boolean(commandPath(command))),
    configured: false,
    auto: false,
    note,
    action: '复制配置',
    installUrl,
    installCommand,
    snippet,
    launch: commands[0] || '',
  });

  return [
    {
      id: 'codex',
      name: 'Codex CLI',
      mono: 'CX',
      desc: '终端里直接写代码、跑命令。自动获得本地与云端两套 profile。',
      installed: Boolean(commandPath('codex')) || fs.existsSync(path.join(home, '.codex')),
      configured: fileIncludes(codexFile, ctx.ports.router),
      auto: true,
      category: '终端',
      installUrl: 'https://github.com/openai/codex',
      installCommand: 'npm install -g @openai/codex',
      note: '写入 freellm（本地）与 freellm-smart（云端）',
      action: '写配置',
    },
    {
      id: 'claude',
      name: 'Claude Code',
      mono: 'CC',
      desc: 'Anthropic 协议，适合长任务和仓库级修改。',
      installed: Boolean(commandPath('claude')),
      configured: claudeSettings?.env?.ANTHROPIC_BASE_URL === baseUrl(ctx) || fs.existsSync(launcher),
      auto: true,
      category: '终端',
      installUrl: 'https://docs.anthropic.com/en/docs/claude-code',
      installCommand: 'npm install -g @anthropic-ai/claude-code',
      note: '写入 ~/.claude/settings.json，并生成启动脚本',
      action: '写配置',
    },
    {
      id: 'ccswitch',
      name: 'CC Switch',
      mono: 'SW',
      desc: '在 Claude Code 与 Codex 的供应商之间一键切换。',
      installed: hasAny([
        path.join(ctx.appData, 'CC Switch'),
        path.join(ctx.appData, 'cc-switch'),
        path.join(home, 'AppData', 'Local', 'Programs', 'cc-switch'),
        '/Applications/CC Switch.app',
      ]),
      configured: fs.existsSync(path.join(home, '.cc-switch', '.freellm'))
        || Boolean(cc?.claude?.providers?.freellm || cc?.codex?.providers?.['freellm-local']),
      auto: true,
      category: '切换器',
      categories: ['切换器'],
      installUrl: 'https://github.com/farion1231/cc-switch/releases',
      note: '写入 CC Switch 的 Claude 与 Codex 供应商；新版使用本地数据库',
      action: '写配置',
    },
    {
      id: 'echobird',
      name: 'EchoBird',
      mono: 'EB',
      desc: '桌面模型中心，自动、代码、办公、推理、视觉分开用。',
      installed: hasAny([
        path.join(ctx.appData, 'EchoBird'),
        path.join(home, 'AppData', 'Local', 'EchoBird'),
        '/Applications/EchoBird.app',
      ]),
      configured: Array.isArray(echo) && echo.some((item) => item?.internalId === 'freellm-auto'),
      auto: true,
      category: '桌面',
      categories: ['切换器', '桌面'],
      installUrl: 'https://echobird.ai/',
      note: '写入 6 个 FreeLLM 入口',
      action: '写配置',
    },
    {
      id: 'continue',
      name: 'Continue',
      mono: 'CO',
      desc: 'VS Code / JetBrains 里的开源编程助手。',
      installed: extensionInstalled(home, ['.vscode', '.vscode-insiders', '.cursor'], /continue/i)
        || fs.existsSync(path.join(home, '.continue')),
      configured: Array.isArray(continueCfg?.models)
        && continueCfg.models.some((item) => item?.title === 'FreeLLM Console'),
      auto: true,
      category: 'IDE',
      installUrl: 'https://marketplace.visualstudio.com/items?itemName=Continue.continue',
      note: '写入 ~/.continue/config.json',
      action: '写配置',
    },
    {
      id: 'cline',
      name: 'Cline',
      mono: 'CL',
      desc: 'VS Code 里的多文件 Agent。首次需要在设置里粘贴一次。',
      installed: extensionInstalled(home, ['.vscode', '.vscode-insiders', '.cursor'], /claude-dev|cline/i),
      configured: false,
      auto: false,
      category: 'IDE',
      installUrl: 'https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev',
      note: '复制配置 → 打开 Cline 设置 → OpenAI Compatible',
      action: '复制配置',
    },
    {
      id: 'cherry',
      name: 'Cherry Studio',
      mono: 'CH',
      desc: '办公、知识库、设计稿和划词助手。',
      installed: hasAny(cherryPaths),
      configured: false,
      auto: false,
      category: '桌面',
      installUrl: 'https://www.cherry-ai.com/',
      note: '复制配置 → 自定义服务商 → OpenAI 兼容',
      action: '复制配置',
    },
    {
      id: 'aider',
      name: 'Aider',
      mono: 'AD',
      desc: '终端结对编程，生成独立启动脚本。',
      installed: Boolean(commandPath('aider')),
      configured: fs.existsSync(aiderLauncher),
      auto: true,
      category: '终端',
      installUrl: 'https://aider.chat/',
      installCommand: 'python -m pip install aider-install',
      note: '生成 ~/.freellm/aider-freellm',
      action: '写配置',
    },
    external({
      id: 'cursor',
      name: 'Cursor',
      mono: 'CU',
      desc: '智能编辑器。在 Models → OpenAI API 里填入统一地址。',
      category: 'IDE',
      installUrl: 'https://cursor.com/downloads',
      paths: [
        path.join(home, 'AppData', 'Local', 'Programs', 'cursor', 'Cursor.exe'),
        '/Applications/Cursor.app',
      ],
      commands: ['cursor'],
      note: '设置 → Models → OpenAI API：Base URL 加 /v1',
    }),
    external({
      id: 'windsurf',
      name: 'Windsurf',
      mono: 'WS',
      desc: '智能编辑器，支持自定义 OpenAI 兼容端点。',
      category: 'IDE',
      installUrl: 'https://windsurf.com/download',
      paths: [
        path.join(home, 'AppData', 'Local', 'Programs', 'Windsurf', 'Windsurf.exe'),
        '/Applications/Windsurf.app',
      ],
      commands: ['windsurf'],
      note: '设置 → 模型 → 自定义 OpenAI 兼容服务',
    }),
    external({
      id: 'zed',
      name: 'Zed',
      mono: 'ZD',
      desc: '高性能编辑器，支持 OpenAI 兼容 provider。',
      category: 'IDE',
      installUrl: 'https://zed.dev/download',
      paths: ['/Applications/Zed.app'],
      commands: ['zed'],
      note: 'settings.json → language_models → openai_compatible',
    }),
    external({
      id: 'roo',
      name: 'Roo Code',
      mono: 'RO',
      desc: 'VS Code 里的多模式编程 Agent。',
      category: 'IDE',
      installUrl: 'https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline',
      note: 'Provider 选 OpenAI Compatible',
    }),
    external({
      id: 'kilo',
      name: 'Kilo Code',
      mono: 'KI',
      desc: 'VS Code 里的开源 Agent，兼容 Cline 配置。',
      category: 'IDE',
      installUrl: 'https://marketplace.visualstudio.com/items?itemName=kilocode.kilo-code',
      note: 'Provider 选 OpenAI Compatible',
    }),
    external({
      id: 'opencode',
      name: 'OpenCode',
      mono: 'OC',
      desc: '终端编程助手，支持 OpenAI 兼容 provider。',
      category: '终端',
      installUrl: 'https://opencode.ai/',
      installCommand: 'npm install -g opencode-ai',
      commands: ['opencode'],
      note: 'opencode.json → provider.openai.options.baseURL',
    }),
    external({
      id: 'goose',
      name: 'Goose',
      mono: 'GO',
      desc: 'Block 开源的本地 Agent。',
      category: '终端',
      installUrl: 'https://block.github.io/goose/',
      commands: ['goose'],
      note: 'Provider 选 OpenAI Compatible',
    }),
    external({
      id: 'qwen',
      name: 'Qwen Code',
      mono: 'QW',
      desc: '通义千问的命令行编程助手。',
      category: '终端',
      installUrl: 'https://github.com/QwenLM/qwen-code',
      installCommand: 'npm install -g @qwen-code/qwen-code',
      commands: ['qwen'],
      note: 'OPENAI_BASE_URL 指向 /v1',
    }),
    external({
      id: 'chatbox',
      name: 'Chatbox',
      mono: 'CB',
      desc: '轻量桌面聊天客户端，适合日常问答。',
      category: '桌面',
      installUrl: 'https://chatboxai.app/',
      paths: [
        path.join(home, 'AppData', 'Local', 'Programs', 'Chatbox', 'Chatbox.exe'),
        '/Applications/Chatbox.app',
      ],
      note: '模型提供方选 OpenAI API 兼容',
    }),
    external({
      id: 'openwebui',
      name: 'Open WebUI',
      mono: 'OW',
      desc: '自托管聊天界面，适合团队或手机访问。',
      category: '自托管',
      installUrl: 'https://openwebui.com/',
      note: '连接设置里新增 OpenAI API，地址用公网 /v1',
    }),
    external({
      id: 'lmstudio',
      name: 'LM Studio',
      mono: 'LM',
      desc: '本地模型运行器，可作为另一个 localhost 端点。',
      category: '本地模型',
      installUrl: 'https://lmstudio.ai/',
      paths: [
        path.join(home, 'AppData', 'Local', 'Programs', 'LM Studio', 'LM Studio.exe'),
        '/Applications/LM Studio.app',
      ],
      note: '启动 Local Server 后可被其它客户端使用',
    }),
    external({
      id: 'jan',
      name: 'Jan',
      mono: 'JN',
      desc: '开源本地桌面助手，支持 OpenAI 兼容端点。',
      category: '本地模型',
      installUrl: 'https://jan.ai/',
      paths: [
        path.join(home, 'AppData', 'Local', 'Programs', 'Jan', 'Jan.exe'),
        '/Applications/Jan.app',
      ],
      note: '设置 → 扩展 → OpenAI 兼容',
    }),
    {
      id: 'pi',
      name: 'Pi',
      mono: 'PI',
      desc: '终端编程 Agent，支持 OpenAI 兼容端点与本地模型。',
      category: '终端',
      installed: Boolean(commandPath('pi')) || fs.existsSync(path.join(home, '.pi')),
      configured: Boolean(piCfg?.providers?.freellm),
      auto: true,
      note: '写入 ~/.pi/agent/models.json 的 freellm provider',
      action: '写配置',
      installUrl: 'https://pi.dev/',
      installCommand: 'npm install -g @earendil-works/pi-coding-agent',
    },
    {
      id: 'pi-workbench',
      name: 'Pi 工作台',
      mono: 'PW',
      desc: '可选的极简 Pi 工作台：真实 Pi TUI + 图形辅助 + 多项目。',
      category: '桌面',
      categories: ['终端', '桌面'],
      installed: Boolean(resolveWorkbench()),
      configured: Boolean(piCfg?.providers?.freellm),
      auto: true,
      note: '读取 ~/.pi 配置；控制台可直接带项目启动',
      action: '写配置',
      installUrl: 'https://github.com/enmingxiong821-cloud/pi--desktop/releases',
    },
    external({
      id: 'pi-desktop',
      name: 'PI-Desktop',
      mono: 'PD',
      desc: '基于 Pi 的本地优先桌面工作区，可导入 Pi 配置与会话。',
      category: '桌面',
      installUrl: 'https://github.com/vastsa/PI-Desktop/releases',
      paths: [
        path.join(home, 'AppData', 'Local', 'Programs', 'PI-Desktop', 'PI-Desktop.exe'),
        '/Applications/PI-Desktop.app',
      ],
      note: 'Provider 选 OpenAI Compatible；也可导入 ~/.pi 的会话',
    }),
    external({
      id: 'gemini',
      name: 'Gemini CLI',
      mono: 'GM',
      desc: 'Google 的终端 Agent；可走 FreeLLMAPI 的 Gemini 兼容端点。',
      category: '终端',
      installUrl: 'https://github.com/google-gemini/gemini-cli',
      installCommand: 'npm install -g @google/gemini-cli',
      commands: ['gemini'],
      note: 'GOOGLE_GEMINI_BASE_URL 指向网关的 /v1beta',
    }),
    external({
      id: 'crush',
      name: 'Crush',
      mono: 'CR',
      desc: 'Charm 的终端编程 Agent，支持 OpenAI 兼容 provider。',
      category: '终端',
      installUrl: 'https://github.com/charmbracelet/crush',
      installCommand: 'go install github.com/charmbracelet/crush@latest',
      commands: ['crush'],
      note: 'Provider 选 openai，Base URL 加 /v1',
    }),
    external({
      id: 'amp',
      name: 'Amp',
      mono: 'AM',
      desc: 'Sourcegraph 的终端 Agent，可接入自定义模型端点。',
      category: '终端',
      installUrl: 'https://ampcode.com/',
      installCommand: 'npm install -g @sourcegraph/amp',
      commands: ['amp'],
      note: '使用 OpenAI 兼容 provider 配置',
    }),
  ];
}

export function writeIntegration(id, ctx) {
  switch (id) {
    case 'codex': return writeCodex(ctx);
    case 'claude': return writeClaude(ctx);
    case 'ccswitch': return writeCcSwitch(ctx);
    case 'echobird': return writeEchoBird(ctx);
    case 'continue': return writeContinue(ctx);
    case 'pi': return writePi(ctx);
    case 'pi-workbench': return writePi(ctx);
    case 'aider': return writeLaunchers(ctx).filter((file) => file.includes('aider'));
    case 'launchers': return writeLaunchers(ctx);
    case 'snippets': return writeSnippets(ctx);
    case 'all': {
      const files = [];
      for (const target of ['codex', 'claude', 'ccswitch', 'echobird', 'continue', 'pi', 'pi-workbench', 'launchers', 'snippets']) {
        try {
          files.push(...writeIntegration(target, ctx));
        } catch {}
      }
      return [...new Set(files)];
    }
    default:
      return [];
  }
}

export function snippetFor(id, ctx) {
  const map = snippets(ctx);
  return map[id] || map.openai;
}

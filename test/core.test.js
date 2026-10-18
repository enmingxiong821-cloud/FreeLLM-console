import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { expandHome, hasCore, coreLayout, dataLayout } from '../src/core/paths.js';
import { Store, DEFAULT_CONFIG, restrictFile } from '../src/core/store.js';
import { mask, ownerKey, friendKey, timingSafeEqual } from '../src/core/keys.js';
import { recommendLocalModel } from '../src/core/hardware.js';
import { writeCcSwitch, writeEchoBird, writeContinue, writeCodex, writePi, integrationSnapshot } from '../src/core/integrations.js';
import { loadCatalog } from '../src/core/catalog.js';
import { backupTargets, listBackups, restoreBackup } from '../src/core/backups.js';
import { installCommand, installSpec } from '../src/core/installers.js';
import { ShareServer } from '../src/core/shareServer.js';
import { findFreePort } from '../src/core/ports.js';
import { copyCoreSanitized, findReleaseLeaks, sanitizedConfig } from '../scripts/core-copy.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'freellm-console-test-'));
}

function ctx(home) {
  return {
    home,
    appData: home,
    platform: process.platform,
    ports: { dashboard: 3001, router: 3002, ollama: 11434 },
    ownerKey: 'freellmapi-owner-test',
    friendKey: 'freellmapi-friend-test',
    dataDir: path.join(home, 'data'),
    coreDir: path.join(home, 'core'),
    mode: 'hybrid',
    modelMode: 'auto',
    pinnedModel: 'auto:code',
  };
}

test('paths: home expansion and core detection', () => {
  const home = tempDir();
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/x'), path.join(os.homedir(), 'x'));
  assert.equal(hasCore(home), false);
  fs.mkdirSync(path.join(home, 'server', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(home, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(home, 'server', 'dist', 'index.js'), '');
  assert.equal(hasCore(home), true);
  const layout = coreLayout(home);
  assert.equal(layout.serverEntry, path.join(home, 'server', 'dist', 'index.js'));
});

test('data layout keeps secrets next to the app data directory', () => {
  const home = tempDir();
  const layout = dataLayout(home, '');
  assert.equal(layout.secretsFile, path.join(home, 'secrets.json'));
  assert.equal(layout.logDir, path.join(home, 'logs'));
});

test('store merges partial config without losing defaults', () => {
  const home = tempDir();
  const layout = dataLayout(home, '');
  fs.writeFileSync(layout.configFile, JSON.stringify({ ports: { router: 4002 } }));
  const store = new Store(layout);
  assert.equal(store.getConfig().ports.router, 4002);
  assert.equal(store.getConfig().ports.dashboard, 3001);
  assert.equal(store.getConfig().stopServicesOnQuit, true);
  store.patchConfig({ mode: 'local' });
  const reloaded = JSON.parse(fs.readFileSync(layout.configFile, 'utf8'));
  assert.equal(reloaded.mode, 'local');
  assert.ok(reloaded.updatedAt);
  assert.equal(DEFAULT_CONFIG.closeToTray, true);
});

test('store writes secrets separately from config', () => {
  const home = tempDir();
  const layout = dataLayout(home, '');
  const store = new Store(layout);
  store.patchConfig({ onboardingComplete: true });
  store.setSecret('ownerKey', 'secret-value');
  assert.equal(store.getSecret('ownerKey'), 'secret-value');
  const config = fs.readFileSync(layout.configFile, 'utf8');
  assert.equal(config.includes('secret-value'), false);
});

test('restrictFile applies a private ACL or 0600 mode', () => {
  const file = path.join(tempDir(), 'secret.txt');
  fs.writeFileSync(file, 'secret');
  restrictFile(file);
  if (process.platform === 'win32') {
    const acl = execFileSync('icacls', [file], { windowsHide: true, encoding: 'utf8' });
    assert.match(acl, /\(M\)/);
  } else {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  fs.rmSync(file, { force: true });
});

test('key helpers produce distinct prefixed tokens and mask safely', () => {
  const a = ownerKey();
  const b = ownerKey();
  assert.match(a, /^freellmapi-[0-9a-f]{48}$/);
  assert.notEqual(a, b);
  assert.match(friendKey(), /^freellmapi-friend-[0-9a-f]{48}$/);
  assert.equal(mask(''), '未配置');
  assert.ok(mask(a).includes('…'));
  assert.equal(timingSafeEqual(a, a), true);
  assert.equal(timingSafeEqual(a, b), false);
});

test('hardware recommendation respects RAM and VRAM tiers', () => {
  assert.equal(recommendLocalModel({ ramGB: 4, gpu: [], diskGB: 100 }).level, 'none');
  assert.equal(recommendLocalModel({ ramGB: 16, gpu: [{ vramGB: 0 }], diskGB: 100 }).model, 'qwen3:14b');
  assert.equal(recommendLocalModel({ ramGB: 32, gpu: [{ vramGB: 16 }], diskGB: 100 }).model, 'gpt-oss:20b');
  assert.equal(recommendLocalModel({ ramGB: 64, gpu: [{ vramGB: 24 }], diskGB: 100 }).model, 'qwen3:30b-a3b');
});

test('CC Switch merge keeps existing providers and adds three FreeLLM entries', () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.cc-switch'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-switch', 'config.json'), JSON.stringify({
    version: 2,
    claude: { providers: { other: { id: 'other' } }, current: 'other' },
    codex: { providers: {}, current: '' },
  }));
  writeCcSwitch(ctx(home));
  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.cc-switch', 'config.json'), 'utf8'));
  assert.ok(cfg.claude.providers.other);
  assert.ok(cfg.claude.providers.freellm);
  assert.ok(cfg.codex.providers['freellm-local']);
  assert.ok(cfg.codex.providers['freellm-smart']);
  assert.equal(cfg.claude.current, 'other');
});

test('CC Switch v3 database receives Claude and Codex providers', () => {
  const require = createRequire(import.meta.url);
  const Database = require('../resources/core/node_modules/better-sqlite3');
  const home = tempDir();
  const dir = path.join(home, '.cc-switch');
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'cc-switch.db');
  const db = new Database(dbFile);
  db.exec(`CREATE TABLE providers (
    id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL,
    settings_config TEXT NOT NULL, website_url TEXT, category TEXT,
    created_at INTEGER, sort_index INTEGER, notes TEXT, icon TEXT,
    icon_color TEXT, meta TEXT NOT NULL DEFAULT '{}',
    is_current BOOLEAN NOT NULL DEFAULT 0,
    in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
    cost_multiplier TEXT NOT NULL DEFAULT '1.0',
    limit_daily_usd TEXT, limit_monthly_usd TEXT, provider_type TEXT,
    PRIMARY KEY (id, app_type)
  )`);
  db.close();

  writeCcSwitch({
    ...ctx(home),
    nodePath: process.execPath,
    coreDir: path.resolve('resources/core'),
  });

  const check = new Database(dbFile, { readonly: true });
  const rows = check.prepare('select id, app_type, settings_config, meta from providers order by app_type, id').all();
  check.close();
  assert.equal(rows.length, 3);
  const claude = rows.find((row) => row.app_type === 'claude');
  assert.equal(claude.id, 'freellm');
  assert.equal(JSON.parse(claude.settings_config).env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:3002');
  const codexSmart = rows.find((row) => row.id === 'freellm-smart');
  assert.match(JSON.parse(codexSmart.settings_config).config, /127\.0\.0\.1:3002\/v1/);
  assert.equal(JSON.parse(codexSmart.meta).apiFormat, 'openai_responses');
  assert.equal(fs.existsSync(path.join(dir, '.freellm')), true);
});

test('EchoBird merge preserves unrelated entries and updates FreeLLM entries', () => {
  const home = tempDir();
  const dir = path.join(home, '.echobird', 'config');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify([
    { internalId: 'mine', name: 'Mine', modelId: 'x' },
    { internalId: 'freellm-auto', name: 'Old', modelId: 'old' },
  ]));
  writeEchoBird(ctx(home));
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8'));
  assert.equal(list.find((item) => item.internalId === 'mine').name, 'Mine');
  assert.equal(list.find((item) => item.internalId === 'freellm-auto').name, 'FreeLLM 自动');
  assert.equal(list.filter((item) => item.internalId === 'freellm-auto').length, 1);
});

test('Continue merge keeps existing models', () => {
  const home = tempDir();
  const dir = path.join(home, '.continue');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    models: [{ title: 'Existing', provider: 'ollama', model: 'x' }],
  }));
  writeContinue(ctx(home));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.equal(cfg.models.length, 2);
  assert.equal(cfg.models[0].title, 'Existing');
  assert.equal(cfg.models[1].apiBase, 'http://127.0.0.1:3002/v1');
});

test('Codex writer creates local and smart profiles with the router URL', () => {
  const home = tempDir();
  writeCodex(ctx(home));
  const local = fs.readFileSync(path.join(home, '.codex', 'freellm.config.toml'), 'utf8');
  const smart = fs.readFileSync(path.join(home, '.codex', 'freellm-smart.config.toml'), 'utf8');
  assert.match(local, /gpt-oss-20b/);
  assert.match(local, /127\.0\.0\.1:3002\/v1/);
  assert.match(smart, /model = "smart"/);
  assert.match(smart, /wire_api = "responses"/);
});

test('catalog keeps both the usable subset and the full directory', () => {
  const home = tempDir();
  const file = path.join(home, 'model-catalog.json');
  fs.writeFileSync(file, JSON.stringify({
    count: 2,
    models: [
      { routeModelId: 'a', displayName: 'A', usableNow: true, chatCapable: true, tags: ['代码'] },
      { routeModelId: 'b', displayName: 'B', usableNow: false, chatCapable: true, tags: ['视觉'] },
    ],
  }));
  const catalog = loadCatalog(file);
  assert.equal(catalog.total, 2);
  assert.equal(catalog.all.length, 2);
  assert.equal(catalog.usable.length, 1);
  assert.equal(catalog.usable[0].id, 'a');
});

test('integration snapshot includes the expanded app catalog', () => {
  const home = tempDir();
  const apps = integrationSnapshot(ctx(home));
  assert.ok(apps.length >= 20);
  assert.ok(apps.some((app) => app.id === 'cursor'));
  assert.ok(apps.some((app) => app.id === 'openwebui'));
  assert.ok(apps.every((app) => app.category));
  assert.ok(apps.find((app) => app.id === 'codex').installCommand.includes('@openai/codex'));
});

test('Pi writer merges a freellm provider into ~/.pi/agent/models.json', () => {
  const home = tempDir();
  const file = path.join(home, '.pi', 'agent', 'models.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ providers: { other: { baseUrl: 'http://x' } } }));
  writePi(ctx(home));
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(cfg.providers.other);
  assert.equal(cfg.providers.freellm.baseUrl, 'http://127.0.0.1:3002/v1');
  assert.equal(cfg.providers.freellm.api, 'openai-completions');
  assert.equal(cfg.providers.freellm.models[0].id, 'auto:code');
  assert.ok(cfg.providers.freellm.models.some((model) => model.id === 'auto'));
  const auth = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'auth.json'), 'utf8'));
  assert.equal(auth.freellm.type, 'api_key');
  assert.equal(auth.freellm.key.length > 10, true);
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
  assert.equal(settings.defaultProvider, 'freellm');
  assert.equal(settings.defaultModel, 'auto:code');
});

test('manual model mode is written into Codex, Continue and Pi defaults', () => {
  const home = tempDir();
  const manual = { ...ctx(home), modelMode: 'manual', pinnedModel: 'glm-5.3-flash' };
  writeCodex(manual);
  writeContinue(manual);
  writePi(manual);
  const smart = fs.readFileSync(path.join(home, '.codex', 'freellm-smart.config.toml'), 'utf8');
  const cont = JSON.parse(fs.readFileSync(path.join(home, '.continue', 'config.json'), 'utf8'));
  const piSettings = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
  assert.match(smart, /model = "glm-5\.3-flash"/);
  assert.equal(cont.models[0].model, 'glm-5.3-flash');
  assert.equal(piSettings.defaultModel, 'glm-5.3-flash');
});

test('backup listing and restore round-trip a managed config', () => {
  const home = tempDir();
  const target = backupTargets(home).find((item) => item.id === 'pi');
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, 'current');
  const backup = `${target.file}.freellm-backup-2026-10-18T00-00-00-000Z`;
  fs.writeFileSync(backup, 'previous');
  const backups = listBackups(home);
  assert.equal(backups.length, 1);
  const result = restoreBackup(home, { targetId: target.id, backup });
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(target.file, 'utf8'), 'previous');
  assert.ok(fs.readdirSync(path.dirname(target.file)).some((name) => name.includes('pre-restore')));
});

test('backup labels keep the date intact and format the clock', () => {
  const home = tempDir();
  const target = backupTargets(home).find((item) => item.id === 'pi');
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  const backup = `${target.file}.freellm-backup-2026-10-18T00-00-00-000Z`;
  fs.writeFileSync(backup, 'previous');
  const item = listBackups(home).find((entry) => entry.backup === backup);
  assert.equal(item.label, '2026-10-18 00:00:00');
});

test('release core copy strips keys, databases and personal files', () => {
  const source = tempDir();
  const target = path.join(tempDir(), 'core');
  fs.mkdirSync(path.join(source, 'server', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(source, 'server', 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(source, 'server', 'data'), { recursive: true });
  fs.mkdirSync(path.join(source, 'client', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(source, 'server', 'dist', 'index.js'), 'export {};');
  fs.writeFileSync(path.join(source, 'server', 'data', 'freeapi.db'), 'secret-db');
  fs.writeFileSync(path.join(source, 'UNIFIED_API_KEY.txt'), 'freellmapi-owner-secret');
  fs.writeFileSync(path.join(source, 'friend-key.txt'), 'freellmapi-friend-secret');
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"core"}');
  fs.writeFileSync(path.join(source, 'freeapi.config.json'), JSON.stringify({
    keys: { openai: 'sk-secret' },
    customProviders: [{ label: 'local', apiKey: 'no-key' }, { label: 'paid', apiKey: 'sk-secret' }],
  }));

  copyCoreSanitized(source, target);

  assert.equal(fs.existsSync(path.join(target, 'UNIFIED_API_KEY.txt')), false);
  assert.equal(fs.existsSync(path.join(target, 'friend-key.txt')), false);
  assert.equal(fs.existsSync(path.join(target, 'server', 'data')), false);
  assert.equal(fs.existsSync(path.join(target, 'LICENSE')), true);
  const config = JSON.parse(fs.readFileSync(path.join(target, 'freeapi.config.json'), 'utf8'));
  assert.equal('keys' in config, false);
  assert.equal(config.customProviders[0].apiKey, 'no-key');
  assert.equal('apiKey' in config.customProviders[1], false);
  assert.deepEqual(findReleaseLeaks(target), []);
});

test('sanitizedConfig never returns provider secrets', () => {
  const file = path.join(tempDir(), 'freeapi.config.json');
  fs.writeFileSync(file, JSON.stringify({ customProviders: [{ apiKey: 'sk-live', key: 'x', token: 'y' }] }));
  const config = sanitizedConfig(file);
  assert.deepEqual(config.customProviders[0], {});
});

test('restore rejects a backup outside the managed target directory', () => {
  const home = tempDir();
  const target = backupTargets(home).find((item) => item.id === 'ccswitch');
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, 'current');
  const rogue = path.join(home, 'rogue.freellm-backup-x');
  fs.writeFileSync(rogue, 'evil');
  assert.throws(() => restoreBackup(home, { targetId: target.id, backup: rogue }));
});

test('install specs generate safe, explicit commands', () => {
  const codex = installSpec('codex');
  assert.equal(codex.kind, 'npm');
  assert.match(installCommand(codex), /npm install -g @openai\/codex/);
  assert.equal(installSpec('not-a-real-app'), null);
  assert.match(installCommand({ kind: 'winget', id: 'Vendor.App' }), /winget install --id Vendor\.App/);
  assert.match(installCommand({ kind: 'code', ext: 'Publisher.Extension' }), /code --install-extension Publisher\.Extension/);
});

test('friend portal serves a read-only page, info, key and /v1 proxy', async () => {
  const home = tempDir();
  const layout = dataLayout(home, '');
  const store = new Store(layout);
  fs.writeFileSync(path.join(home, 'model-catalog.json'), JSON.stringify({
    count: 1,
    models: [{ routeModelId: 'auto', displayName: 'Auto', usableNow: true, chatCapable: true, tags: ['代码'] }],
  }));
  const routerPort = await findFreePort(39100);
  const router = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url }));
  });
  await new Promise((resolve) => router.listen(routerPort, '127.0.0.1', resolve));
  const sharePort = await findFreePort(routerPort + 1);
  const share = new ShareServer({
    layout,
    store,
    routerPort,
    port: sharePort,
    coreDir: home,
    getPublicUrl: () => '',
    getFriendKey: () => 'freellmapi-friend-test',
  });
  await share.start();
  try {
    const page = await fetch(share.localUrl());
    assert.equal(page.status, 200);
    assert.match(await page.text(), /FreeLLM 朋友入口/);
    const info = await (await fetch(`${share.localUrl()}/info`)).json();
    assert.match(info.apiBase, /\/v1$/);
    assert.equal(info.models.length, 1);
    const key = await (await fetch(`${share.localUrl()}/key`)).json();
    assert.equal(key.key, 'freellmapi-friend-test');
    const proxy = await (await fetch(`http://127.0.0.1:${sharePort}/v1/models`)).json();
    assert.equal(proxy.path, '/v1/models');
    const blocked = await fetch(`http://127.0.0.1:${sharePort}/api/ping`);
    assert.equal(blocked.status, 404);
  } finally {
    await share.stop();
    await new Promise((resolve) => router.close(resolve));
  }
});

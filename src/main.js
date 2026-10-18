import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, clipboard, dialog, shell, nativeTheme } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataLayout, resolveCoreDir, resolveNode, resolveRouter, coreLayout, safeUrl, isWindows, isMac, ensureDir } from './core/paths.js';
import { Store } from './core/store.js';
import { detectSystem } from './core/hardware.js';
import { ServiceManager } from './core/services.js';
import { TunnelManager } from './core/tunnel.js';
import { AppState } from './core/appState.js';
import { spawnLogged } from './core/process.js';
import { listBackups, restoreBackup, restoreLatest } from './core/backups.js';
import { installSpec, installCommand } from './core/installers.js';
import { ShareServer } from './core/shareServer.js';
import { resolveWorkbench, readRecentProjects, launchWorkbench } from './core/workbench.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

// Portable builds must switch userData before requesting the single-instance
// lock, otherwise the packaged app and a dev checkout share one lock path and
// the second process exits silently.
const exeDir = path.dirname(process.execPath);
const isPortable = app.isPackaged && fs.existsSync(path.join(exeDir, 'portable.txt'));
const dataArgIndex = process.argv.findIndex((value) => value === '--data-dir' || value.startsWith('--data-dir='));
const dataArg = dataArgIndex >= 0
  ? (process.argv[dataArgIndex].includes('=')
    ? process.argv[dataArgIndex].split('=').slice(1).join('=')
    : process.argv[dataArgIndex + 1] || '')
  : '';
const dataOverride = process.env.FREELLM_DATA_DIR || dataArg;
if (dataOverride) {
  const resolved = path.resolve(dataOverride);
  fs.mkdirSync(resolved, { recursive: true });
  app.setPath('userData', resolved);
} else if (isPortable) {
  app.setPath('userData', path.join(exeDir, 'data'));
}
app.setName('FreeLLM Console');

let mainWindow = null;
let tray = null;
let quitting = false;
let booting = true;
let systemReport = null;
let store;
let services;
let tunnel;
let shareServer;
let state;
let coreDir = '';
let core = null;
let nodePath = '';
let routerPath = '';
let appLog = '';

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((value) => (
    value instanceof Error ? value.stack : typeof value === 'string' ? value : JSON.stringify(value)
  )).join(' ')}\n`;
  try {
    if (appLog) {
      fs.mkdirSync(path.dirname(appLog), { recursive: true });
      fs.appendFileSync(appLog, line);
    }
  } catch {}
  console.log(line.trim());
}

function portableRoot() {
  return isPortable && !dataOverride ? path.join(exeDir, 'data') : '';
}

function resourcesPath() {
  return app.isPackaged ? process.resourcesPath : path.join(appRoot, 'resources');
}

function iconPath(name = 'icon.png') {
  const candidates = [
    path.join(resourcesPath(), 'assets', name),
    path.join(appRoot, 'assets', name),
  ];
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function windowIcon() {
  const file = iconPath(isWindows ? 'icon.png' : 'icon.png');
  return file ? nativeImage.createFromPath(file) : undefined;
}

const ok = (value) => ({ ok: true, ...(value || {}) });
const fail = (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) });
const wrap = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (error) {
    console.error('[ipc]', error);
    return fail(error);
  }
};

function reinitServices() {
  coreDir = resolveCoreDir({
    configured: store.getConfig().coreDir,
    resourcesPath: resourcesPath(),
  });
  core = coreLayout(coreDir);
  routerPath = resolveRouter({ resourcesPath: resourcesPath() });
  nodePath = resolveNode({ resourcesPath: resourcesPath() });
  if (services) services.setCore(coreDir, core);
  if (state) {
    state.coreDir = coreDir;
    state.core = core;
  }
}

function createWindow() {
  const cfg = store.getConfig();
  const bounds = cfg.window || {};
  const light = cfg.theme === 'light';
  mainWindow = new BrowserWindow({
    width: bounds.width || 1280,
    height: bounds.height || 820,
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    minWidth: 1040,
    minHeight: 680,
    show: true,
    backgroundColor: light ? '#F3F1EA' : '#0E1114',
    title: 'FreeLLM Console',
    icon: windowIcon(),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(appRoot, 'src', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  log('createWindow', { appRoot, bounds });
  mainWindow.loadFile(path.join(appRoot, 'renderer', 'index.html'));
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => log('did-fail-load', code, description));
  mainWindow.webContents.on('render-process-gone', (_event, details) => log('render-process-gone', details));
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => log('preload-error', preloadPath, error));
  mainWindow.once('ready-to-show', () => {
    log('ready-to-show');
    if (bounds.maximized) mainWindow.maximize();
    mainWindow.show();
  });

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const current = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    store.patchConfig({
      window: {
        width: current.width,
        height: current.height,
        x: current.x,
        y: current.y,
        maximized: mainWindow.isMaximized(),
      },
    });
  };
  mainWindow.on('resize', debounce(persistBounds, 400));
  mainWindow.on('move', debounce(persistBounds, 400));
  mainWindow.on('close', (event) => {
    log('window close', { quitting, closeToTray: store.getConfig().closeToTray });
    persistBounds();
    if (!quitting && store.getConfig().closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    log('window closed');
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const safe = safeUrl(url);
    if (safe) shell.openExternal(safe);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function applyAutostart(enabled) {
  if (isMac || isWindows) {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: false });
    return;
  }
  try {
    const file = path.join(os.homedir(), '.config', 'autostart', 'freellm-console.desktop');
    if (!enabled) {
      fs.rmSync(file, { force: true });
      return;
    }
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=FreeLLM Console\nExec="${process.execPath}"\nX-GNOME-Autostart-enabled=true\n`, 'utf8');
  } catch {}
}

function trayImage() {
  const file = iconPath('tray.png');
  if (file) {
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return nativeImage.createEmpty();
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('FreeLLM Console');
  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: '打开控制台', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: 'separator' },
      { label: '启动全部服务', click: () => services.startAll().then(() => broadcastState()) },
      { label: '停止全部服务', click: () => services.stopAll().then(() => broadcastState()) },
      { type: 'separator' },
      { label: '复制 OpenAI 地址', click: () => clipboard.writeText(`http://127.0.0.1:${store.getConfig().ports.router}/v1`) },
      { label: '复制 Owner Key', click: () => clipboard.writeText(services.readOwnerKey()) },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
  };
  rebuild();
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
  tray.on('right-click', rebuild);
}

async function broadcastState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const snapshot = await state.snapshot();
    mainWindow.webContents.send('app:state', snapshot);
  } catch {}
}

function launchApp(id) {
  const cfg = store.getConfig();
  const key = services.readOwnerKey();
  const terminal = (command) => {
    if (isWindows) {
      spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', command], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        env: { ...process.env, FREELLM_API_KEY: key },
      }).unref();
    } else if (isMac) {
      const escaped = command.replace(/"/g, '\\"');
      spawn('osascript', ['-e', `tell application "Terminal" to do script "${escaped}"`], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('x-terminal-emulator', ['-e', 'bash', '-lc', command], { detached: true, stdio: 'ignore' }).unref();
    }
  };
  switch (id) {
    case 'dashboard': shell.openExternal(`http://127.0.0.1:${cfg.ports.dashboard}`); break;
    case 'codex-local': terminal('codex --profile freellm'); break;
    case 'codex-smart': terminal('codex --profile freellm-smart'); break;
    case 'claude': terminal(isWindows
      ? `"${path.join(os.homedir(), '.freellm', 'claude-freellm.cmd')}"`
      : `"${path.join(os.homedir(), '.freellm', 'claude-freellm.sh')}"`); break;
    case 'aider': terminal(isWindows
      ? `"${path.join(os.homedir(), '.freellm', 'aider-freellm.cmd')}"`
      : `"${path.join(os.homedir(), '.freellm', 'aider-freellm.sh')}"`); break;
    case 'pi': terminal('pi'); break;
    case 'pi-workbench': launchWorkbench(); break;
    case 'opencode': terminal('opencode'); break;
    case 'goose': terminal('goose'); break;
    case 'qwen': terminal('qwen'); break;
    case 'crush': terminal('crush'); break;
    case 'amp': terminal('amp'); break;
    case 'gemini': terminal('gemini'); break;
    case 'cline': shell.openExternal('vscode://saoudrizwan.claude-dev'); break;
    case 'cherry': {
      const candidates = [
        path.join(process.env.APPDATA || '', 'CherryStudio'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CherryStudio', 'CherryStudio.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'CherryStudio', 'CherryStudio.exe'),
        'D:\\CherryStudio\\CherryStudio.exe',
        '/Applications/Cherry Studio.app',
      ];
      const found = candidates.find((item) => fs.existsSync(item));
      if (found) shell.openPath(found);
      break;
    }
    default:
      return false;
  }
  return true;
}

function registerIpc() {
  ipcMain.handle('app:state', wrap(() => state.snapshot()));
  ipcMain.handle('app:refresh-system', wrap(async () => {
    systemReport = await detectSystem({ dataDir: store.layout.dataDir, ports: store.getConfig().ports });
    state.system = systemReport;
    return systemReport;
  }));
  ipcMain.handle('app:start-all', wrap(async () => {
    const result = await services.startAll();
    await broadcastState();
    return result;
  }));
  ipcMain.handle('app:stop-all', wrap(async () => {
    const result = await services.stopAll();
    await broadcastState();
    return result;
  }));
  ipcMain.handle('app:service', wrap(async (_event, name, action) => {
    if (!['server', 'router', 'ollama'].includes(name)) throw new Error('未知服务');
    const result = action === 'stop'
      ? await services.stop(name)
      : name === 'server'
        ? await services.startServer()
        : name === 'router'
          ? await services.startRouter()
          : await services.startOllama();
    await broadcastState();
    return result;
  }));
  ipcMain.handle('app:test-route', wrap((_event, payload) => state.testRoute(payload || {})));
  ipcMain.handle('app:quotas', wrap(() => state.quotas()));
  ipcMain.handle('app:sync-catalog', wrap(() => state.syncCatalog()));
  ipcMain.handle('app:add-module', wrap((_event, input) => state.addModule(input)));
  ipcMain.handle('app:remove-module', wrap((_event, id) => state.removeModule(String(id))));
  ipcMain.handle('app:pull-model', wrap((_event, model) => services.pullModel(model)));
  ipcMain.handle('app:set-model', wrap((_event, payload) => {
    const result = state.setModel(payload || {});
    broadcastState();
    return result;
  }));
  ipcMain.handle('app:backups', wrap(() => listBackups(os.homedir())));
  ipcMain.handle('app:restore-backup', wrap((_event, payload) => restoreBackup(os.homedir(), {
    targetId: String(payload?.targetId || ''),
    backup: String(payload?.backup || ''),
  })));
  ipcMain.handle('app:restore-latest', wrap((_event, targetId) => (
    targetId
      ? { ok: true, ...restoreLatest(os.homedir(), String(targetId)) }
      : { ok: true, results: restoreLatest(os.homedir()) }
  )));
  ipcMain.handle('app:stop-and-restore', wrap(async () => {
    await services.stopAll();
    const results = restoreLatest(os.homedir());
    await broadcastState();
    return { ok: true, results };
  }));
  ipcMain.handle('app:write-integrations', wrap((_event, targets) => {
    const result = state.writeIntegrations(targets);
    broadcastState();
    return result;
  }));
  ipcMain.handle('app:snippet', wrap((_event, id) => state.snippet(id)));
  ipcMain.handle('app:copy', wrap((_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  }));
  ipcMain.handle('app:reveal', wrap((_event, type) => ({
    value: type === 'friend' ? services.readFriendKey() : services.readOwnerKey(),
  })));
  ipcMain.handle('app:regenerate-friend', wrap(async () => {
    const result = state.regenerateFriendKey();
    await services.stop('router');
    await services.startRouter();
    await broadcastState();
    return result;
  }));
  ipcMain.handle('app:set-owner', wrap((_event, value) => {
    const result = state.setOwnerKey(value);
    broadcastState();
    return result;
  }));
  ipcMain.handle('app:tunnel', wrap(async (_event, action) => {
    const result = action === 'stop' ? await tunnel.stop() : await tunnel.start();
    store.patchConfig({ publicTunnel: action !== 'stop' });
    broadcastState();
    return result;
  }));
  ipcMain.handle('app:share-info', wrap(() => state.shareInfo()));
  ipcMain.handle('app:share-enable', wrap(async (_event, enabled) => {
    store.patchConfig({ shareEnabled: Boolean(enabled) });
    if (enabled) {
      shareServer.host = store.getConfig().shareLan ? '0.0.0.0' : '127.0.0.1';
      await shareServer.start();
    } else {
      if (tunnel?.status().running) await tunnel.stop();
      await shareServer.stop();
    }
    await broadcastState();
    return { ok: true, enabled: Boolean(enabled) };
  }));
  ipcMain.handle('app:share-lan', wrap(async (_event, enabled) => {
    if (!store.getConfig().shareEnabled) throw new Error('先启用朋友网页');
    store.patchConfig({ shareLan: Boolean(enabled) });
    await shareServer?.restart(enabled ? '0.0.0.0' : '127.0.0.1');
    await broadcastState();
    return { ok: true, lan: Boolean(enabled) };
  }));
  ipcMain.handle('app:share-open', wrap(async () => {
    const info = state.shareInfo();
    const url = info.publicUrl || info.localUrl;
    if (!url) throw new Error('朋友入口尚未就绪');
    await shell.openExternal(url);
    return { ok: true, url };
  }));
  ipcMain.handle('app:share-package', wrap(() => {
    const info = state.shareInfo();
    return { ok: true, text: info.packageText || '' };
  }));
  ipcMain.handle('app:save-settings', wrap(async (_event, patch) => {
    const allowed = {};
    for (const key of ['mode', 'autostart', 'closeToTray', 'stopServicesOnQuit', 'lanShare', 'shareLan', 'shareEnabled', 'autoStartServices', 'theme', 'accent', 'language', 'catalogMode', 'modelMode', 'pinnedModel', 'feedbackGroup']) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
    }
    if (patch?.ports) {
      allowed.ports = {};
      for (const key of ['dashboard', 'router', 'ollama', 'share']) {
        const value = Number(patch.ports[key]);
        if (value >= 1024 && value <= 65535) allowed.ports[key] = value;
      }
    }
    if (patch?.local) {
      const local = patch.local;
      const clamp = (value, min, max, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
      };
      allowed.local = {
        ollamaPath: String(local.ollamaPath || '').slice(0, 500),
        modelsDir: String(local.modelsDir || '').slice(0, 500),
        context: clamp(local.context, 2048, 262144, 16384),
        parallel: clamp(local.parallel, 1, 4, 1),
        maxLoaded: clamp(local.maxLoaded, 1, 2, 1),
        keepAlive: /^(0|\d+[smh])$/.test(String(local.keepAlive || '')) ? String(local.keepAlive) : '2m',
        privacyModel: String(local.privacyModel || '').slice(0, 120),
        profile: ['memory', 'balanced', 'quality'].includes(local.profile) ? local.profile : 'balanced',
      };
    }
    store.patchConfig(allowed);
    if (Object.prototype.hasOwnProperty.call(allowed, 'autostart')) applyAutostart(allowed.autostart);
    if (['system', 'light', 'dark'].includes(allowed.theme)) nativeTheme.themeSource = allowed.theme;
    await broadcastState();
    return { ok: true, ...store.getConfig() };
  }));
  ipcMain.handle('app:choose-core', wrap(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 FreeLLMAPI 安装目录',
      properties: ['openDirectory'],
      defaultPath: coreDir || os.homedir(),
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const chosen = result.filePaths[0];
    if (!fs.existsSync(path.join(chosen, 'server', 'dist', 'index.js'))) {
      throw new Error('这个目录里没有 server/dist/index.js，不是有效的 FreeLLMAPI 安装目录。');
    }
    store.patchConfig({ coreDir: chosen });
    reinitServices();
    await broadcastState();
    return { ok: true, coreDir: chosen };
  }));
  ipcMain.handle('app:launch', wrap((_event, id) => ({ ok: launchApp(String(id)) })));
  ipcMain.handle('app:open-integration-ui', wrap(async (_event, id) => {
    const target = String(id);
    if (target === 'cline') {
      try {
        await shell.openExternal('vscode://command/cline.settingsButtonClicked');
        return { ok: true, method: 'cline-settings' };
      } catch {
        await shell.openExternal('vscode://saoudrizwan.claude-dev');
        return { ok: true, method: 'cline-extension' };
      }
    }
    if (target === 'cherry') {
      const candidates = [
        'D:\\CherryStudio\\CherryStudio.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CherryStudio', 'CherryStudio.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'CherryStudio', 'CherryStudio.exe'),
        path.join(process.env.APPDATA || '', 'CherryStudio'),
        '/Applications/Cherry Studio.app',
      ];
      const found = candidates.find((item) => fs.existsSync(item));
      if (found) {
        const actual = found.endsWith('.exe') || found.endsWith('.app') ? found : path.join(found, 'CherryStudio.exe');
        if (!fs.existsSync(actual)) return { ok: false, error: '找到了 Cherry Studio 数据目录，但没有找到启动程序。' };
        await shell.openPath(actual);
        return { ok: true, method: 'cherry-app' };
      }
      return { ok: false, error: '没有找到 Cherry Studio，可先点“安装 / 官网”。' };
    }
    return { ok: false, error: '这个软件没有可自动打开的设置页。' };
  }));
  ipcMain.handle('app:workbench-info', wrap(() => ({
    ok: true,
    exe: resolveWorkbench(),
    recent: readRecentProjects(),
  })));
  ipcMain.handle('app:workbench-launch', wrap((_event, project) => launchWorkbench(project ? String(project) : '')));
  ipcMain.handle('app:workbench-choose', wrap(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Pi 工作台项目目录',
      properties: ['openDirectory'],
      defaultPath: os.homedir(),
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return launchWorkbench(result.filePaths[0]);
  }));
  ipcMain.handle('app:open-pi-config', wrap(() => shell.openPath(path.join(os.homedir(), '.pi', 'agent'))));
  ipcMain.handle('app:install-app', wrap((_event, id) => runInstall(String(id))));
  ipcMain.handle('app:install-many', wrap(async (_event, ids) => {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)))];
    const results = [];
    for (let index = 0; index < list.length; index++) {
      const id = list[index];
      const spec = installSpec(id);
      try {
        mainWindow?.webContents.send('app:install-status', {
          id,
          state: 'starting',
          index: index + 1,
          total: list.length,
          label: spec?.label || id,
        });
        results.push({ id, ...(await runInstall(id)) });
      } catch (error) {
        results.push({ id, ok: false, error: error.message });
        mainWindow?.webContents.send('app:install-status', {
          id,
          state: 'failed',
          index: index + 1,
          total: list.length,
          label: spec?.label || id,
          error: error.message,
        });
      }
    }
    return { ok: true, results };
  }));
  ipcMain.handle('app:open-external', wrap((_event, url) => {
    const safe = safeUrl(url);
    if (!safe) throw new Error('只允许打开 http/https 地址');
    return shell.openExternal(safe);
  }));
  ipcMain.handle('app:open-mailto', wrap((_event, url) => {
    const value = String(url || '');
    if (!/^mailto:/i.test(value)) throw new Error('只允许 mailto 链接');
    return shell.openExternal(value);
  }));
  ipcMain.handle('app:open-path', wrap((_event, target) => shell.openPath(String(target || ''))));
  ipcMain.handle('app:logs', wrap((_event, name, lines) => services.logs(String(name || 'router'), Number(lines) || 160)));
  ipcMain.handle('app:onboarding', wrap(async (_event, payload) => {
    const patch = {
      onboardingComplete: true,
      mode: ['cloud', 'hybrid', 'local'].includes(payload?.mode) ? payload.mode : store.getConfig().mode,
    };
    if (payload?.coreDir) patch.coreDir = payload.coreDir;
    store.patchConfig(patch);
    reinitServices();
    const start = payload?.start !== false;
    if (start) await services.startAll();
    await broadcastState();
    return { ok: true };
  }));
}

const AUTO_CONFIG_APPS = new Set(['codex', 'claude', 'ccswitch', 'echobird', 'continue', 'pi', 'aider']);

async function runInstall(appId) {
  const spec = installSpec(appId);
  if (!spec) throw new Error('当前系统没有可用的自动安装方式，请使用官网安装。');
  const command = installCommand(spec);
  const executable = isWindows ? 'cmd.exe' : 'sh';
  const args = isWindows ? ['/d', '/s', '/c', command] : ['-lc', command];
  const child = spawnLogged(executable, args, {
    env: { ...process.env },
    logFile: path.join(store.layout.logDir, 'install.log'),
  });
  const code = await new Promise((resolve) => {
    child.once('exit', (value) => resolve(value));
    child.once('error', () => resolve(-1));
  });
  let configured = false;
  if (code === 0 && AUTO_CONFIG_APPS.has(appId)) {
    try {
      const result = state.writeIntegrations([appId]);
      configured = Boolean(result[appId]?.ok);
    } catch {}
  }
  try {
    mainWindow?.webContents.send('app:install-status', {
      id: appId,
      code,
      state: code === 0 ? 'done' : 'failed',
      configured,
      label: spec.label,
    });
  } catch {}
  await broadcastState();
  return { ok: code === 0, code, configured, label: spec.label, command };
}

async function boot() {
  app.setAppUserModelId('com.freellm.console');
  const layout = dataLayout(app.getPath('userData'), portableRoot());
  appLog = path.join(layout.logDir, 'app.log');
  log('boot', { version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), coreDir, nodePath, routerPath });
  store = new Store(layout);
  store.layout = layout;
  nativeTheme.themeSource = ['system', 'light', 'dark'].includes(store.getConfig().theme)
    ? store.getConfig().theme
    : 'system';
  reinitServices();

  services = new ServiceManager({
    layout,
    store,
    coreDir,
    core,
    routerPath,
    nodePath,
    getConfig: () => store.getConfig(),
    onChange: debounce(() => broadcastState(), 250),
  });
  const sharePort = store.getConfig().ports.share || 3004;
  shareServer = new ShareServer({
    layout,
    store,
    routerPort: store.getConfig().ports.router,
    port: sharePort,
    coreDir,
    getPublicUrl: () => tunnel.currentUrl(),
    getFriendKey: () => services.readFriendKey(),
  });
  shareServer.host = store.getConfig().shareLan ? '0.0.0.0' : '127.0.0.1';
  if (store.getConfig().shareEnabled) {
    await shareServer.start().catch((error) => log('share server failed', error));
  }
  tunnel = new TunnelManager({
    layout,
    port: sharePort,
    getTargetPort: () => store.getConfig().shareEnabled ? sharePort : store.getConfig().ports.router,
    coreDir,
    resourcesPath: resourcesPath(),
    onChange: debounce(() => broadcastState(), 250),
  });
  state = new AppState({
    layout,
    store,
    services,
    tunnel,
    share: shareServer,
    system: null,
    coreDir,
    core,
    appVersion: app.getVersion(),
    resourcesPath: resourcesPath(),
  });

  registerIpc();
  log('ipc registered');
  applyAutostart(store.getConfig().autostart);
  createWindow();
  log('window created');
  createTray();
  log('tray created');

  detectSystem({ dataDir: layout.dataDir, ports: store.getConfig().ports })
    .then((report) => {
      systemReport = report;
      state.system = report;
      broadcastState();
    })
    .catch(() => {});

  mainWindow.webContents.once('did-finish-load', async () => {
    booting = false;
    broadcastState();
    if (store.getConfig().onboardingComplete && store.getConfig().autoStartServices !== false) {
      await services.startAll().catch(() => {});
      await broadcastState();
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    boot().catch((error) => {
      log('boot failed', error);
      dialog.showErrorBox('FreeLLM Console 启动失败', String(error?.stack || error));
      app.quit();
    });
    app.on('activate', () => {
      if (!mainWindow) createWindow();
      else mainWindow.show();
    });
  });
}

app.on('before-quit', (event) => {
  log('before-quit');
  quitting = true;
  if (!booting && store?.getConfig().stopServicesOnQuit !== false) {
    try { tunnel?.child?.kill(); } catch {}
    try { shareServer?.stop(); } catch {}
    services?.dispose();
    tunnel?.stop().catch(() => {});
  }
});

app.on('window-all-closed', () => {
  log('window-all-closed', { closeToTray: store?.getConfig().closeToTray });
  if (!isMac && !store?.getConfig().closeToTray) app.quit();
});

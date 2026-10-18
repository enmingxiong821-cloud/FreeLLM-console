const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

let appState = null;
let currentView = 'overview';
let modelQuery = '';
let modelFilter = 'all';
let lastTest = null;
let logTab = 'router';
let toastTimer = null;
let modalText = '';
let onboardBusy = false;
let connectCategory = '全部';
let connectStatus = 'all';
let quotaState = null;
let quotaLoading = false;
let backupState = null;
let workbenchState = null;
let localModelFilter = 'all';
let localModelQuery = '';
let paletteIndex = 0;
let settingsScrollHandler = null;

function applyAppearance() {
  const cfg = appState?.config || {};
  const systemLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const theme = cfg.theme === 'system' ? (systemLight ? 'light' : 'dark') : (cfg.theme || 'dark');
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = cfg.accent || 'amber';
  document.documentElement.lang = cfg.language === 'en-US' ? 'en-US' : 'zh-CN';
  document.body.dataset.lang = cfg.language || 'zh-CN';
}

window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  if (appState?.config?.theme === 'system') applyAppearance();
});

const onboard = {
  step: 0,
  mode: 'hybrid',
  selected: new Set(['codex', 'claude', 'ccswitch', 'echobird', 'continue']),
  checks: [],
};

const views = {
  overview: { kicker: '控制台', enKicker: 'CONTROL DESK', title: '总览', en: 'Overview' },
  connect: { kicker: '接入中心', enKicker: 'PATCH BAY', title: '软件接入', en: 'Connections' },
  models: { kicker: '模型库', enKicker: 'MODEL RACK', title: '模型库', en: 'Models' },
  share: { kicker: '公网入口', enKicker: 'PUBLIC EDGE', title: '分享与公网', en: 'Share' },
  settings: { kicker: '服务设置', enKicker: 'SERVICE BAY', title: '设置与日志', en: 'Settings' },
  workbench: { kicker: 'Pi 工作台', enKicker: 'PI WORKBENCH', title: 'Pi 工作台', en: 'Workbench' },
  localmodels: { kicker: '开源模型', enKicker: 'OPEN WEIGHTS', title: '开源模型', en: 'Local Models' },
};

const navLabels = {
  overview: ['总览', 'Overview'],
  connect: ['软件接入', 'Connections'],
  models: ['模型库', 'Models'],
  share: ['分享与公网', 'Share'],
  settings: ['设置与日志', 'Settings'],
  workbench: ['Pi 工作台', 'Workbench'],
  localmodels: ['开源模型', 'Local Models'],
};

function toast(message, bad = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('is-bad', bad);
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
}

const viewOrder = ['overview', 'connect', 'models', 'share', 'settings', 'workbench', 'localmodels'];

function paletteCommands() {
  return [
    { id: 'nav-overview', label: '转到总览', hint: 'Ctrl+1', run: () => switchView('overview') },
    { id: 'nav-connect', label: '转到软件接入', hint: 'Ctrl+2', run: () => switchView('connect') },
    { id: 'nav-models', label: '转到模型库', hint: 'Ctrl+3', run: () => switchView('models') },
    { id: 'nav-share', label: '转到分享与公网', hint: 'Ctrl+4', run: () => switchView('share') },
    { id: 'nav-settings', label: '转到设置', hint: 'Ctrl+5', run: () => switchView('settings') },
    { id: 'nav-workbench', label: '转到 Pi 工作台', hint: 'Ctrl+6', run: () => switchView('workbench') },
    { id: 'nav-localmodels', label: '转到开源模型', hint: 'Ctrl+7', run: () => switchView('localmodels') },
    { id: 'power', label: allRunning() ? '停止全部服务' : '启动全部服务', hint: 'Power', run: togglePower },
    { id: 'test', label: '测试一次真实请求', hint: 'auto:code', run: () => { switchView('models'); setTimeout(runTest, 120); } },
    { id: 'sync', label: '同步模型目录', hint: '更新数据', run: async () => { toast('正在检查签名模型目录…'); const r = await window.freeLLM.syncCatalog(); toast(r.ok ? '模型目录已更新' : r.error, !r.ok); await refresh(); } },
    { id: 'mode', label: appState?.config?.modelMode === 'manual' ? '恢复自动路由' : '固定当前模型', hint: '自动/固定', run: async () => { const r = await window.freeLLM.setModel({ mode: appState?.config?.modelMode === 'manual' ? 'auto' : 'manual', model: appState?.config?.pinnedModel || 'auto:code' }); toast(r.ok ? '模型模式已更新' : r.error, !r.ok); await refresh(); } },
    { id: 'workbench', label: '打开 Pi 工作台', hint: '外部应用', run: () => window.freeLLM.launchWorkbench() },
    { id: 'share', label: '打开朋友入口', hint: '只读页面', run: () => window.freeLLM.openShare() },
    { id: 'copy-url', label: '复制 OpenAI 地址', hint: 'Base URL', run: () => copy(appState?.urls?.openai || '', 'OpenAI 地址已复制') },
    { id: 'copy-key', label: '复制 Owner Key', hint: '敏感', run: async () => { const r = await window.freeLLM.reveal('owner'); if (r.value) await copy(r.value, 'Owner Key 已复制'); else toast('还没有 Owner Key', true); } },
    { id: 'feedback', label: '打开关于与反馈', hint: '版本/邮箱/QQ', run: () => { switchView('settings'); setTimeout(() => document.getElementById('sec-feedback')?.scrollIntoView({ behavior: 'smooth' }), 200); } },
  ];
}

function paletteResults() {
  const q = ($('#paletteInput')?.value || '').trim().toLowerCase();
  return paletteCommands().filter((command) => !q || `${command.label} ${command.hint}`.toLowerCase().includes(q));
}

function renderPalette() {
  const items = paletteResults();
  if (paletteIndex >= items.length) paletteIndex = Math.max(0, items.length - 1);
  $('#paletteList').innerHTML = items.map((command, index) => `<button class="palette-item ${index === paletteIndex ? 'is-active' : ''}" data-command="${esc(command.id)}">
    <span class="palette-index">${String(index + 1).padStart(2, '0')}</span>
    <b>${esc(command.label)}</b>
    <span class="palette-hint">${esc(command.hint)}</span>
  </button>`).join('') || '<div style="padding:18px;color:var(--faint);font-size:11px">没有匹配命令</div>';
  $$('.palette-item').forEach((item) => {
    item.onclick = () => runPaletteCommand(item.dataset.command);
  });
}

function openPalette() {
  if (!$('#onboarding').hidden) return;
  $('#palette').hidden = false;
  $('#paletteInput').value = '';
  paletteIndex = 0;
  renderPalette();
  $('#paletteInput').focus();
}

function closePalette() {
  $('#palette').hidden = true;
}

async function runPaletteCommand(id) {
  const command = paletteCommands().find((item) => item.id === id) || paletteResults()[paletteIndex];
  closePalette();
  if (!command) return;
  try {
    await command.run();
  } catch (error) {
    toast(error.message, true);
  }
}

function setupRipple() {
  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest?.('.btn, .icon-btn, .chip, .nav-item, .palette-item, .wb-project, .project-link');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.8;
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    span.style.left = `${event.clientX - rect.left - size / 2}px`;
    span.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.appendChild(span);
    setTimeout(() => span.remove(), 520);
  }, { passive: true });
}

function setupSettingsSpy() {
  const view = $('#viewRoot');
  if (settingsScrollHandler) {
    view?.removeEventListener('scroll', settingsScrollHandler);
    settingsScrollHandler = null;
  }
  const sections = ['sec-general', 'sec-appearance', 'sec-data', 'sec-local', 'sec-logs', 'sec-resources', 'sec-feedback']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!sections.length || !view) return;
  settingsScrollHandler = () => {
    const tabs = document.getElementById('settingsTabs');
    const top = (tabs ? tabs.getBoundingClientRect().bottom : view.getBoundingClientRect().top + 40) + 110;
    let active = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= top) active = section;
    }
    $$('#settingsTabs [data-scroll]').forEach((button) => {
      button.classList.toggle('is-on', button.dataset.scroll === active.id);
    });
  };
  view.addEventListener('scroll', settingsScrollHandler, { passive: true });
}

function initAmbient() {
  const canvas = $('#ambient');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let points = [];
  let accent = [230, 180, 94];
  let pointer = { x: -999, y: -999 };
  let frame = 0;

  const readAccent = () => {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const match = value.match(/^#?([0-9a-f]{6})$/i);
    if (match) accent = [0, 2, 4].map((index) => parseInt(match[1].slice(index, index + 2), 16));
  };

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(24, Math.min(64, Math.floor(width * height / 32000)));
    points = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
      r: Math.random() * 1.3 + 0.5,
    }));
    draw();
  };

  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    const [r, g, b] = accent;
    for (const point of points) {
      const dx = point.x - pointer.x;
      const dy = point.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 150) {
        point.x += dx / distance * 0.12;
        point.y += dy / distance * 0.12;
      }
      if (!reduced) {
        point.x += point.vx;
        point.y += point.vy;
      }
      if (point.x < -20) point.x = width + 20;
      if (point.x > width + 20) point.x = -20;
      if (point.y < -20) point.y = height + 20;
      if (point.y > height + 20) point.y = -20;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${r},${g},${b},${point.r > 1.2 ? 0.5 : 0.28})`;
      ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b2 = points[j];
        const distance = Math.hypot(a.x - b2.x, a.y - b2.y);
        if (distance < 95) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - distance / 95) * 0.08})`;
          ctx.lineWidth = 0.6;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.stroke();
        }
      }
    }
  };

  const loop = () => {
    frame++;
    if (frame % 120 === 0) readAccent();
    if (!reduced) draw();
    requestAnimationFrame(loop);
  };

  window.addEventListener('resize', resize);
  document.addEventListener('pointermove', (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    const panel = event.target.closest?.('.panel');
    if (panel) {
      const rect = panel.getBoundingClientRect();
      panel.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      panel.style.setProperty('--my', `${event.clientY - rect.top}px`);
    }
  }, { passive: true });
  readAccent();
  resize();
  if (!reduced) requestAnimationFrame(loop);
}

function showModal(title, text) {
  modalText = text;
  $('#modalTitle').textContent = title;
  $('#modalBody').textContent = text;
  $('#modal').hidden = false;
}

async function copy(text, message = '已复制') {
  const result = await window.freeLLM.copy(text);
  toast(result.ok ? message : result.error, !result.ok);
}

function stateServices() {
  return appState?.services || {};
}

function allRunning() {
  const s = stateServices();
  return Boolean(s.server?.running && s.router?.running);
}

function serviceLabel(service) {
  if (!service) return { text: '未知', cls: '' };
  if (service.running) return { text: service.external ? '已在运行' : '运行中', cls: 'ok' };
  if (service.error) return { text: '需要处理', cls: 'bad' };
  return { text: '未启动', cls: '' };
}

function renderChrome() {
  if (!appState) return;
  applyAppearance();
  const cfg = appState.config || {};
  const english = cfg.language === 'en-US';
  const bilingual = cfg.language === 'bilingual';
  const kicker = views[currentView]?.kicker || '控制台';
  const enKicker = views[currentView]?.enKicker || kicker;
  $('#viewKicker').textContent = english ? enKicker : (bilingual ? `${kicker} / ${enKicker}` : kicker);
  $('#viewTitle').textContent = bilingual
    ? `${views[currentView]?.title} · ${views[currentView]?.en}`
    : (english ? views[currentView]?.en : views[currentView]?.title) || 'Overview';
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === currentView));
  $$('.nav-item').forEach((item) => {
    const label = navLabels[item.dataset.view];
    if (label) item.querySelector('span:not(.nav-glyph)').textContent = bilingual ? `${label[0]} / ${label[1]}` : (english ? label[1] : label[0]);
  });
  const sideSettings = $('#sideSettings');
  if (sideSettings) sideSettings.querySelector('span:not(.nav-glyph)').textContent = bilingual ? '设置 / Settings' : (english ? 'Settings' : '设置');

  const s = stateServices();
  const live = allRunning();
  const side = $('#sideStatus');
  side.innerHTML = `<span class="dot ${live ? 'ok live' : ''}"></span><div><b>${live ? '网关在线' : '等待启动'}</b><span>${live ? '本机服务正常' : '服务未全部运行'}</span></div>`;
  $('#sideVersion').textContent = `v${appState.app?.version || '0.2.0'} · ${appState.app?.platform || ''}`;
  const modelMode = cfg.modelMode === 'manual' ? 'manual' : 'auto';
  const badge = $('#modelBadge');
  badge.textContent = modelMode === 'auto'
    ? (english ? 'AUTO' : (bilingual ? '自动 / AUTO' : '自动'))
    : `${english ? 'PIN' : (bilingual ? '固定 / PIN' : '固定')} · ${cfg.pinnedModel || ''}`;
  badge.className = `tag ${modelMode === 'auto' ? 'mint' : 'amber'}`;
  badge.style.cursor = 'pointer';
  $('#sideSettings').classList.toggle('is-active', currentView === 'settings');
  $('#powerBtn').innerHTML = live
    ? `<span class="power-dot"></span>${bilingual ? '停止服务 / Stop all' : (english ? 'Stop all' : '停止服务')}`
    : `<span class="power-dot"></span>${bilingual ? '启动全部 / Start all' : (english ? 'Start all' : '启动全部')}`;
  $('#powerBtn').classList.toggle('danger', live);

  $('#gatewayPort').textContent = `:${cfg.ports?.dashboard || 3001}`;
  $('#routerPort').textContent = `:${cfg.ports?.router || 3002}`;
  const models = appState.catalog?.models || [];
  const cloud = models.filter((model) => !model.local).length;
  const local = models.filter((model) => model.local).length;
  const apps = appState.integrations || [];
  $('#clientCount').textContent = `${apps.filter((app) => app.configured).length}/${apps.length} 个`;
  $('#cloudCount').textContent = `${cloud} 个`;
  $('#localCount').textContent = `${local} 个`;
  const node = (name) => $(`.route-node[data-node="${name}"]`);
  node('gateway')?.classList.toggle('is-live', Boolean(s.server?.running));
  node('router')?.classList.toggle('is-live', Boolean(s.router?.running));
  node('cloud')?.classList.toggle('is-live', Boolean(s.router?.running && cloud));
  node('local')?.classList.toggle('is-live', Boolean(s.ollama?.running && local));
}

function metric(label, value, suffix = '', note = '') {
  return `<div class="metric"><div class="k">${esc(label)}</div><div class="v">${esc(value)}${suffix ? `<small>${esc(suffix)}</small>` : ''}</div>${note ? `<div class="k" style="margin-top:4px">${esc(note)}</div>` : ''}</div>`;
}

function renderModelConsole(prefix = 'mc') {
  const cfg = appState.config || {};
  const mode = cfg.modelMode === 'manual' ? 'manual' : 'auto';
  const pinned = cfg.pinnedModel || 'auto:code';
  const options = appState.modelOptions || [];
  const aliases = options.filter((item) => /^(auto|smart|fast)/.test(item.id));
  const usable = options.filter((item) => item.usableNow && !aliases.includes(item));
  const rest = options.filter((item) => !item.usableNow && !aliases.includes(item));
  const option = (item) => `<option value="${esc(item.id)}" ${item.id === pinned ? 'selected' : ''}>${esc(item.name)}${item.usableNow === false ? '（未启用）' : ''}</option>`;
  return `<section class="panel model-console">
    <div class="model-console-copy">
      <p class="eyebrow">模型控制</p>
      <h2>${mode === 'auto' ? '自动路由已开启' : '固定使用一个模型'}</h2>
      <p>${mode === 'auto'
        ? '默认由任务路由按代码、办公、推理、视觉自动挑选；下面的固定模型只在关闭自动后生效。'
        : `所有已接入软件都会优先使用 ${esc(pinned)}；重新打开自动即可恢复按任务选择。`}</p>
    </div>
    <div class="model-console-controls">
      <button class="switch ${mode === 'auto' ? 'is-on' : ''}" id="${prefix}Auto" aria-label="切换自动路由"></button>
      <select class="model-select" id="${prefix}Select">
        <optgroup label="自动别名">${aliases.map(option).join('')}</optgroup>
        <optgroup label="当前可用">${usable.map(option).join('')}</optgroup>
        <optgroup label="完整目录">${rest.map(option).join('')}</optgroup>
      </select>
      <button class="btn small primary" id="${prefix}Apply">写入已接软件</button>
    </div>
  </section>`;
}

function bindModelConsole(prefix = 'mc') {
  const cfg = appState.config || {};
  const mode = cfg.modelMode === 'manual' ? 'manual' : 'auto';
  const select = $(`#${prefix}Select`);
  $(`#${prefix}Auto`).onclick = async () => {
    const next = mode === 'auto' ? 'manual' : 'auto';
    const result = await window.freeLLM.setModel({ mode: next, model: select?.value || cfg.pinnedModel });
    if (result.ok) {
      appState.config.modelMode = result.mode;
      appState.config.pinnedModel = result.model;
      renderChrome();
    }
    toast(result.ok ? (next === 'auto' ? '已开启自动路由' : '已关闭自动，固定模型') : result.error, !result.ok);
    await refresh();
  };
  select.onchange = async () => {
    const result = await window.freeLLM.setModel({ mode: 'manual', model: select.value });
    if (result.ok) {
      appState.config.modelMode = 'manual';
      appState.config.pinnedModel = select.value;
      renderChrome();
    }
    toast(result.ok ? `已固定为 ${select.value}` : result.error, !result.ok);
    await refresh();
  };
  $(`#${prefix}Apply`).onclick = async () => {
    if (!confirm(`把当前模型设置（${select.value}）写入所有已接入软件？会先备份原配置。`)) return;
    const result = await window.freeLLM.setModel({ mode: select.value.startsWith('auto') || select.value === 'smart' || select.value === 'fast' ? 'auto' : 'manual', model: select.value, apply: true });
    if (result.ok) {
      appState.config.modelMode = result.mode;
      appState.config.pinnedModel = result.model;
      renderChrome();
    }
    toast(result.ok ? '模型设置已写入已接软件' : result.error, !result.ok);
    await refresh();
  };
}

function renderOverview() {
  const s = stateServices();
  const models = appState.catalog?.models || [];
  const usable = appState.catalog?.usableCount || 0;
  const total = appState.catalog?.total || 0;
  const live = allRunning();
  const appTotal = (appState.integrations || []).length;
  const configured = (appState.integrations || []).filter((item) => item.configured).length;
  const stepDone = [
    Boolean(appState.core?.exists),
    Boolean(s.server?.running),
    Boolean(s.router?.running),
    configured >= 2,
  ];

  const serviceCard = (id, name, detail, service) => {
    const state = serviceLabel(service);
    return `<div class="panel service-card">
      <div class="service-top">
        <div><h3>${esc(name)}</h3><p>${esc(detail)}</p></div>
        <span class="tag ${state.cls === 'ok' ? 'mint' : state.cls === 'bad' ? 'coral' : ''}">${esc(state.text)}</span>
      </div>
      <div class="service-foot">
        <div class="service-state"><span class="dot ${state.cls} ${state.cls === 'ok' ? 'live' : ''}"></span>${esc(service?.external ? '外部进程' : service?.port ? `端口 ${service.port}` : '本机')}</div>
        <button class="btn small ${service?.running ? '' : 'primary'}" data-service="${esc(id)}" data-action="${service?.running ? 'stop' : 'start'}">${service?.running ? '停止' : '启动'}</button>
      </div>
    </div>`;
  };

  $('#viewRoot').innerHTML = `
    <section class="hero">
      <div class="panel hero-main">
        <p class="eyebrow">${live ? '系统就绪' : '一键配置'}</p>
        <h2>${live ? '你的免费模型，<span>已经接好。</span>' : '把免费模型接成<span>一台机器。</span>'}</h2>
        <p>${live
          ? '所有客户端共用同一个地址与 Key。云端优先保证速度，敏感内容只走本机模型或直接阻断。'
          : '先启动本机服务，再一键写入 Codex、Claude Code、CC Switch、EchoBird 和 Continue。'}</p>
        <div class="hero-actions">
          <button class="btn primary" id="heroPower">${live ? '停止全部服务' : '启动全部服务'}</button>
          <button class="btn" id="heroConnect">打开接入中心</button>
          <button class="btn quiet" id="heroScan">检测本机</button>
          <button class="btn quiet" id="heroTest">测试一次真实请求</button>
        </div>
      </div>
      <div class="panel hero-stat">
        <div>
          <p class="eyebrow">当前可用</p>
          <strong>${usable}<small>/ ${total} 个模型</small></strong>
          <div class="spark">${Array.from({ length: 8 }, () => '<i></i>').join('')}</div>
        </div>
        <div class="stat-foot"><span class="dot ${usable ? 'ok' : 'warn'}"></span>${usable ? '目录已加载，可直接路由' : '目录未加载或没有可用模型'}</div>
      </div>
    </section>

    ${renderModelConsole('ov')}

    <div class="metrics">
      ${metric('网关', s.server?.running ? '在线' : '停止', '', `127.0.0.1:${appState.config.ports.dashboard}`)}
      ${metric('任务路由', s.router?.running ? '在线' : '停止', '', `127.0.0.1:${appState.config.ports.router}`)}
      ${metric('已接软件', `${configured}`, ` / ${appTotal}`, '自动写入与引导配置')}
      ${metric('公网', appState.tunnel?.running ? '已开' : '关闭', '', appState.tunnel?.url ? '仅 /v1 与 /health' : '默认不暴露')}
    </div>

    <div class="section-head"><div><h2>本机服务</h2><p>任何一个停掉，客户端都会连不上。</p></div><button class="btn small" id="refreshServices">刷新状态</button></div>
    <div class="service-grid">
      ${serviceCard('server', 'FreeLLMAPI 网关', '模型目录 · 密钥加密 · 上游路由', s.server)}
      ${serviceCard('router', '任务路由', '任务识别 · 隐私守卫 · 限流', s.router)}
      ${serviceCard('ollama', 'Ollama 本地模型', '隐私兜底 · 单模型单并发', s.ollama)}
    </div>

    <div class="section-head"><div><h2>免费额度</h2><p>从网关实时读取各平台的免费池；未上报的池会显示“未知”。</p></div><button class="btn small" id="refreshQuota">刷新额度</button></div>
    <div class="panel quota-panel" id="quotaPanel">${renderQuotaPanel()}</div>

    <div class="section-head"><div><h2>四步开始</h2><p>从空电脑到第一个请求，正常不超过十分钟。</p></div></div>
    <div class="steps">
      <div class="step ${stepDone[0] ? 'is-done' : ''}"><div class="num">01 / CORE</div><h3>选安装目录</h3><p>${appState.core?.exists ? '已找到 FreeLLMAPI' : '选择包含 server/dist 的目录'}</p></div>
      <div class="step ${stepDone[1] ? 'is-done' : ''}"><div class="num">02 / GATEWAY</div><h3>启动网关</h3><p>自动生成加密密钥与统一 Key</p></div>
      <div class="step ${stepDone[2] ? 'is-done' : ''}"><div class="num">03 / ROUTER</div><h3>启动路由</h3><p>加载模型目录与隐私守卫</p></div>
      <div class="step ${stepDone[3] ? 'is-done' : ''}"><div class="num">04 / CLIENTS</div><h3>写入软件</h3><p>${configured} 个软件已经接好</p></div>
    </div>

    <div class="note-strip" style="margin-top:16px">
      <span class="icon">!</span>
      <div><b>免费云端可能记录或用于训练。</b> 隐私守卫会把私钥、Token、密码、身份证、银行卡、手机号、邮箱和 IP 拦在本机；朋友的敏感请求直接返回 400。云端调用本身无法保证零留存。</div>
    </div>
  `;

  $('#heroPower').onclick = togglePower;
  bindModelConsole('ov');
  $('#heroConnect').onclick = () => switchView('connect');
  $('#heroScan').onclick = async () => {
    $('#heroScan').disabled = true;
    appState.system = await window.freeLLM.refreshSystem();
    await refresh();
    toast('本机检测已更新');
  };
  $('#heroTest').onclick = () => { switchView('models'); setTimeout(runTest, 60); };
  $('#refreshServices').onclick = refresh;
  $('#refreshQuota').onclick = () => loadQuotas(true);
  if (!quotaState && !quotaLoading) loadQuotas(false);
  $$('[data-service]').forEach((button) => {
    button.onclick = async () => {
      const { service, action } = button.dataset;
      button.disabled = true;
      toast(action === 'stop' ? '正在停止…' : '正在启动…');
      const result = await window.freeLLM.service(service, action);
      toast(result.ok ? '服务已更新' : result.error, !result.ok);
      button.disabled = false;
      await refresh();
    };
  });
}

function formatTokens(value) {
  const number = Number(value) || 0;
  if (number >= 1e9) return `${Math.round(number / 1e8) / 10}B`;
  if (number >= 1e6) return `${Math.round(number / 1e6)}M`;
  if (number >= 1e3) return `${Math.round(number / 1e3)}K`;
  return String(number);
}

function renderQuotaPanel() {
  if (quotaLoading && !quotaState) return '<div style="padding:16px;color:var(--faint);font-size:11px">正在读取免费额度…</div>';
  if (!quotaState) return '<div style="padding:16px;color:var(--faint);font-size:11px">点击“刷新额度”从网关自动拉取。</div>';
  if (!quotaState.ok) return `<div style="padding:16px;color:var(--coral);font-size:11px">${esc(quotaState.error || '读取失败')}</div>`;
  const summary = quotaState.summary || {};
  const pools = quotaState.pools || [];
  return `<div class="quota-summary">
      <div><span class="k">文档额度</span><b>${formatTokens(summary.documentedMonthlyTokens)}</b></div>
      <div><span class="k">免费池</span><b>${summary.poolCount || pools.length}</b></div>
      <div><span class="k">额度制</span><b>${summary.creditsBasedPools || 0}</b></div>
      <div><span class="k">未公开</span><b>${summary.unpublishedPools || 0}</b></div>
    </div>
    <div class="quota-grid">
      ${pools.map((pool) => {
        const quota = pool.quota || {};
        const remaining = quota.remaining !== null && quota.remaining !== undefined ? formatTokens(quota.remaining) : '—';
        const limit = quota.limit !== null && quota.limit !== undefined ? formatTokens(quota.limit) : '—';
        return `<div class="quota-row">
          <div><b>${esc(pool.platform)}</b><span>${esc(pool.label || pool.kind)}</span></div>
          <div class="quota-num">${remaining}<small> / ${limit}</small></div>
          <div class="quota-meta">${pool.modelCount} 模型 · ${pool.keyCount} Key<br/>${quota.resetAt ? `重置 ${new Date(quota.resetAt).toLocaleString()}` : '未上报重置时间'}</div>
        </div>`;
      }).join('') || '<div style="padding:16px;color:var(--faint);font-size:11px">网关还没有可统计的免费池。</div>'}
    </div>`;
}

async function loadQuotas(force) {
  if (quotaLoading) return;
  quotaLoading = true;
  if (force) {
    const panel = $('#quotaPanel');
    if (panel) panel.innerHTML = '<div style="padding:16px;color:var(--faint);font-size:11px">正在读取免费额度…</div>';
  }
  quotaState = await window.freeLLM.quotas();
  if (!quotaState.ok) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    quotaState = await window.freeLLM.quotas();
  }
  quotaLoading = false;
  const panel = $('#quotaPanel');
  if (panel) panel.innerHTML = renderQuotaPanel();
  if (force) toast(quotaState.ok ? '额度已刷新' : quotaState.error, !quotaState.ok);
}

function appCard(app) {
  const installed = app.installed ? '已安装' : '未安装';
  const configured = app.configured ? '已接入' : '待配置';
  const launchable = ['codex', 'claude', 'ccswitch', 'echobird', 'cline', 'cherry', 'aider', 'pi', 'pi-workbench', 'opencode', 'goose', 'qwen', 'crush', 'amp', 'gemini'].includes(app.id);
  return `<div class="panel app-card">
    <div class="app-head">
      <div class="app-mono">${esc(app.mono)}</div>
      <div class="app-title"><h3>${esc(app.name)}</h3><p>${esc(app.desc)}</p></div>
      <div class="badges">
        <span class="tag ${app.installed ? 'mint' : ''}">${installed}</span>
        <span class="tag ${app.configured ? 'amber' : ''}">${configured}</span>
      </div>
    </div>
    <div class="app-note">${esc(app.note)}${(app.categories || [app.category]).filter(Boolean).length ? ` · ${esc((app.categories || [app.category]).filter(Boolean).join(' · '))}` : ''}</div>
    <div class="app-actions">
      <button class="btn small ${app.configured ? '' : 'primary'}" data-write="${esc(app.id)}">${app.auto ? '写入配置' : (['cline', 'cherry'].includes(app.id) ? '复制并打开' : '复制配置')}</button>
      ${app.auto ? `<button class="btn small quiet" data-view-snippet="${esc(app.id)}">查看片段</button>` : ''}
      ${app.installUrl && !app.installed ? `<button class="btn small quiet" data-install-url="${esc(app.installUrl)}">安装 / 官网</button>` : ''}
      ${app.autoInstall && !app.installed ? `<button class="btn small" data-install-app="${esc(app.id)}">一键安装</button>` : ''}
      ${app.installCommand && !app.installed ? `<button class="btn small quiet" data-install-command="${esc(app.installCommand)}">复制安装命令</button>` : ''}
      ${launchable ? `<button class="btn small quiet" data-launch="${esc(app.id)}">打开软件</button>` : ''}
      ${app.custom ? `<button class="btn small danger" data-remove-module="${esc(app.module?.id || '')}">删除</button>` : ''}
    </div>
  </div>`;
}

function renderConnect() {
  const apps = appState.integrations || [];
  const categories = ['全部', ...new Set(apps.flatMap((item) => item.categories || [item.category]).filter(Boolean))];
  let filtered = connectCategory === '全部'
    ? apps
    : apps.filter((item) => (item.categories || [item.category]).includes(connectCategory));
  if (connectStatus === 'missing') filtered = filtered.filter((item) => !item.installed);
  if (connectStatus === 'todo') filtered = filtered.filter((item) => !item.configured);
  const custom = apps.filter((item) => item.custom);
  const missing = apps.filter((item) => !item.installed && item.autoInstall);
  const missingCli = missing.filter((item) => item.installKind !== 'winget');
  const missingDesktop = missing.filter((item) => item.installKind === 'winget');
  $('#viewRoot').innerHTML = `
    <div class="write-bar">
      <div><h2>一次写入，所有软件都能用</h2><p>会先备份原配置，再合并 FreeLLM 条目；不会覆盖你已有的供应商。未安装的软件可以直接打开官网或复制安装命令。</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="detectApps">重新检测</button>
        <button class="btn" id="installCli" ${missingCli.length ? '' : 'disabled'}>补全 CLI/扩展 ${missingCli.length}</button>
        <button class="btn" id="installDesktop" ${missingDesktop.length ? '' : 'disabled'}>补全桌面 ${missingDesktop.length}</button>
        <button class="btn quiet" id="viewInstallLog">安装日志</button>
        <button class="btn" id="openConnectDir">打开连接信息</button>
        <button class="btn primary" id="writeAll">一键写入全部</button>
      </div>
    </div>
    <div class="filter-row" style="margin-bottom:12px">
      ${categories.map((category) => `<button class="chip ${connectCategory === category ? 'is-on' : ''}" data-category="${esc(category)}">${esc(category)}</button>`).join('')}
      <button class="chip ${connectStatus === 'missing' ? 'is-on' : ''}" data-status="missing">未安装</button>
      <button class="chip ${connectStatus === 'todo' ? 'is-on' : ''}" data-status="todo">待配置</button>
      <span class="tag">${filtered.length} 个</span>
    </div>
    <div class="app-grid">${filtered.map(appCard).join('')}</div>

    <div class="section-head"><div><h2>自定义模块</h2><p>任何 OpenAI 兼容服务都能加进来；只保存地址、模型和说明，不写进安装包。</p></div></div>
    <div class="panel settings-card" style="margin-bottom:12px">
      <div class="module-form module-form-wide">
        <select class="search" id="modulePreset" aria-label="闭源预设">
          <option value="">从闭源预设开始（可选）…</option>
          ${(appState.closedProviders || []).map((provider) => `<option value="${esc(provider.id)}">${esc(provider.name)} · ${esc(provider.tag)}</option>`).join('')}
        </select>
        <input class="search" id="moduleName" aria-label="模块名称" placeholder="名称，例如：我的 Ollama" />
        <input class="search" id="moduleUrl" aria-label="Base URL" placeholder="Base URL，例如：http://127.0.0.1:11434/v1" />
        <input class="search" id="moduleModel" aria-label="模型" placeholder="模型，例如：auto 或 qwen3:14b" />
        <select class="search" id="moduleProtocol" aria-label="协议">
          <option value="openai">OpenAI 兼容</option>
          <option value="anthropic">Anthropic 原生</option>
        </select>
        <input class="search" id="moduleKey" type="password" aria-label="API Key" placeholder="API Key（仅本机保存，不写日志）" />
        <input class="search" id="moduleNote" aria-label="备注" placeholder="备注（可选）" />
        <button class="btn primary" id="moduleAdd">添加模块</button>
      </div>
      <div class="app-grid" style="margin-top:12px">
        ${custom.length ? custom.map(appCard).join('') : '<div style="color:var(--faint);font-size:11px;padding:8px 2px">还没有自定义模块。添加后会出现在上面的列表和配置片段里。</div>'}
      </div>
    </div>

    <div class="note-strip" style="margin-top:16px">
      <span class="icon">i</span>
      <div><b>Cline、Cherry Studio、Cursor 等需要粘贴一次。</b> 它们把服务商配置存在自己的数据库里，直接改文件容易损坏。点“复制配置”，按卡片提示填进设置即可。支持自动写入的软件会先备份再合并。</div>
    </div>
  `;
  $('#writeAll').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await window.freeLLM.writeIntegrations(['all']);
    const failed = Object.values(result).filter((item) => !item.ok);
    toast(failed.length ? `部分写入失败：${failed[0].error}` : '已写入全部可用配置', failed.length > 0);
    button.disabled = false;
    await refresh();
  };
  $('#detectApps').onclick = async () => {
    $('#detectApps').disabled = true;
    appState.system = await window.freeLLM.refreshSystem();
    await refresh();
    toast('已重新检测本机软件与硬件');
    $('#detectApps').disabled = false;
  };
  const runBatch = async (list, label) => {
    if (!list.length) return toast('没有需要安装的软件', true);
    if (!confirm(`将依次安装 ${list.length} 个${label}：\n${list.map((item) => item.name).join('、')}\n\n安装过程中可能弹出系统权限提示。继续？`)) return;
    toast(`开始补全 ${list.length} 个${label}…`);
    const result = await window.freeLLM.installMany(list.map((item) => item.id));
    const failed = (result.results || []).filter((item) => !item.ok);
    toast(failed.length ? `完成，${failed.length} 个失败，见安装日志` : `已补全 ${result.results.length} 个${label}`, failed.length > 0);
    await refresh();
  };
  $('#installCli').onclick = () => runBatch(missingCli, ' CLI/扩展');
  $('#installDesktop').onclick = () => runBatch(missingDesktop, '桌面软件');
  $('#viewInstallLog').onclick = async () => {
    showModal('安装日志', (await window.freeLLM.logs('install', 200)) || '暂无安装记录');
  };
  $('#openConnectDir').onclick = () => window.freeLLM.openPath(`${appState.config.dataDir}/connect`);
  $$('[data-category]').forEach((button) => {
    button.onclick = () => { connectCategory = button.dataset.category; renderConnect(); };
  });
  $$('[data-status]').forEach((button) => {
    button.onclick = () => {
      connectStatus = connectStatus === button.dataset.status ? 'all' : button.dataset.status;
      renderConnect();
    };
  });
  $$('[data-write]').forEach((button) => {
    button.onclick = async () => {
      const id = button.dataset.write;
      const app = apps.find((item) => item.id === id);
      if (app && !app.auto) {
        const text = await window.freeLLM.snippet(app.snippetId || id);
        showModal(`${app.name} 配置`, text);
        await copy(text, '配置已复制，去软件里粘贴');
        const opened = await window.freeLLM.openIntegrationUi(id);
        if (opened.ok) toast('配置已复制，已尝试打开设置页');
        return;
      }
      button.disabled = true;
      const result = await window.freeLLM.writeIntegrations([id]);
      const item = result[id];
      toast(item?.ok ? `${app?.name || id} 已写入` : item?.error || '写入失败', !item?.ok);
      button.disabled = false;
      await refresh();
    };
  });
  $$('[data-view-snippet]').forEach((button) => {
    button.onclick = async () => {
      const id = button.dataset.viewSnippet;
      showModal('配置片段', await window.freeLLM.snippet(id));
    };
  });
  $$('[data-launch]').forEach((button) => {
    button.onclick = async () => {
      const result = await window.freeLLM.launch(button.dataset.launch);
      toast(result.ok ? '已尝试打开软件' : '没找到这个软件', !result.ok);
    };
  });
  $$('[data-install-url]').forEach((button) => {
    button.onclick = () => window.freeLLM.openExternal(button.dataset.installUrl).catch((error) => toast(error.message, true));
  });
  $$('[data-install-command]').forEach((button) => {
    button.onclick = () => copy(button.dataset.installCommand, '安装命令已复制');
  });
  $$('[data-install-app]').forEach((button) => {
    button.onclick = async () => {
      const app = apps.find((item) => item.id === button.dataset.installApp);
      if (!confirm(`将执行：${app?.installLabel || app?.installCommand}\n\n安装过程可能需要几分钟，成功后会自动写入可用配置。继续？`)) return;
      const result = await window.freeLLM.installApp(button.dataset.installApp);
      toast(result.ok ? '安装已开始，完成后会自动配置' : result.error, !result.ok);
    };
  });
  $$('[data-remove-module]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('删除这个自定义模块？配置片段也会一起消失。')) return;
      await window.freeLLM.removeModule(button.dataset.removeModule);
      toast('模块已删除');
      await refresh();
    };
  });
  $('#moduleAdd').onclick = async () => {
    const input = {
      name: $('#moduleName').value.trim(),
      baseUrl: $('#moduleUrl').value.trim(),
      model: $('#moduleModel').value.trim() || 'auto',
      apiKey: $('#moduleKey').value.trim(),
      protocol: $('#moduleProtocol').value,
      note: $('#moduleNote').value.trim(),
    };
    const result = await window.freeLLM.addModule(input);
    if (!result.ok) return toast(result.error, true);
    toast('自定义模块已添加');
    await refresh();
  };
  $('#modulePreset').onchange = () => {
    const preset = (appState.closedProviders || []).find((item) => item.id === $('#modulePreset').value);
    if (!preset) return;
    $('#moduleName').value = preset.name;
    $('#moduleUrl').value = preset.baseUrl;
    $('#moduleModel').value = preset.model;
    $('#moduleProtocol').value = preset.protocol;
    $('#moduleNote').value = preset.note;
    $('#moduleKey').focus();
  };
}

function filteredModels() {
  const mode = appState.config?.catalogMode || 'usable';
  const models = mode === 'all' ? (appState.catalog?.all || []) : (appState.catalog?.models || []);
  return models.filter((model) => {
    if (modelFilter === 'cloud' && model.local) return false;
    if (modelFilter === 'local' && !model.local) return false;
    if (modelFilter === 'vision' && !model.vision) return false;
    if (modelFilter === 'tools' && !model.tools) return false;
    const text = `${model.name} ${model.id} ${model.platform} ${(model.tags || []).join(' ')} ${model.strengths}`.toLowerCase();
    return !modelQuery || text.includes(modelQuery.toLowerCase());
  });
}

function renderModels() {
  const models = filteredModels();
  const chips = [
    ['all', '全部'], ['cloud', '云端'], ['local', '本地'], ['vision', '视觉'], ['tools', '工具调用'],
  ];
  const mode = appState.config?.catalogMode || 'usable';
  $('#viewRoot').innerHTML = `
    ${renderModelConsole('md')}
    <div class="filter-row">
      <input class="search" id="modelSearch" placeholder="搜索模型、平台或标签，例如：代码 / 长文本 / qwen" value="${esc(modelQuery)}" />
      ${chips.map(([id, label]) => `<button class="chip ${modelFilter === id ? 'is-on' : ''}" data-filter="${id}">${label}</button>`).join('')}
      <button class="chip ${mode === 'all' ? 'is-on' : ''}" data-catalog-mode="${mode === 'all' ? 'usable' : 'all'}">${mode === 'all' ? '只看可用' : `全部目录 ${appState.catalog?.total || 0}`}</button>
      <button class="chip" id="syncCatalog">同步目录</button>
      <button class="chip" id="openDashboard">添加模型源</button>
      <button class="chip" id="openResources">资料与生态</button>
      <span class="tag">${models.length} 个</span>
      ${appState.config.lastCatalogSync ? `<span class="tag">上次同步 ${new Date(appState.config.lastCatalogSync).toLocaleString()}</span>` : ''}
    </div>
    <div class="model-table">
      ${models.map((model, index) => `<div class="model-row" data-model="${esc(model.id)}">
        <span class="idx">${String(index + 1).padStart(2, '0')}</span>
        <div class="model-name"><b>${esc(model.name)}</b><span>${esc(model.id)}</span></div>
        <div class="model-tags">${model.usableNow !== false ? '' : '<span class="tag coral">未启用</span>'}${(model.tags || []).slice(0, 3).map((tag) => `<span class="tag ${tag === '本地' ? 'mint' : ''}">${esc(tag)}</span>`).join('')}</div>
        <div class="model-desc">${esc(model.strengths || model.platform || '')}</div>
        <div class="rank">智 <b>${model.intelligenceRank || '—'}</b> / 速 <b>${model.speedRank || '—'}</b></div>
        <div class="rank">${model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K` : '—'}</div>
      </div>`).join('') || '<div style="padding:30px;text-align:center;color:var(--faint)">没有匹配的模型</div>'}
    </div>

    <div class="test-panel">
      <div class="panel test-form">
        <div><label for="testModel">路由测试</label><select id="testModel">
          ${['auto', 'auto:code', 'auto:office', 'auto:reasoning', 'auto:translation', 'auto:vision', 'auto:long', 'smart', 'fast']
            .map((id) => `<option value="${id}" ${lastTest?.model === id ? 'selected' : ''}>${id}</option>`).join('')}
        </select></div>
        <div><label for="testPrompt">提示词</label><textarea id="testPrompt">${esc(appState.config.lastRoute?.prompt || '帮我审查这段 TypeScript 代码，找边界条件问题')}</textarea></div>
        <div style="display:flex;gap:8px"><button class="btn primary" id="runTest">发送测试</button><button class="btn" id="pinTestModel">设为固定</button><button class="btn" id="testPrivacy">测试隐私拦截</button></div>
      </div>
      <pre class="test-result" id="testResult">${esc(lastTest ? formatTest(lastTest) : '尚未测试。\n\n点击“发送测试”会走一次真实的 /v1 请求，并显示路由器最终选了哪个模型。')}</pre>
    </div>

  `;
  $('#modelSearch').oninput = (event) => {
    modelQuery = event.target.value;
    const caret = event.target.selectionStart;
    renderModels();
    $('#modelSearch').focus();
    $('#modelSearch').setSelectionRange(caret, caret);
  };
  bindModelConsole('md');
  $$('[data-filter]').forEach((button) => {
    button.onclick = () => { modelFilter = button.dataset.filter; renderModels(); };
  });
  $$('[data-catalog-mode]').forEach((button) => {
    button.onclick = async () => {
      await window.freeLLM.saveSettings({ catalogMode: button.dataset.catalogMode });
      await refresh();
    };
  });
  $('#syncCatalog').onclick = async () => {
    const button = $('#syncCatalog');
    button.disabled = true;
    toast('正在检查签名模型目录…');
    const result = await window.freeLLM.syncCatalog();
    toast(result.ok ? '模型目录已检查/更新' : result.error, !result.ok);
    button.disabled = false;
    await refresh();
  };
  $('#openDashboard').onclick = () => window.freeLLM.openExternal(appState.urls.dashboard);
  $('#openResources').onclick = () => {
    switchView('settings');
    setTimeout(() => document.querySelector('#sec-resources')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
  };
  $$('[data-open-url]').forEach((button) => {
    button.onclick = () => window.freeLLM.openExternal(button.dataset.openUrl).catch((error) => toast(error.message, true));
  });
  $$('.model-row').forEach((row) => {
    row.onclick = () => {
      const id = row.dataset.model;
      const select = $('#testModel');
      if (![...select.options].some((option) => option.value === id)) {
        select.add(new Option(id, id));
      }
      select.value = id;
      $('#testPrompt').value = `请用 ${id} 的能力，简要说明你最适合做什么`;
      toast(`已选择 ${id}`);
    };
  });
  $('#runTest').onclick = runTest;
  $('#pinTestModel').onclick = async () => {
    const model = $('#testModel').value;
    const result = await window.freeLLM.setModel({ mode: 'manual', model });
    toast(result.ok ? `已固定为 ${model}` : result.error, !result.ok);
    await refresh();
  };
  $('#testPrivacy').onclick = runPrivacyTest;
}

function formatTest(result) {
  if (!result) return '';
  return [
    `状态      ${result.status}${result.ok ? ' OK' : ''}`,
    `任务      ${result.task || '—'}`,
    `选中模型  ${result.model}`,
    `隐私守卫  ${result.privacy}`,
    `尝试次数  ${result.attempt || '1'}`,
    `耗时      ${result.ms} ms`,
    '',
    result.content || '',
  ].join('\n');
}

async function runTest() {
  const button = $('#runTest');
  if (button) button.disabled = true;
  document.body.classList.add('is-testing');
  const model = $('#testModel')?.value || 'auto:code';
  const prompt = $('#testPrompt')?.value.trim() || '只回复 OK';
  const resultEl = $('#testResult');
  if (resultEl) resultEl.textContent = '正在请求…';
  const started = Date.now();
  const result = await window.freeLLM.testRoute({ model, prompt });
  document.body.classList.remove('is-testing');
  if (button) button.disabled = false;
  if (!result.ok && !result.status) {
    lastTest = { ok: false, status: 0, model, task: '', privacy: '', ms: Date.now() - started, content: result.error };
  } else {
    lastTest = result;
  }
  if (resultEl) resultEl.textContent = formatTest(lastTest);
  toast(lastTest.ok ? `路由成功：${lastTest.model}` : `请求未成功：${lastTest.status || '网络错误'}`, !lastTest.ok);
}

async function runPrivacyTest() {
  const button = $('#testPrivacy');
  button.disabled = true;
  document.body.classList.add('is-testing');
  const resultEl = $('#testResult');
  resultEl.textContent = '正在测试隐私守卫…\n\n这是 owner 请求，命中后会强制本地或返回 503；朋友请求会直接 400。';
  const result = await window.freeLLM.testRoute({
    model: 'auto',
    prompt: '我的邮箱是 someone@example.com，手机号 13800138000，请只回复 OK',
  });
  document.body.classList.remove('is-testing');
  button.disabled = false;
  lastTest = result;
  resultEl.textContent = formatTest(result) + '\n\n隐私判定：' + (
    result.status === 400 || result.status === 503 || result.privacy.includes('local')
      ? '已拦截或强制本地，未回退云端。'
      : '未触发拦截，请检查路由日志。'
  );
}

function renderShare() {
  const keys = appState.keys || {};
  const running = appState.tunnel?.running;
  const url = appState.tunnel?.url || '';
  const share = appState.share || {};
  const shareEnabled = Boolean(share.enabled);
  const shareUrl = share.ready ? (share.publicUrl || share.localUrl || '') : '';
  $('#viewRoot').innerHTML = `
    <div class="share-hero">
      <div class="panel share-card">
        <p class="eyebrow">朋友访问</p>
        <h2>${running ? '公网入口已打开' : '需要时再开公网'}</h2>
        <p>开启后只转发任务路由的 /v1 与 /health。管理后台、控制台和 Ollama 永远不会暴露。关闭后地址立即失效。</p>
        <div class="share-toggle">
          <div><b style="font-size:12px">Cloudflare 临时隧道</b><div style="font-size:10px;color:var(--faint)">${running ? '公网地址已生成，拿到 Friend Key 的人都能调用' : '默认关闭，不占用端口'}</div></div>
          <button class="switch ${running ? 'is-on' : ''}" id="tunnelSwitch" aria-label="切换公网"></button>
        </div>
        <div class="key-list">
          <div class="key-row"><span class="k">公网地址</span><span class="v">${esc(url || '未开启')}</span><button class="btn small" data-copy-url ${url ? '' : 'disabled'}>复制</button></div>
        </div>
      </div>
      <div class="panel share-card">
        <p class="eyebrow">凭据</p>
        <h2>两个 Key，权限分开</h2>
        <p>主人 Key 可以用本机模型；朋友 Key 只能云端，有分钟、每日和并发限制。</p>
        <div class="key-list">
          <div class="key-row"><span class="k">主人 Key</span><span class="v">${esc(keys.ownerMasked || '未配置')}</span><button class="btn small" data-reveal="owner">显示</button></div>
          <div class="key-row"><span class="k">朋友 Key</span><span class="v">${esc(keys.friendMasked || '未配置')}</span><button class="btn small" data-reveal="friend">显示</button></div>
          <div class="key-row"><span class="k">重置</span><span class="v">重置 Friend Key 后旧 Key 立即失效</span><button class="btn small danger" id="rotateFriend">重置</button></div>
        </div>
      </div>
    </div>

    <div class="panel share-card" style="margin-top:14px">
      <div class="panel-head" style="padding:0 0 8px"><div><p class="eyebrow">朋友入口</p><h2>让朋友直接打开</h2><p>一个只读连接页：显示 Base URL、Friend Key、模型列表和填写说明，不暴露管理后台。</p></div>
        <span class="tag ${shareUrl ? 'mint' : ''}">${shareEnabled ? (shareUrl ? '已就绪' : '等待开启公网') : '未启用'}</span>
      </div>
      <div class="share-toggle">
        <div><b style="font-size:12px">启用朋友网页</b><div style="font-size:10px;color:var(--faint)">本机使用不需要；只在要把连接信息发给朋友时开启</div></div>
        <button class="switch ${shareEnabled ? 'is-on' : ''}" id="shareEnable" aria-label="启用朋友网页"></button>
      </div>
      ${shareEnabled ? `
      <div class="key-list">
        <div class="key-row"><span class="k">${share.publicUrl ? '朋友链接' : '本机预览'}</span><span class="v">${esc(shareUrl || '启动服务后生成')}</span><button class="btn small" id="copyShare" ${shareUrl ? '' : 'disabled'}>复制</button></div>
        <div class="key-row"><span class="k">局域网</span><span class="v">${esc(share.lanUrl || '未开启局域网')}</span><button class="btn small" id="shareLanBtn">${share.lan ? '关闭' : '开启'}</button></div>
      </div>
      <div class="local-actions">
        <button class="btn small primary" id="openShare" ${shareUrl ? '' : 'disabled'}>打开朋友页</button>
        <button class="btn small" id="copyPackage" ${shareUrl ? '' : 'disabled'}>复制连接包</button>
        <span style="font-size:10px;color:var(--faint);align-self:center">链接本身就是访问凭证，发给谁谁就能用 Friend Key。</span>
      </div>
      ${share.publicUrl ? '' : '<div class="note-strip" style="margin-top:10px;padding:9px 11px"><span class="icon">i</span><div>先打开上方“Cloudflare 临时隧道”，这里会自动变成朋友可访问的公网链接。</div></div>'}
      ` : '<div class="note-strip" style="margin-top:10px"><span class="icon">i</span><div>朋友网页是可选功能；关闭时 3004 端口不监听。开启后只提供只读连接页、Friend Key 和模型列表，不暴露管理后台。</div></div>'}
    </div>

    <div class="share-notes">
      <div class="share-note"><b>朋友只需要三样</b><span>Base URL、Friend Key、模型名 auto 或 auto:code。</span></div>
      <div class="share-note"><b>敏感内容直接拒绝</b><span>邮箱、手机号、身份证、银行卡、私钥和 Token 不会上云。</span></div>
      <div class="share-note"><b>默认配额</b><span>20 次/分 · 300 次/天 · 2 并发。可在路由源码调整。</span></div>
    </div>
  `;
  $('#tunnelSwitch').onclick = async () => {
    const button = $('#tunnelSwitch');
    button.disabled = true;
    toast(running ? '正在关闭公网…' : '正在申请公网地址，通常 5–15 秒…');
    const result = await window.freeLLM.tunnel(running ? 'stop' : 'start');
    toast(result.ok ? (running ? '公网已关闭' : '公网已开启') : result.error, !result.ok);
    button.disabled = false;
    await refresh();
  };
  $('#shareEnable').onclick = async () => {
    const result = await window.freeLLM.setShareEnabled(!shareEnabled);
    toast(result.ok ? (result.enabled ? '朋友网页已启用' : '朋友网页已关闭') : result.error, !result.ok);
    await refresh();
  };
  $('#copyShare')?.addEventListener('click', () => copy(shareUrl, '朋友链接已复制'));
  $('#openShare')?.addEventListener('click', () => window.freeLLM.openShare().catch((error) => toast(error.message, true)));
  $('#copyPackage')?.addEventListener('click', async () => {
    const result = await window.freeLLM.sharePackage();
    if (result.ok) await copy(result.text, '连接包已复制');
    else toast(result.error || '生成失败', true);
  });
  $('#shareLanBtn')?.addEventListener('click', async () => {
    const result = await window.freeLLM.setShareLan(!share.lan);
    toast(result.ok ? (result.lan ? '局域网朋友入口已开启' : '局域网朋友入口已关闭') : result.error, !result.ok);
    await refresh();
  });
  $('[data-copy-url]')?.addEventListener('click', () => copy(url, '公网地址已复制'));
  $$('[data-reveal]').forEach((button) => {
    button.onclick = async () => {
      const result = await window.freeLLM.reveal(button.dataset.reveal);
      if (!result.value) return toast('这个 Key 还没生成', true);
      showModal(button.dataset.reveal === 'friend' ? 'Friend Key' : 'Owner Key', result.value);
      await copy(result.value, 'Key 已复制');
    };
  });
  $('#rotateFriend').onclick = async () => {
    if (!confirm('重置后，朋友手上的旧 Key 会立即失效。继续？')) return;
    const result = await window.freeLLM.regenerateFriend();
    toast(result.ok ? 'Friend Key 已重置' : result.error, !result.ok);
    await refresh();
  };
}

function settingToggle(id, label, note, value) {
  return `<div class="setting-row"><div class="label"><b>${esc(label)}</b><span>${esc(note)}</span></div><button class="switch ${value ? 'is-on' : ''}" data-toggle="${esc(id)}" aria-label="${esc(label)}"></button></div>`;
}

function renderSettings() {
  const cfg = appState.config;
  const logs = appState.logs || '';
  const local = appState.local || { models: [], recommendation: null };
  $('#viewRoot').innerHTML = `
    <div class="settings-tabs" id="settingsTabs">
      <button data-scroll="sec-general" class="is-on">常规</button>
      <button data-scroll="sec-appearance">外观</button>
      <button data-scroll="sec-local">本机部署</button>
      <button data-scroll="sec-data">数据与还原</button>
      <button data-scroll="sec-logs">日志</button>
      <button data-scroll="sec-resources">资料与生态</button>
      <button data-scroll="sec-feedback">关于与反馈</button>
    </div>
    <div class="settings-grid">
      <div class="panel settings-card" id="sec-general">
        <div class="panel-head" style="padding:0 0 10px"><div><h2>安装位置</h2><p>程序与数据分离，升级不覆盖配置</p></div></div>
        <div class="setting-row"><div class="label"><b>FreeLLMAPI 目录</b><span>需要包含 server/dist 与 node_modules</span></div><button class="btn small" id="chooseCore">选择</button></div>
        <div class="path-box" style="max-width:none;margin:8px 0 4px">${esc(cfg.coreDir || '尚未找到')}</div>
        <div class="setting-row"><div class="label"><b>数据目录</b><span>配置、密钥、日志与数据库</span></div><button class="btn small" id="openData">打开</button></div>
        <div class="path-box" style="max-width:none;margin:8px 0 4px">${esc(cfg.dataDir || '')}</div>
        <div class="setting-row"><div class="label"><b>本地模式</b><span>纯云端最省资源；混合模式才有隐私兜底</span></div>
          <div class="seg" id="modeSeg">
            <button data-mode="cloud" class="${cfg.mode === 'cloud' ? 'is-on' : ''}">云端</button>
            <button data-mode="hybrid" class="${cfg.mode === 'hybrid' ? 'is-on' : ''}">混合</button>
            <button data-mode="local" class="${cfg.mode === 'local' ? 'is-on' : ''}">本地优先</button>
          </div>
        </div>
        <div class="setting-row"><div class="label"><b>端口</b><span>改动后需要重启服务</span></div>
          <div style="display:flex;gap:5px">
            <input class="search" style="width:66px;min-width:0;height:30px" data-port="dashboard" value="${cfg.ports.dashboard}" />
            <input class="search" style="width:66px;min-width:0;height:30px" data-port="router" value="${cfg.ports.router}" />
            <input class="search" style="width:66px;min-width:0;height:30px" data-port="ollama" value="${cfg.ports.ollama}" />
          </div>
        </div>
        <div class="note-strip" style="margin-top:12px;padding:10px 12px"><span class="icon">i</span><div><b>本机优先，不需要服务器。</b> 下载后直接运行；网关、路由、Ollama 都只监听 127.0.0.1。联网只用于云端模型请求、目录更新和可选的公网分享。</div></div>
      </div>

      <div class="panel settings-card">
        <div class="panel-head" style="padding:0 0 10px"><div><h2>启动行为</h2><p>让常用软件打开就能用</p></div></div>
        ${settingToggle('autostart', '开机自启', '只启动控制台，不自动开公网', cfg.autostart)}
        ${settingToggle('autoStartServices', '打开控制台时启动服务', '网关、路由与本地模型按模式拉起', cfg.autoStartServices !== false)}
        ${settingToggle('closeToTray', '关闭窗口时留在托盘', '服务继续运行；从托盘退出才停止', cfg.closeToTray)}
        ${settingToggle('stopServicesOnQuit', '退出时停止全部服务', '防止后台残留进程', cfg.stopServicesOnQuit !== false)}
        ${settingToggle('lanShare', '允许局域网访问 /v1', '会绑定 0.0.0.0，请只在可信网络使用', cfg.lanShare)}
        <div class="setting-row"><div class="label"><b>统一 Key</b><span>如果服务不是由控制台启动，可在这里粘贴</span></div><button class="btn small" id="pasteOwner">粘贴</button></div>
      </div>

      <div class="panel settings-card" id="sec-appearance" style="grid-column:1/-1">
        <div class="panel-head" style="padding:0 0 10px"><div><h2>外观与语言</h2><p>主题、强调色和界面语言只影响这台电脑。</p></div></div>
        <div class="setting-row"><div class="label"><b>主题</b><span>深色适合长期盯着屏幕；浅色适合白天</span></div>
          <div class="seg" id="themeSeg">
            <button data-theme="dark" class="${cfg.theme === 'dark' || !cfg.theme ? 'is-on' : ''}">深色</button>
            <button data-theme="light" class="${cfg.theme === 'light' ? 'is-on' : ''}">浅色</button>
            <button data-theme="system" class="${cfg.theme === 'system' ? 'is-on' : ''}">跟随系统</button>
          </div>
        </div>
        <div class="setting-row"><div class="label"><b>强调色</b><span>按钮、状态与高亮会一起变化</span></div>
          <div class="swatches" id="accentSeg">
            <button data-accent="amber" class="swatch amber ${cfg.accent === 'amber' || !cfg.accent ? 'is-on' : ''}" title="琥珀" aria-label="琥珀强调色"></button>
            <button data-accent="mint" class="swatch mint ${cfg.accent === 'mint' ? 'is-on' : ''}" title="薄荷" aria-label="薄荷强调色"></button>
            <button data-accent="blue" class="swatch blue ${cfg.accent === 'blue' ? 'is-on' : ''}" title="雾蓝" aria-label="雾蓝强调色"></button>
            <button data-accent="coral" class="swatch coral ${cfg.accent === 'coral' ? 'is-on' : ''}" title="珊瑚" aria-label="珊瑚强调色"></button>
          </div>
        </div>
        <div class="setting-row"><div class="label"><b>语言</b><span>English 预览目前覆盖导航、标题和主要动作；正文仍以中文为准</span></div>
          <div class="seg" id="langSeg">
            <button data-lang="zh-CN" class="${cfg.language === 'zh-CN' || !cfg.language ? 'is-on' : ''}">简体中文</button>
            <button data-lang="bilingual" class="${cfg.language === 'bilingual' ? 'is-on' : ''}">双语</button>
            <button data-lang="en-US" class="${cfg.language === 'en-US' ? 'is-on' : ''}">English 预览</button>
          </div>
        </div>
      </div>

      <div class="panel settings-card" id="sec-data" style="grid-column:1/-1">
        <div class="panel-head" style="padding:0 0 10px"><div><h2>配置备份与还原</h2><p>每次“写入配置”前都会自动备份；还原前也会再备份当前文件。还原后请重开对应软件。</p></div>
          <div style="display:flex;gap:6px">
            <button class="btn small" id="refreshBackups">刷新</button>
            <button class="btn small danger" id="stopRestore">停止服务并还原</button>
          </div>
        </div>
        <div id="backupPanel">${renderBackupPanel()}</div>
        <div class="local-actions">
          <button class="btn small" id="restoreAll">还原全部最近备份</button>
          <button class="btn small quiet" id="openHome">打开用户目录</button>
        </div>
      </div>

      <div class="panel settings-card" id="sec-local" style="grid-column:1/-1">
        <div class="panel-head" style="padding:0 0 10px"><div><h2>本机部署 · 自定义</h2><p>系统建议只是默认值；隐私兜底模型、运行参数和模型目录都可以自己改。</p></div><button class="btn small" id="detectLocal">检测本机</button></div>
        <div class="local-grid">
          <div class="local-block">
            <p class="eyebrow">隐私兜底</p>
            <b>${esc(local.privacyModel || local.recommendation?.model || '跟随系统建议')}</b>
            <span>${esc(local.recommendation?.detail || '敏感内容命中后会强制使用这个本地模型。')}</span>
            <select class="model-select" id="privacyModelSelect" style="width:100%;margin-top:10px">
              <option value="">跟随系统建议${local.recommendation?.model ? `（${esc(local.recommendation.model)}）` : ''}</option>
              ${(local.models || []).map((model) => `<option value="${esc(model.name)}" ${local.privacyModel === model.name ? 'selected' : ''}>${esc(model.name)} · ${model.sizeGB} GB</option>`).join('')}
              ${local.privacyModel && !(local.models || []).some((model) => model.name === local.privacyModel) ? `<option value="${esc(local.privacyModel)}" selected>${esc(local.privacyModel)}（自定义）</option>` : ''}
            </select>
            <div class="seg" id="localProfileSeg" style="margin-top:10px">
              <button data-profile="memory" class="${local.profile === 'memory' ? 'is-on' : ''}">省内存</button>
              <button data-profile="balanced" class="${local.profile === 'balanced' || !local.profile ? 'is-on' : ''}">均衡</button>
              <button data-profile="quality" class="${local.profile === 'quality' ? 'is-on' : ''}">质量优先</button>
            </div>
            <div class="local-actions">
              <button class="btn small ${appState.services.ollama?.running ? '' : 'primary'}" id="startOllama">${appState.services.ollama?.running ? '停止 Ollama' : '启动 Ollama'}</button>
              <button class="btn small" id="saveLocal">保存并重启</button>
            </div>
          </div>
          <div class="local-block">
            <p class="eyebrow">运行参数</p>
            <div class="local-fields">
              <label>端口<input data-local="port" type="number" value="${appState.config.ports.ollama}" /></label>
              <label>上下文<input data-local="context" type="number" value="${local.context || 16384}" /></label>
              <label>并发<input data-local="parallel" type="number" value="${local.parallel || 1}" /></label>
              <label>常驻<input data-local="keepAlive" value="${esc(local.keepAlive || '2m')}" /></label>
            </div>
            <label class="local-path">模型目录<input class="search" data-local="modelsDir" value="${esc(local.modelsDir || '')}" placeholder="留空则用 Ollama 默认目录" /></label>
            <label class="local-path">Ollama 路径<input class="search" data-local="ollamaPath" value="${esc(local.ollamaPath || '')}" placeholder="留空则自动检测" /></label>
            <div class="local-actions">
              <button class="btn small" id="openOllamaDir">打开模型目录</button>
              <button class="btn small quiet" id="viewOllamaLog">查看下载日志</button>
            </div>
          </div>
        </div>

        <div class="section-head" style="margin:18px 0 10px"><div><h2>常用模型</h2><p>点一下就开始下载；也可以填任意 Ollama / HuggingFace 标签。</p></div></div>
        <div class="download-grid">
          ${[
            ['qwen3:8b', 'Qwen3 8B', '~5 GB', '省内存'],
            ['qwen3:14b', 'Qwen3 14B', '~9 GB', '均衡'],
            ['gemma3:12b', 'Gemma 3 12B', '~8 GB', '视觉'],
            ['gpt-oss:20b', 'GPT-OSS 20B', '~14 GB', '代码/推理'],
            ['deepseek-r1:8b', 'DeepSeek R1 8B', '~5 GB', '推理'],
            ['llama3.2:3b', 'Llama 3.2 3B', '~2 GB', '轻量'],
          ].map(([tag, name, size, note]) => {
            const installed = (local.models || []).some((model) => model.name === tag || model.name.startsWith(`${tag}:`) || model.name.startsWith(tag));
            return `<div class="download-card"><div><b>${name}</b><span>${note} · ${size}</span></div><button class="btn small ${installed ? 'quiet' : ''}" data-pull-model="${tag}" ${installed ? 'disabled' : ''}>${installed ? '已安装' : '下载'}</button></div>`;
          }).join('')}
        </div>
        <div class="module-form" style="grid-template-columns:1fr auto;margin-top:12px">
          <input class="search" id="customModelTag" placeholder="自定义模型标签，例如 qwen3:8b 或 hf.co/..." />
          <button class="btn small primary" id="pullCustomModel">下载模型</button>
        </div>

        <div class="local-block" style="margin-top:12px">
          <p class="eyebrow">已安装模型</p>
          <div class="local-models">
            ${(local.models || []).length ? local.models.map((model) => `<div class="local-model"><b>${esc(model.name)}</b><span>${model.sizeGB} GB</span><button class="btn small quiet" data-use-privacy="${esc(model.name)}">设为隐私兜底</button></div>`).join('') : '<span style="color:var(--faint);font-size:11px">还没有已下载模型，或 Ollama 未启动。</span>'}
          </div>
        </div>
      </div>

      <div class="panel settings-card" id="sec-resources" style="grid-column:1/-1">
        <div class="panel-head" style="padding:0 0 10px"><div><h2>资料与生态</h2><p>免费模型源、同类项目和密钥入口；不常用的资料收在这里。</p></div><button class="btn small" id="openKeysPage">打开密钥页</button></div>
        <details class="source-details" open>
          <summary>免费模型源 · ${(appState.freeSources || []).length} 个入口 <span>申请与密钥页</span></summary>
          <div class="source-grid">
            ${(appState.freeSources || []).map((source) => `<div class="source-card">
              <div class="source-head"><b>${esc(source.name)}</b><span class="tag">${esc(source.tag)}</span></div>
              <p>${esc(source.note)}</p>
              <div class="source-actions">
                <button class="btn small quiet" data-open-url="${esc(source.signup)}">申请 / 官网</button>
                ${source.keys !== source.signup ? `<button class="btn small quiet" data-open-url="${esc(source.keys)}">密钥页</button>` : ''}
              </div>
            </div>`).join('')}
          </div>
        </details>
        <details class="source-details" style="margin-top:10px">
          <summary>同类项目 · ${(appState.similarProjects || []).length} 个 <span>统一网关、模型切换与客户端接入</span></summary>
          <div class="project-links">
            ${(appState.similarProjects || []).map((project) => `<button class="project-link" data-open-url="${esc(project.url)}"><b>${esc(project.name)}</b><span>${esc(project.note)}</span></button>`).join('')}
          </div>
        </details>
      </div>
    </div>

    <div class="section-head" id="sec-logs"><div><h2>日志</h2><p>只记录任务、模型、状态、耗时与隐私原因，不记录提示词正文。</p></div>
      <div style="display:flex;gap:6px">
        ${['router', 'server', 'ollama', 'tunnel'].map((name) => `<button class="chip ${logTab === name ? 'is-on' : ''}" data-log="${name}">${name}</button>`).join('')}
        <button class="btn small" id="refreshLog">刷新</button>
      </div>
    </div>
    <pre class="log-box" id="logBox">${esc(logs || '暂无日志')}</pre>

    <div class="section-head" id="sec-feedback"><div><h2>关于与反馈</h2><p>版本信息、问题反馈和作者联系方式。反馈时请不要附带任何 Key。</p></div>
      <button class="btn small" id="openProject">打开项目目录</button>
    </div>
    <div class="panel settings-card" style="margin-bottom:12px">
      <div class="about-grid">
        <div><span>应用版本</span><b>v${esc(appState.app?.version || '')}</b></div>
        <div><span>Electron</span><b>${esc(appState.app?.electron || '—')}</b></div>
        <div><span>Node</span><b>${esc(appState.app?.node || '—')}</b></div>
        <div><span>平台</span><b>${esc(appState.app?.platform || '')} ${esc(appState.app?.arch || '')}</b></div>
      </div>
      <div class="path-box" style="max-width:none;margin-top:10px">核心：${esc(cfg.coreDir || '未选择')}　数据：${esc(cfg.dataDir || '')}</div>
      <div class="local-actions" style="margin-top:10px">
        <button class="btn small" id="copyVersion">复制版本信息</button>
        <button class="btn small" id="copyDiagnostics">复制诊断信息</button>
        <button class="btn small" id="copyFeedback">复制反馈模板</button>
        <button class="btn small quiet" id="openData2">打开数据目录</button>
      </div>
    </div>
    <div class="panel settings-card">
      <div class="panel-head" style="padding:0 0 10px"><div><h2>联系作者</h2><p>问题、建议、群号补充都可以发这里。</p></div></div>
      <div class="contact-list">
        ${(appState.meta?.emails || []).map((email) => `<div class="contact-row"><span class="k">邮箱</span><code>${esc(email)}</code><button class="btn small quiet" data-copy-text="${esc(email)}">复制</button><button class="btn small" data-mail="${esc(email)}">写邮件</button></div>`).join('')}
        <div class="contact-row"><span class="k">QQ</span><code>${esc(appState.meta?.qq || '')}</code><button class="btn small quiet" data-copy-text="${esc(appState.meta?.qq || '')}">复制</button></div>
        <div class="contact-row"><span class="k">微信</span><code>${esc(appState.meta?.wechat || '')}</code><button class="btn small quiet" data-copy-text="${esc(appState.meta?.wechat || '')}">复制</button></div>
        <div class="contact-row"><span class="k">QQ 群</span><code>${esc(cfg.feedbackGroup || '未填写群号')}</code>${cfg.feedbackGroup ? '<span class="tag mint">已设置</span>' : '<input class="search" id="groupInput" placeholder="群号" style="height:28px;min-width:100px" /><button class="btn small" id="saveGroup">保存</button>'}</div>
      </div>
      <div class="qq-card">
        <img src="../assets/qq-group.png" alt="FreeLLM Console QQ 群二维码" />
        <div><b>FreeLLM Console 交流群</b><span>扫码加入；群号可以填在上方，之后会随安装包一起分发。</span></div>
      </div>
      <div class="note-strip" style="margin-top:12px"><span class="icon">!</span><div>提交反馈前请先点“复制诊断信息”；诊断只包含版本、平台、服务状态、模型数量与目录，不包含任何 Key 或提示词。</div></div>
    </div>
  `;
  $('#chooseCore').onclick = async () => {
    const result = await window.freeLLM.chooseCore();
    if (result.canceled) return;
    toast(result.ok ? '安装目录已更新' : result.error, !result.ok);
    await refresh();
  };
  $('#openData').onclick = () => window.freeLLM.openPath(cfg.dataDir);
  $('#openProject').onclick = () => window.freeLLM.openPath(cfg.coreDir || cfg.dataDir);
  $('#openData2').onclick = () => window.freeLLM.openPath(cfg.dataDir);
  $$('#settingsTabs [data-scroll]').forEach((button) => {
    button.onclick = () => {
      $$('#settingsTabs [data-scroll]').forEach((item) => item.classList.toggle('is-on', item === button));
      document.getElementById(button.dataset.scroll)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
  });
  $('#openKeysPage').onclick = () => window.freeLLM.openExternal(`${appState.urls.dashboard}/keys`);
  $$('[data-open-url]').forEach((button) => {
    button.onclick = () => window.freeLLM.openExternal(button.dataset.openUrl).catch((error) => toast(error.message, true));
  });
  $('#copyVersion').onclick = () => copy(
    `FreeLLM Console v${appState.app?.version || ''}\nElectron ${appState.app?.electron || ''}\nNode ${appState.app?.node || ''}\n${appState.app?.platform || ''} ${appState.app?.arch || ''}`,
    '版本信息已复制',
  );
  const diagnostics = () => [
    `FreeLLM Console v${appState.app?.version || ''}`,
    `平台: ${appState.app?.platform || ''} ${appState.app?.arch || ''}`,
    `Electron: ${appState.app?.electron || ''}  Node: ${appState.app?.node || ''}`,
    `核心目录: ${cfg.coreDir || '未选择'}`,
    `数据目录: ${cfg.dataDir || ''}`,
    `服务: 网关=${appState.services.server?.running ? '在线' : '停止'} 路由=${appState.services.router?.running ? '在线' : '停止'} Ollama=${appState.services.ollama?.running ? '在线' : '停止'}`,
    `模型: 可用 ${appState.catalog.usableCount} / 目录 ${appState.catalog.total} / 本地 ${appState.local?.models?.length || 0}`,
    `模型模式: ${appState.config.modelMode === 'manual' ? `固定 ${appState.config.pinnedModel}` : '自动'}`,
    '（此诊断不包含任何 Key 或提示词）',
  ].join('\n');
  $('#copyDiagnostics').onclick = () => copy(diagnostics(), '诊断信息已复制');
  $('#copyFeedback').onclick = () => copy([
    'FreeLLM Console 反馈',
    '',
    `应用版本: v${appState.app?.version || ''}`,
    `系统: ${appState.app?.platform || ''} ${appState.app?.arch || ''}`,
    '',
    '问题描述:',
    '',
    '复现步骤:',
    '1. ',
    '',
    '期望结果:',
    '',
    '诊断信息:',
    diagnostics(),
  ].join('\n'), '反馈模板已复制');
  $$('[data-copy-text]').forEach((button) => {
    button.onclick = () => copy(button.dataset.copyText, '已复制');
  });
  $$('[data-mail]').forEach((button) => {
    button.onclick = () => window.freeLLM.openMailto(`mailto:${button.dataset.mail}?subject=${encodeURIComponent(appState.meta?.feedbackSubject || 'FreeLLM Console 反馈')}`);
  });
  $('#saveGroup')?.addEventListener('click', async () => {
    const value = $('#groupInput').value.trim();
    const result = await window.freeLLM.saveSettings({ feedbackGroup: value });
    toast(result.ok ? '群号已保存' : result.error, !result.ok);
    await refresh();
  });
  setupSettingsSpy();
  $$('#modeSeg [data-mode]').forEach((button) => {
    button.onclick = async () => {
      await window.freeLLM.saveSettings({ mode: button.dataset.mode });
      toast('模式已保存，重启服务后生效');
      await refresh();
    };
  });
  $$('#themeSeg [data-theme]').forEach((button) => {
    button.onclick = async () => {
      const previous = appState.config.theme;
      appState.config.theme = button.dataset.theme;
      applyAppearance();
      const result = await window.freeLLM.saveSettings({ theme: button.dataset.theme });
      if (!result.ok) {
        appState.config.theme = previous;
        applyAppearance();
        return toast(result.error, true);
      }
      toast('主题已切换');
      await refresh();
    };
  });
  $$('#accentSeg [data-accent]').forEach((button) => {
    button.onclick = async () => {
      const previous = appState.config.accent;
      appState.config.accent = button.dataset.accent;
      applyAppearance();
      const result = await window.freeLLM.saveSettings({ accent: button.dataset.accent });
      if (!result.ok) {
        appState.config.accent = previous;
        applyAppearance();
        return toast(result.error, true);
      }
      toast('强调色已切换');
      await refresh();
    };
  });
  $$('#langSeg [data-lang]').forEach((button) => {
    button.onclick = async () => {
      const previous = appState.config.language;
      appState.config.language = button.dataset.lang;
      applyAppearance();
      renderChrome();
      const result = await window.freeLLM.saveSettings({ language: button.dataset.lang });
      if (!result.ok) {
        appState.config.language = previous;
        applyAppearance();
        renderChrome();
        return toast(result.error, true);
      }
      toast(button.dataset.lang === 'en-US' ? 'Language preference saved' : (button.dataset.lang === 'bilingual' ? '已切换为双语导航' : '语言已保存'));
      await refresh();
    };
  });
  $$('[data-toggle]').forEach((button) => {
    button.onclick = async () => {
      const key = button.dataset.toggle;
      const value = !button.classList.contains('is-on');
      await window.freeLLM.saveSettings({ [key]: value });
      button.classList.toggle('is-on', value);
      toast('设置已保存');
    };
  });
  $$('[data-port]').forEach((input) => {
    input.onchange = async () => {
      const ports = {};
      $$('[data-port]').forEach((item) => { ports[item.dataset.port] = Number(item.value); });
      const result = await window.freeLLM.saveSettings({ ports });
      toast(result.ok ? '端口已保存，重启服务后生效' : result.error, !result.ok);
    };
  });
  $('#pasteOwner').onclick = async () => {
    const value = prompt('粘贴 FreeLLMAPI 的统一 Key（不会显示在日志里）');
    if (!value) return;
    const result = await window.freeLLM.setOwner(value);
    toast(result.ok ? '统一 Key 已保存' : result.error, !result.ok);
    await refresh();
  };
  $('#detectLocal').onclick = async () => {
    $('#detectLocal').disabled = true;
    appState.system = await window.freeLLM.refreshSystem();
    await refresh();
    toast('已重新检测本机硬件与 Ollama');
  };
  $('#startOllama').onclick = async () => {
    const result = await window.freeLLM.service('ollama', appState.services.ollama?.running ? 'stop' : 'start');
    toast(result.ok ? 'Ollama 状态已更新' : result.error, !result.ok);
    await refresh();
  };
  const collectLocal = () => ({
    ollamaPath: $('[data-local="ollamaPath"]').value.trim(),
    modelsDir: $('[data-local="modelsDir"]').value.trim(),
    context: Number($('[data-local="context"]').value) || 16384,
    parallel: Number($('[data-local="parallel"]').value) || 1,
    maxLoaded: 1,
    keepAlive: $('[data-local="keepAlive"]').value.trim() || '2m',
    privacyModel: $('#privacyModelSelect').value,
    profile: $('#localProfileSeg .is-on')?.dataset.profile || 'balanced',
  });
  const saveLocal = async (restart) => {
    const next = collectLocal();
    const port = Number($('[data-local="port"]').value) || appState.config.ports.ollama;
    const result = await window.freeLLM.saveSettings({ local: next, ports: { ...appState.config.ports, ollama: port } });
    if (!result.ok) return toast(result.error, true);
    if (restart) {
      toast('正在应用本地部署参数…');
      await window.freeLLM.service('ollama', 'stop');
      await new Promise((resolve) => setTimeout(resolve, 700));
      await window.freeLLM.service('ollama', 'start');
      await window.freeLLM.service('router', 'stop');
      await new Promise((resolve) => setTimeout(resolve, 700));
      await window.freeLLM.service('router', 'start');
    }
    toast('本地部署设置已保存');
    await refresh();
  };
  $('#saveLocal').onclick = () => saveLocal(true);
  $('#privacyModelSelect').onchange = async () => {
    const model = $('#privacyModelSelect').value;
    const result = await window.freeLLM.saveSettings({ local: { ...collectLocal(), privacyModel: model } });
    if (!result.ok) return toast(result.error, true);
    toast(model ? `隐私兜底已设为 ${model}` : '隐私兜底改为跟随系统建议');
    await window.freeLLM.service('router', 'stop');
    await new Promise((resolve) => setTimeout(resolve, 700));
    await window.freeLLM.service('router', 'start');
    await refresh();
  };
  $$('#localProfileSeg [data-profile]').forEach((button) => {
    button.onclick = async () => {
      await window.freeLLM.saveSettings({ local: { ...collectLocal(), profile: button.dataset.profile } });
      toast('部署策略已保存');
      await refresh();
    };
  });
  const pull = async (model) => {
    if (!model) return;
    if (!confirm(`开始下载 ${model}？这会占用数 GB 磁盘和一段时间。`)) return;
    const result = await window.freeLLM.pullModel(model);
    toast(result.ok ? `已开始下载 ${model}，进度见日志` : result.error, !result.ok);
  };
  $$('[data-pull-model]').forEach((button) => {
    button.onclick = () => pull(button.dataset.pullModel);
  });
  $$('[data-use-privacy]').forEach((button) => {
    button.onclick = async () => {
      $('#privacyModelSelect').value = button.dataset.usePrivacy;
      await window.freeLLM.saveSettings({ local: { ...collectLocal(), privacyModel: button.dataset.usePrivacy } });
      await window.freeLLM.service('router', 'stop');
      await new Promise((resolve) => setTimeout(resolve, 700));
      await window.freeLLM.service('router', 'start');
      toast(`已设为隐私兜底：${button.dataset.usePrivacy}`);
      await refresh();
    };
  });
  $('#openOllamaDir').onclick = () => {
    const base = local.modelsDir || local.ollamaPath;
    const separator = base?.includes('\\') ? '\\' : '/';
    const dir = local.modelsDir
      ? local.modelsDir
      : local.ollamaPath
      ? `${local.ollamaPath.replace(/[\\/][^\\/]+$/, '')}${separator}models`
      : appState.config.dataDir;
    window.freeLLM.openPath(dir);
  };
  $('#viewOllamaLog').onclick = async () => {
    const text = await window.freeLLM.logs('ollama-pull', 200);
    showModal('Ollama 下载日志', text || '暂无日志');
  };
  $('#refreshBackups').onclick = () => loadBackups(true);
  $('#openHome').onclick = () => window.freeLLM.openPath(appState.config.dataDir);
  $('#restoreAll').onclick = async () => {
    if (!confirm('用每个软件最近一次的备份覆盖当前配置？当前文件会先另存为 pre-restore 备份。')) return;
    const result = await window.freeLLM.restoreLatest();
    const failed = (result.results || []).filter((item) => !item.ok);
    toast(failed.length ? `部分还原失败：${failed[0].error}` : '已还原最近备份', failed.length > 0);
    await loadBackups(true);
    await refresh();
  };
  $('#stopRestore').onclick = async () => {
    if (!confirm('停止网关、路由与 Ollama，并还原每个软件最近一次的配置备份？')) return;
    const result = await window.freeLLM.stopAndRestore();
    const failed = (result.results || []).filter((item) => !item.ok);
    toast(failed.length ? `已停止，部分还原失败：${failed[0].error}` : '服务已停止，配置已还原', failed.length > 0);
    await loadBackups(true);
    await refresh();
  };
  $$('[data-restore-backup]').forEach((button) => {
    button.onclick = async () => {
      const isDatabase = button.dataset.targetId === 'ccswitch-db';
      const question = isDatabase
        ? '还原 CC Switch 数据库？请先完全退出 CC Switch，否则可能写入失败。当前数据库会先另存为 pre-restore 备份。'
        : '用这个备份覆盖当前文件？当前文件会先另存为 pre-restore 备份。';
      if (!confirm(question)) return;
      const result = await window.freeLLM.restoreBackup({
        targetId: button.dataset.targetId,
        backup: button.dataset.restoreBackup,
      });
      toast(result.ok ? '已还原' : result.error, !result.ok);
      await loadBackups(true);
    };
  });
  if (backupState === null) loadBackups(false);
  $('#pullCustomModel').onclick = async () => {
    const model = $('#customModelTag').value.trim();
    if (!model) return toast('先填入模型标签', true);
    await pull(model);
  };
  $$('[data-log]').forEach((button) => {
    button.onclick = async () => {
      logTab = button.dataset.log;
      appState.logs = await window.freeLLM.logs(logTab, 220);
      renderSettings();
    };
  });
  $('#refreshLog').onclick = async () => {
    appState.logs = await window.freeLLM.logs(logTab, 220);
    $('#logBox').textContent = appState.logs || '暂无日志';
  };
}

function renderWorkbench() {
  if (!workbenchState) {
    workbenchState = { loading: true };
    window.freeLLM.workbenchInfo().then((info) => {
      workbenchState = info;
      if (currentView === 'workbench') renderWorkbench();
    }).catch(() => {
      workbenchState = { ok: false, error: '读取工作台信息失败', recent: [] };
      if (currentView === 'workbench') renderWorkbench();
    });
  }
  const wb = workbenchState;
  if (wb.loading) {
    $('#viewRoot').innerHTML = '<div class="panel" style="padding:30px;color:var(--muted)">正在检测 Pi 工作台…</div>';
    return;
  }
  const installed = Boolean(wb.exe);
  const recent = wb.recent || [];
  $('#viewRoot').innerHTML = `
    <section class="workbench-hero">
      <div class="panel workbench-main">
        <p class="eyebrow">可选工作台</p>
        <h2>真实 Pi TUI，<br/><span>放进图形工作台。</span></h2>
        <p>这是可选的极简 Pi 工作台：项目、模型、自动化、协作、能力、会话都在一个窗口里；控制台负责检测、写配置和带项目启动。</p>
        <div class="hero-actions">
          <button class="btn primary" id="wbChoose" ${installed ? '' : 'disabled'}>选择项目并打开</button>
          <button class="btn" id="wbOpen" ${installed ? '' : 'disabled'}>直接打开</button>
          <button class="btn" id="wbWrite">写入当前模型</button>
          <button class="btn quiet" id="wbPiConfig">打开 Pi 配置</button>
          ${installed ? '' : '<button class="btn quiet" id="wbDownload">打开下载页</button>'}
        </div>
        <div class="workbench-status">
          <span class="tag ${installed ? 'mint' : 'coral'}">${installed ? '已检测到工作台' : '未找到工作台'}</span>
          <code>${esc(wb.exe || '安装 Pi 工作台后会自动识别')}</code>
        </div>
      </div>
      <div class="panel workbench-side">
        <p class="eyebrow">能力</p>
        <div class="wb-feature"><b>真实 Pi TUI</b><span>node-pty + xterm，不模拟输出</span></div>
        <div class="wb-feature"><b>多项目会话</b><span>按项目展开、切换与恢复</span></div>
        <div class="wb-feature"><b>模型与能力</b><span>模型、Skill、MCP、权限集中管理</span></div>
        <div class="wb-feature"><b>自动 / 协作</b><span>定时任务、Agent 会议室、常用工具</span></div>
      </div>
    </section>

    <div class="section-head"><div><h2>最近项目</h2><p>来自 Pi 工作台自己的项目记录；点击直接带项目启动。</p></div>
      <button class="btn small" id="wbRefresh">刷新</button></div>
    <div class="panel workbench-projects">
      ${recent.length ? recent.map((project) => `<button class="wb-project ${project.exists ? '' : 'is-missing'}" data-wb-project="${esc(project.path)}">
        <span class="wb-project-icon">${project.name.slice(0, 1).toUpperCase()}</span>
        <span class="wb-project-text"><b>${esc(project.name)}</b><small>${esc(project.path)}</small></span>
        <span class="tag ${project.exists ? 'mint' : 'coral'}">${project.exists ? '打开' : '路径失效'}</span>
      </button>`).join('') : '<div style="padding:18px;color:var(--faint);font-size:11px">还没有项目记录。点“选择项目并打开”开始。</div>'}
    </div>

    <div class="note-strip" style="margin-top:16px"><span class="icon">i</span><div><b>工作台是独立应用，控制台不会接管它的终端。</b> 这里负责把 FreeLLM 模型写进 Pi 的 <code>~/.pi/agent</code>，再用 <code>--project</code> 启动工作台；模型调用仍由 Pi 在工作台里发起。</div></div>
  `;
  $('#wbChoose').onclick = async () => {
    const result = await window.freeLLM.chooseWorkbenchProject();
    toast(result.ok ? '已启动 Pi 工作台' : result.error || '已取消', !result.ok && !result.canceled);
  };
  $('#wbOpen').onclick = async () => {
    const result = await window.freeLLM.launchWorkbench();
    toast(result.ok ? '已启动 Pi 工作台' : result.error, !result.ok);
  };
  $('#wbWrite').onclick = async () => {
    const result = await window.freeLLM.writeIntegrations(['pi-workbench']);
    const item = result['pi-workbench'];
    toast(item?.ok ? '当前模型已写入 Pi 配置' : item?.error || '写入失败', !item?.ok);
    await refresh();
  };
  $('#wbPiConfig').onclick = () => window.freeLLM.openPiConfig();
  $('#wbDownload')?.addEventListener('click', () => window.freeLLM.openExternal('https://github.com/enmingxiong821-cloud/pi--desktop/releases'));
  $('#wbRefresh').onclick = () => { workbenchState = null; renderWorkbench(); };
  $$('[data-wb-project]').forEach((button) => {
    button.onclick = async () => {
      const project = button.dataset.wbProject;
      const result = await window.freeLLM.launchWorkbench(project);
      toast(result.ok ? '已带项目启动 Pi 工作台' : result.error, !result.ok);
    };
  });
}

function renderLocalModels() {
  const all = appState.localCatalog || [];
  const installed = new Set((appState.local?.models || []).map((model) => model.name));
  const chips = [
    ['all', '全部'], ['中文', '中文'], ['代码', '代码'], ['推理', '推理'],
    ['视觉', '视觉'], ['轻量', '轻量'], ['工具调用', '工具调用'], ['已安装', '已安装'],
  ];
  const isInstalled = (model) => [...installed].some((name) => name === model.ollama || name.startsWith(`${model.ollama}:`) || name.startsWith(model.ollama));
  const list = all.filter((model) => {
    if (localModelFilter === '已安装' && !isInstalled(model)) return false;
    if (localModelFilter !== 'all' && localModelFilter !== '已安装' && !(model.tags || []).includes(localModelFilter)) return false;
    const q = localModelQuery.toLowerCase();
    return !q || `${model.name} ${model.vendor} ${model.tags.join(' ')} ${model.strengths} ${model.weaknesses}`.toLowerCase().includes(q);
  });
  $('#viewRoot').innerHTML = `
    <div class="open-head">
      <div><p class="eyebrow">开源权重</p><h2>本地开源模型库</h2><p>按常见本地部署整理 ${all.length} 个模型；优点、弱点、擅长任务都写在卡片里。标签以 Ollama 库为准，可自己改。</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="addClosedModel">添加闭源 API</button>
        <button class="btn" id="openLocalSettings">运行参数</button>
      </div>
    </div>
    <div class="filter-row">
      <input class="search" id="localModelSearch" placeholder="搜索模型、厂商、能力，例如：中文 视觉 32B" value="${esc(localModelQuery)}" />
      ${chips.map(([id, label]) => `<button class="chip ${localModelFilter === id ? 'is-on' : ''}" data-local-filter="${id}">${label}</button>`).join('')}
      <span class="tag">${list.length} 个</span>
    </div>
    <div class="open-model-grid">
      ${list.map((model) => {
        const has = isInstalled(model);
        return `<div class="panel open-model-card">
          <div class="open-model-head"><div><h3>${esc(model.name)}</h3><span>${esc(model.vendor)} · ${esc(model.params)} · ${model.sizeGB} GB</span></div><span class="tag ${has ? 'mint' : ''}">${has ? '已安装' : '可下载'}</span></div>
          <div class="model-tags">${model.tags.map((tag) => `<span class="tag ${tag === '中文' ? 'amber' : tag === '视觉' ? 'mint' : ''}">${esc(tag)}</span>`).join('')}<span class="tag">${esc(model.license)}</span></div>
          <div class="model-strong"><b>擅长</b><span>${esc(model.strengths)}</span></div>
          <div class="model-weak"><b>弱项</b><span>${esc(model.weaknesses)}</span></div>
          <div class="open-model-foot"><code>${esc(model.ollama)}</code><div class="open-model-actions">
            <button class="btn small quiet" data-copy-tag="${esc(model.ollama)}">复制标签</button>
            <button class="btn small quiet" data-local-privacy="${esc(has ? model.ollama : model.ollama)}">设为兜底</button>
            <button class="btn small ${has ? 'quiet' : 'primary'}" data-download-local="${esc(model.ollama)}" ${has ? 'disabled' : ''}>${has ? '已安装' : '下载'}</button>
          </div></div>
        </div>`;
      }).join('') || '<div class="panel" style="padding:30px;color:var(--faint)">没有匹配的模型</div>'}
    </div>
    <div class="note-strip" style="margin-top:16px"><span class="icon">i</span><div><b>开源模型不是越大越好。</b> 32GB 内存的机器优先 8B–14B；20B/30B 只在显存充足时手动加载。闭源 API 可以通过“添加闭源 API”接入，不走本地下载。</div></div>
  `;
  $('#localModelSearch').oninput = (event) => {
    localModelQuery = event.target.value;
    const caret = event.target.selectionStart;
    renderLocalModels();
    $('#localModelSearch').focus();
    $('#localModelSearch').setSelectionRange(caret, caret);
  };
  $$('[data-local-filter]').forEach((button) => {
    button.onclick = () => { localModelFilter = button.dataset.localFilter; renderLocalModels(); };
  });
  $('#addClosedModel').onclick = () => {
    switchView('connect');
    setTimeout(() => document.querySelector('.module-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  };
  $('#openLocalSettings').onclick = () => switchView('settings');
  $$('[data-copy-tag]').forEach((button) => {
    button.onclick = () => copy(button.dataset.copyTag, '模型标签已复制');
  });
  $$('[data-download-local]').forEach((button) => {
    button.onclick = async () => {
      const tag = button.dataset.downloadLocal;
      if (!confirm(`从 Ollama 下载 ${tag}？体积较大，需要一些时间。`)) return;
      const result = await window.freeLLM.pullModel(tag);
      toast(result.ok ? `已开始下载 ${tag}` : result.error, !result.ok);
    };
  });
  $$('[data-local-privacy]').forEach((button) => {
    button.onclick = async () => {
      const tag = button.dataset.localPrivacy;
      await window.freeLLM.saveSettings({ local: { ...(appState.config.local || {}), privacyModel: tag } });
      await window.freeLLM.service('router', 'stop');
      await new Promise((resolve) => setTimeout(resolve, 700));
      await window.freeLLM.service('router', 'start');
      toast(`隐私兜底已设为 ${tag}`);
      await refresh();
    };
  });
}

function renderBackupPanel() {
  if (backupState === null) return '<div style="padding:12px 0;color:var(--faint);font-size:11px">正在读取备份…</div>';
  if (!backupState.length) return '<div style="padding:12px 0;color:var(--faint);font-size:11px">还没有备份。第一次点“写入配置”后会自动生成。</div>';
  return `<div class="backup-list">${backupState.slice(0, 12).map((item) => `
    <div class="backup-row">
      <div><b>${esc(item.app)}</b><span>${esc(item.target.split(/[\\/]/).pop())}</span></div>
      <div class="backup-time">${new Date(item.createdAt).toLocaleString()}</div>
      <button class="btn small" data-target-id="${esc(item.targetId)}" data-restore-backup="${esc(item.backup)}">还原</button>
    </div>`).join('')}</div>`;
}

async function loadBackups(force) {
  backupState = await window.freeLLM.backups();
  const panel = $('#backupPanel');
  if (panel) panel.innerHTML = renderBackupPanel();
  $$('[data-restore-backup]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('用这个备份覆盖当前文件？当前文件会先另存为 pre-restore 备份。')) return;
      const result = await window.freeLLM.restoreBackup({
        targetId: button.dataset.targetId,
        backup: button.dataset.restoreBackup,
      });
      toast(result.ok ? '已还原' : result.error, !result.ok);
      await loadBackups(true);
    };
  });
  if (force) toast('备份列表已刷新');
}

function renderView(animate = false) {
  if (!appState) return;
  renderChrome();
  if (currentView === 'overview') renderOverview();
  else if (currentView === 'connect') renderConnect();
  else if (currentView === 'models') renderModels();
  else if (currentView === 'share') renderShare();
  else if (currentView === 'settings') renderSettings();
  else if (currentView === 'workbench') renderWorkbench();
  else if (currentView === 'localmodels') renderLocalModels();
  if (animate) {
    const root = $('#viewRoot');
    root.scrollTop = 0;
    root.classList.remove('view-enter');
    void root.offsetWidth;
    root.classList.add('view-enter');
  }
}

function switchView(view) {
  if (!views[view]) return;
  if (settingsScrollHandler && view !== 'settings') {
    $('#viewRoot').removeEventListener('scroll', settingsScrollHandler);
    settingsScrollHandler = null;
  }
  currentView = view;
  renderView(true);
  $('#viewRoot').scrollTop = 0;
}

async function refresh() {
  const next = await window.freeLLM.getState();
  if (next) appState = next;
  if (currentView === 'settings') {
    appState.logs = await window.freeLLM.logs(logTab, 220);
  }
  renderView();
}

async function togglePower() {
  const button = $('#powerBtn');
  button.disabled = true;
  toast(allRunning() ? '正在停止全部服务…' : '正在启动网关与路由…');
  const result = allRunning() ? await window.freeLLM.stopAll() : await window.freeLLM.startAll();
  const errors = Object.entries(result).filter(([, value]) => value && value.ok === false);
  toast(errors.length ? errors[0][1].error : '服务状态已更新', errors.length > 0);
  button.disabled = false;
  await refresh();
}

/* ── onboarding ───────────────────────────────────────── */

function onboardProgress() {
  $('#onboardProgress').innerHTML = [0, 1, 2, 3].map((index) => `<i class="${index <= onboard.step ? 'is-on' : ''}"></i>`).join('');
}

function scanRows() {
  const system = appState?.system;
  if (!system) return '<div class="scan-row"><span class="icon">…</span><b>正在读取硬件信息</b><span>稍等</span></div>';
  const gpu = system.gpu?.[0];
  return [
    ['OS', system.osName, system.arch],
    ['CPU', system.cpu?.model, `${system.cpu?.cores || '—'} 核`],
    ['内存', `${system.ramGB} GB`, system.ramGB >= 16 ? '足够混合模式' : '建议纯云端'],
    ['显卡', gpu ? gpu.name : '未检测到独立显卡', gpu?.vramGB ? `${gpu.vramGB} GB 显存` : 'CPU / 核显'],
    ['磁盘', system.diskGB !== null ? `${system.diskGB} GB 可用` : '未知', '数据盘剩余'],
    ['Ollama', system.tools?.find((tool) => tool.id === 'ollama')?.installed ? '已安装' : '未安装', '可选组件'],
  ].map(([label, value, extra]) => `<div class="scan-row"><span class="icon">·</span><b>${esc(label)}</b><span>${esc(value)} · ${esc(extra)}</span></div>`).join('');
}

function renderOnboard() {
  onboardProgress();
  const body = $('#onboardBody');
  const back = $('#onboardBack');
  const next = $('#onboardNext');
  back.disabled = onboard.step === 0;
  back.textContent = onboard.step === 0 ? '上一步' : '上一步';
  next.textContent = ['开始配置', '下一步', '写入并检测', '完成并进入控制台'][onboard.step];
  next.disabled = onboardBusy;

  if (onboard.step === 0) {
    const rec = appState?.system?.recommendation;
    body.innerHTML = `<div class="onboard-split">
      <div class="onboard-copy">
        <p class="eyebrow">第 1 步 / 环境检测</p>
        <h2>先看看这台电脑<br/>能跑到什么程度。</h2>
        <p>不会上传任何硬件信息。检测只在你本机完成，用来决定是纯云端、混合，还是本地优先。</p>
        <div class="scan-list">${scanRows()}</div>
      </div>
      <div class="scan-card">
        <p class="eyebrow">系统建议</p>
        <div class="big">${rec ? esc(rec.title) : '检测中'}<br/><small>${rec ? esc(rec.model || '只跑云端') : ''}</small></div>
        <div class="sub">${esc(rec?.detail || '正在读取内存、显存与磁盘空间…')}</div>
        <div class="scan-divider"></div>
        <div class="scan-row" style="border:0;padding:0;background:none"><span class="icon">✓</span><b>云端优先</b><span>打开即快</span></div>
        <div class="scan-row" style="border:0;padding:0;background:none"><span class="icon">✓</span><b>隐私本地</b><span>敏感内容不出机</span></div>
        <div class="scan-row" style="border:0;padding:0;background:none"><span class="icon">✓</span><b>朋友隔离</b><span>不占你的 GPU</span></div>
        <button class="btn small" id="rescan" style="margin-top:14px">重新检测</button>
      </div>
    </div>`;
    $('#rescan').onclick = async () => {
      $('#rescan').disabled = true;
      appState.system = await window.freeLLM.refreshSystem();
      renderOnboard();
    };
    return;
  }

  if (onboard.step === 1) {
    const modes = [
      ['cloud', '仅云端', '最省资源，任何电脑都能跑；敏感内容会阻断。', 'RECOMMENDED'],
      ['hybrid', '云端 + 本地兜底', '日常走云端，隐私命中时尝试本机模型。', 'BALANCED'],
      ['local', '本地优先', '所有请求先试本机；需要足够显存与内存。', 'HEAVY'],
    ];
    body.innerHTML = `<div class="onboard-copy">
      <p class="eyebrow">第 2 步 / 模式</p>
      <h2>选择这台电脑的工作方式。</h2>
      <p>之后可以在设置里随时切换。混合模式是最稳妥的默认值。</p>
      <div class="mode-grid">
        ${modes.map(([id, title, desc, tag]) => `<button class="mode-card ${onboard.mode === id ? 'is-on' : ''}" data-mode="${id}">
          <b>${title}</b><span>${desc}</span><em>${tag}</em>
        </button>`).join('')}
      </div>
      <div class="scan-card" style="margin-top:16px">
        <p class="eyebrow">安装目录</p>
        <b style="font-size:12px">${appState.core?.exists ? '已找到 FreeLLMAPI' : '还没有找到安装目录'}</b>
        <div class="path-box" style="max-width:none;margin-top:8px">${esc(appState.core?.dir || '选择包含 server/dist 的目录')}</div>
        <button class="btn small" id="onboardChooseCore" style="margin-top:10px">选择目录</button>
      </div>
      <div class="note-strip" style="margin-top:14px"><span class="icon">i</span><div>纯云端模式不需要 Ollama，也不会下载本地模型。混合模式会检测 Ollama，但只有隐私请求才会加载本地模型。</div></div>
    </div>`;
    $$('.mode-card').forEach((card) => {
      card.onclick = () => { onboard.mode = card.dataset.mode; renderOnboard(); };
    });
    $('#onboardChooseCore').onclick = async () => {
      const result = await window.freeLLM.chooseCore();
      if (result.canceled) return;
      toast(result.ok ? '目录已更新' : result.error, !result.ok);
      await refresh();
      renderOnboard();
    };
    return;
  }

  if (onboard.step === 2) {
    const apps = (appState.integrations || []).filter((item) => item.id !== 'cline' && item.id !== 'cherry');
    body.innerHTML = `<div class="onboard-copy">
      <p class="eyebrow">第 3 步 / 接入</p>
      <h2>把常用软件一次接好。</h2>
      <p>会先备份原配置，再合并 FreeLLM 条目。没安装的软件可以跳过，之后在接入中心再写。</p>
      <div class="check-list">
        ${apps.map((app) => `<label class="check-row">
          <input type="checkbox" data-app="${esc(app.id)}" ${onboard.selected.has(app.id) ? 'checked' : ''} />
          <b>${esc(app.name)}</b>
          <span>${app.installed ? '已安装' : '未安装'} · ${app.auto ? '自动写入' : '手动粘贴'}</span>
        </label>`).join('')}
      </div>
      <div class="note-strip" style="margin-top:14px"><span class="icon">i</span><div>写入后，所有软件只需要记住一个 Base URL 和一个 Key。模型名用 <b>auto</b> 或 <b>auto:code</b> 即可。</div></div>
    </div>`;
    $$('[data-app]').forEach((box) => {
      box.onchange = () => {
        if (box.checked) onboard.selected.add(box.dataset.app);
        else onboard.selected.delete(box.dataset.app);
      };
    });
    return;
  }

  const checks = onboard.checks;
  body.innerHTML = `<div class="onboard-copy">
    <p class="eyebrow">第 4 步 / 自检</p>
    <h2>跑一次真实链路，<br/>确认不是“看起来能用”。</h2>
    <p>会依次检查安装目录、网关、任务路由、模型目录、真实请求与软件配置。失败的项会说明下一步。</p>
    <div class="selfcheck">
      ${checks.map((check) => `<div class="check-line ${check.state === 'ok' ? 'is-ok' : check.state === 'bad' ? 'is-bad' : check.state === 'warn' ? 'is-warn' : ''}">
        <span class="icon">${check.state === 'ok' ? '✓' : check.state === 'bad' ? '×' : check.state === 'warn' ? '!' : '…'}</span>
        <b>${esc(check.label)}</b>
        <span>${esc(check.detail || (check.state === 'run' ? '检测中' : '等待'))}</span>
      </div>`).join('') || '<div class="check-line"><span class="icon">…</span><b>等待开始</b><span>点击“写入并检测”</span></div>'}
    </div>
    <div class="note-strip" style="margin-top:16px"><span class="icon">!</span><div>如果本地模型因显存不足加载失败，隐私请求会返回 503，绝不会偷偷回退云端。纯云端模式下，Owner 的敏感请求也会被阻断。</div></div>
  </div>`;
}

async function runOnboardChecks() {
  const checks = [
    { id: 'core', label: '安装目录', state: 'run' },
    { id: 'server', label: '统一网关', state: 'run' },
    { id: 'router', label: '任务路由', state: 'run' },
    { id: 'catalog', label: '模型目录', state: 'run' },
    { id: 'request', label: '真实请求', state: 'run' },
    { id: 'apps', label: '软件配置', state: 'run' },
  ];
  onboard.checks = checks;
  renderOnboard();
  const set = (id, state, detail) => {
    const item = onboard.checks.find((check) => check.id === id);
    if (item) { item.state = state; item.detail = detail; }
    renderOnboard();
  };

  await refresh();
  set('core', appState.core?.exists ? 'ok' : 'bad', appState.core?.exists ? '已找到服务端' : '请先选择目录');

  const started = await window.freeLLM.startAll();
  await refresh();
  set('server', appState.services.server?.running ? 'ok' : 'bad', appState.services.server?.running ? '在线' : (started.server?.error || '未启动'));
  set('router', appState.services.router?.running ? 'ok' : 'bad', appState.services.router?.running ? '在线' : (started.router?.error || '未启动'));
  set('catalog', appState.catalog?.usableCount > 0 ? 'ok' : 'warn', `${appState.catalog?.usableCount || 0} 个可用模型`);

  if (appState.services.router?.running) {
    const result = await window.freeLLM.testRoute({ model: 'auto:code', prompt: '只回复 OK' });
    set('request', result.ok ? 'ok' : 'warn', result.ok ? `${result.model} · ${result.ms}ms` : (result.error || `HTTP ${result.status}`));
  } else {
    set('request', 'bad', '路由未启动');
  }

  const configured = (appState.integrations || []).filter((app) => app.configured).length;
  set('apps', configured >= 2 ? 'ok' : 'warn', `${configured} 个软件已接入`);
}

async function onboardNext() {
  if (onboardBusy) return;
  onboardBusy = true;
  const button = $('#onboardNext');
  if (button) button.disabled = true;
  try {
  if (onboard.step === 0) {
    onboard.step = 1;
    renderOnboard();
    return;
  }
  if (onboard.step === 1) {
    await window.freeLLM.saveSettings({ mode: onboard.mode });
    onboard.step = 2;
    renderOnboard();
    return;
  }
  if (onboard.step === 2) {
    toast('正在写入软件配置…');
    const targets = [...onboard.selected];
    if (targets.length) await window.freeLLM.writeIntegrations(targets);
    await refresh();
    onboard.step = 3;
    renderOnboard();
    button.disabled = false;
    await runOnboardChecks();
    return;
  }
  await window.freeLLM.onboarding({ mode: onboard.mode, start: true });
  $('#onboarding').hidden = true;
  await refresh();
  toast('配置完成，控制台已就绪');
  } finally {
    onboardBusy = false;
    if (button) button.disabled = false;
  }
}

/* ── boot ─────────────────────────────────────────────── */

function bindShell() {
  $$('.nav-item').forEach((item) => {
    item.onclick = () => switchView(item.dataset.view);
  });
  $('#powerBtn').onclick = togglePower;
  $('#modelBadge').onclick = () => switchView('models');
  $('#commandBtn').onclick = openPalette;
  $('#sideSettings').onclick = () => switchView('settings');
  $('#refreshBtn').onclick = refresh;
  $('#modalClose').onclick = () => { $('#modal').hidden = true; };
  $('#modal').onclick = (event) => { if (event.target.id === 'modal') $('#modal').hidden = true; };
  $('#modalCopy').onclick = () => copy(modalText, '已复制');
  $('#paletteClose').onclick = closePalette;
  $('#palette').onclick = (event) => { if (event.target.id === 'palette') closePalette(); };
  $('#paletteInput').oninput = () => { paletteIndex = 0; renderPalette(); };
  $('#paletteInput').onkeydown = (event) => {
    const items = paletteResults();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      paletteIndex = Math.min(items.length - 1, paletteIndex + 1);
      renderPalette();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      paletteIndex = Math.max(0, paletteIndex - 1);
      renderPalette();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = items[paletteIndex];
      if (command) runPaletteCommand(command.id);
    }
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('#modal').hidden = true;
      closePalette();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if ($('#palette').hidden) openPalette(); else closePalette();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && /^[1-7]$/.test(event.key)) {
      event.preventDefault();
      switchView(viewOrder[Number(event.key) - 1]);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      switchView('settings');
    }
  });
  $('#onboardBack').onclick = () => {
    if (onboard.step > 0) { onboard.step -= 1; renderOnboard(); }
  };
  $('#onboardNext').onclick = () => onboardNext().catch((error) => toast(error.message, true));
}

async function boot() {
  bindShell();
  setupRipple();
  initAmbient();
  appState = await window.freeLLM.getState();
  if (!appState?.config) throw new Error(appState?.error || '无法读取应用状态');
  onboard.selected = new Set(
    (appState.integrations || [])
      .filter((app) => app.installed && app.auto)
      .map((app) => app.id),
  );
  window.freeLLM.onState((next) => {
    appState = next;
    if ($('#onboarding').hidden) renderView();
  });
  window.freeLLM.onInstallStatus?.((status) => {
    if (!status) return;
    if (status.state === 'starting') {
      toast(`正在安装 ${status.index}/${status.total}：${status.label}`);
      return;
    }
    if (status.code === 0) {
      toast(status.configured ? `${status.label} 安装完成，配置已写入` : `${status.label} 安装完成`);
    } else {
      toast(`${status.label} 安装失败，退出码 ${status.code}，见安装日志`, true);
    }
    refresh().catch(() => {});
  });
  if (!appState.config.onboardingComplete) {
    $('#onboarding').hidden = false;
    renderOnboard();
    window.freeLLM.refreshSystem().then((system) => {
      appState.system = system;
      renderOnboard();
    }).catch(() => {});
  } else {
    $('#onboarding').hidden = true;
    switchView('overview');
  }
}

boot().catch((error) => {
  document.body.innerHTML = `<div style="padding:40px;color:#ef7d6d;font-family:monospace">控制台启动失败：${esc(error.message)}</div>`;
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

// Every path and port can be overridden so the same router runs unchanged on
// Windows, macOS and Linux. The D:\FreeLLMAPI defaults keep the original
// single-machine install working.
const DEFAULT_HOME = process.platform === 'win32' && fs.existsSync('D:/FreeLLMAPI')
  ? 'D:\\FreeLLMAPI'
  : __dirname;
const HOME_DIR = path.resolve(process.env.FREELLM_HOME || DEFAULT_HOME);
const HOME_FILE = (name, envName) => path.resolve(process.env[envName] || path.join(HOME_DIR, name));
const CATALOG = HOME_FILE('model-catalog.json', 'FREELLM_CATALOG');
const LOG = HOME_FILE('router.log', 'FREELLM_ROUTER_LOG');
const OWNER_FILE = HOME_FILE('UNIFIED_API_KEY.txt', 'FREELLM_OWNER_KEY_FILE');
const FRIEND_FILE = HOME_FILE('friend-key.txt', 'FREELLM_FRIEND_KEY_FILE');
const USAGE_FILE = HOME_FILE('friend-usage.json', 'FREELLM_USAGE_FILE');
const BASE_HOST = process.env.FREELLM_UPSTREAM_HOST || '127.0.0.1';
const BASE_PORT = Number(process.env.FREELLM_UPSTREAM_PORT || 3001);
const LISTEN_PORT = Number(process.env.FREELLM_ROUTER_PORT || 3002);
const LISTEN_HOST = process.env.FREELLM_BIND_HOST || '127.0.0.1';
const OLLAMA_BASE = process.env.FREELLM_OLLAMA_URL || `http://127.0.0.1:${process.env.FREELLM_OLLAMA_PORT || 11434}`;
const PRIVACY_MODEL = (process.env.FREELLM_PRIVACY_MODEL || '').trim();
const MAX_CONCURRENT = 4;
const FRIEND_MAX_CONCURRENT = 2;
const OWNER_RATE_PER_MIN = 240;
const FRIEND_RATE_PER_MIN = Number(process.env.FRIEND_RATE_PER_MIN || 20);
const FRIEND_DAILY = Number(process.env.FRIEND_DAILY || 300);
const MAX_BODY = 30 * 1024 * 1024;

let OWNER_KEY = '';
try { OWNER_KEY = fs.readFileSync(OWNER_FILE, 'utf8').trim(); } catch {}
if (!OWNER_KEY) {
  console.error(`Missing owner key: ${OWNER_FILE}`);
  process.exit(1);
}
let FRIEND_KEY = fs.existsSync(FRIEND_FILE) ? fs.readFileSync(FRIEND_FILE, 'utf8').trim() : '';
if (!FRIEND_KEY) {
  FRIEND_KEY = 'freellmapi-friend-' + crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(FRIEND_FILE), { recursive: true });
  fs.writeFileSync(FRIEND_FILE, FRIEND_KEY, 'utf8');
}

let active = 0;
let activeFriends = 0;
const buckets = new Map();
const friendBuckets = new Map();
let usage = { day: new Date().toISOString().slice(0, 10), counts: {} };
try { usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch {}

function today() { return new Date().toISOString().slice(0, 10); }
function loadUsage() { if (usage.day !== today()) { usage = { day: today(), counts: {} }; saveUsage(); } }
function saveUsage() { try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usage), 'utf8'); } catch {} }
function friendUsed(ip) { loadUsage(); return usage.counts[ip] || 0; }
function friendInc(ip) { loadUsage(); usage.counts[ip] = (usage.counts[ip] || 0) + 1; saveUsage(); }

let catalog = [];
let usable = [];
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8')).models || [];
  usable = catalog.filter(m => m.usableNow && m.chatCapable);
} catch (e) {
  console.error('catalog load failed', e.message);
}

const byRoute = new Map(usable.map(m => [m.routeModelId, m]));
const aliases = [
  'auto', 'smart', 'fast', 'task-router',
  'auto:code', 'auto:vision', 'auto:office', 'auto:reasoning',
  'auto:translation', 'auto:long', 'auto:fast',
];

function log(obj) {
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'); } catch {}
}

function clientIp(req) {
  return (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown').toString();
}

function isPrivateIp(ip) {
  const x = String(ip).replace(/^::ffff:/, '');
  return x === '::1' || x === '127.0.0.1' || x.startsWith('127.') ||
    x.startsWith('10.') || x.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(x);
}

function authProfile(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  let t = m ? m[1].trim() : '';
  if (!t && typeof req.headers['x-api-key'] === 'string') {
    t = req.headers['x-api-key'].trim();
  }
  if (!t) return null;
  if (t === OWNER_KEY) return 'owner';
  if (t === FRIEND_KEY) return 'friend';
  return null;
}

function rateOk(ip, limit, map) {
  const now = Date.now();
  let b = map.get(ip);
  if (!b || now >= b.reset) {
    b = { count: 0, reset: now + 60000 };
    map.set(ip, b);
  }
  b.count++;
  return b.count <= limit;
}

function contentText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => typeof p === 'string' ? p : (p.text || p.content || '')).join('\n');
  return '';
}

function analyze(body) {
  const messages = Array.isArray(body.messages) ? body.messages : (Array.isArray(body.input) ? body.input : []);
  let text = '';
  if (typeof body.input === 'string') text += body.input + '\n';
  if (Array.isArray(body.input)) text += body.input.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n');
  for (const m of messages) text += contentText(m.content) + '\n';
  if (body.system) text += (typeof body.system === 'string' ? body.system : JSON.stringify(body.system)) + '\n';
  const rawMsgs = JSON.stringify(messages);
  const hasImage = rawMsgs.includes('image_url') || rawMsgs.includes('input_image');
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const lower = text.toLowerCase();
  const s = { code: 0, vision: 0, office: 0, reasoning: 0, translation: 0, long_context: 0 };
  if (hasImage) s.vision += 200;
  if (hasTools) s.code += 35;
  const add = (key, words, w) => {
    for (const x of words) if (lower.includes(x)) s[key] += w;
  };
  add('code', ['代码','编程','函数','报错','异常','重构','调试','编译','测试','部署','接口','数据库','sql','python','typescript','javascript','react','vue','java','golang','rust','c++','git','docker','api','bug','stack trace','traceback','单元测试','性能优化','脚本','算法'], 10);
  add('vision', ['设计','ui','ux','figma','海报','配色','布局','截图','图片','视觉','banner','logo','原型','交互','字体','排版','美化'], 12);
  add('office', ['总结','邮件','报告','ppt','excel','文档','会议','周报','方案','写作','润色','改写','通知','简历','合同','表格','办公'], 8);
  add('reasoning', ['推理','数学','证明','分析','比较','为什么','逻辑','计算','规划','策略','评估','决策','权衡'], 8);
  add('translation', ['翻译','translate','英文','中文','日语','韩语'], 15);
  if (text.length > 20000) s.long_context += 50;
  if (text.length > 60000) s.long_context += 50;
  let task = 'office', best = 0;
  for (const [k, v] of Object.entries(s)) if (v > best) { best = v; task = k; }
  return {
    task, textLen: text.length, hasImage, hasTools,
    estimatedTokens: Math.ceil(text.length / 3),
    privacy: privacyScan(text),
  };
}

function privacyScan(text) {
  const reasons = [];
  const checks = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥'],
    [/\b(?:sk-[A-Za-z0-9_-]{20,}|sk-or-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/, 'API Key/Token'],
    [/(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{6,}['"]/i, '硬编码密码/密钥'],
    [/\b1[3-9]\d{9}\b/, '手机号'],
    [/\b\d{17}[\dXx]\b/, '身份证号'],
    [/\b(?:\d[ -]*?){13,19}\b/, '银行卡号'],
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, '邮箱'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'IP 地址'],
  ];
  for (const [re, label] of checks) if (re.test(text)) reasons.push(label);
  return { sensitive: reasons.length > 0, reasons };
}

function taskFromAlias(model) {
  if (!model.startsWith('auto:') && model !== 'smart' && model !== 'fast' && model !== 'task-router') return null;
  if (model === 'auto:code') return 'code';
  if (model === 'auto:vision') return 'vision';
  if (model === 'auto:office') return 'office';
  if (model === 'auto:reasoning') return 'reasoning';
  if (model === 'auto:translation') return 'translation';
  if (model === 'auto:long') return 'long_context';
  if (model === 'auto:fast' || model === 'fast') return 'fast';
  return 'auto';
}

function pick(task, ctx, mode, profile, localOnly = false) {
  const cands = usable.filter(m => {
    if (profile === 'friend' && m.local) return false;
    if (localOnly && !m.local) return false;
    if (ctx.hasImage && !m.capabilities.vision) return false;
    if (ctx.hasTools && !m.capabilities.tools) return false;
    if (m.contextWindow && ctx.estimatedTokens > 1000 && m.contextWindow < ctx.estimatedTokens * 1.2) return false;
    return true;
  });
  if (!cands.length) return null;
  return cands.map(m => {
    let score = 0;
    const t = m.tags || [];
    if (task === 'code') {
      if (t.includes('代码')) score += 140;
      if (t.includes('工具调用')) score += 20;
    }
    if (task === 'vision') {
      if (m.capabilities.vision) score += 180;
      if (m.local) score += profile === 'owner' ? 30 : 0;
    }
    if (task === 'office') {
      if (t.includes('中文')) score += 70;
      if (t.includes('通用')) score += 30;
    }
    if (task === 'reasoning') {
      if (t.includes('推理')) score += 80;
      score += Math.max(0, 100 - m.intelligenceRank) * 0.7;
    }
    if (task === 'translation') {
      if (t.includes('中文')) score += 80;
      if (t.includes('通用')) score += 30;
    }
    if (task === 'long_context') {
      if (t.includes('长文本')) score += 80;
      if ((m.contextWindow || 0) >= 200000) score += 80;
    }
    if (task === 'fast') {
      score += Math.max(0, 11 - m.speedRank) * 8;
      if (m.intelligenceRank > 70) score -= 40;
    }
    score += Math.max(0, 100 - m.intelligenceRank) * 0.9;
    score += Math.max(0, 11 - m.speedRank) * 2.5;
    if (m.local) score += profile === 'owner' ? (mode === 'quality' ? -30 : 10) : 0;
    if (m.keyless) score += profile === 'friend' ? 35 : 12;
    if (mode === 'quality') score += Math.max(0, 100 - m.intelligenceRank) * 1.2;
    if (mode === 'fast') score += Math.max(0, 11 - m.speedRank) * 6;
    if (m.limits && m.limits.rpd && m.limits.rpd < 100) score -= 15;
    if (m.limits && m.limits.rpm && m.limits.rpm <= 2) score -= 10;
    if (m.local && m.heavyLocal) score -= 500;
    return { m, score };
  }).sort((a, b) => b.score - a.score).map(x => x.m);
}

function localPrivacyModel(ctx) {
  if (PRIVACY_MODEL) {
    const explicit = usable.find(m => m.modelId === PRIVACY_MODEL || m.routeModelId === PRIVACY_MODEL);
    if (explicit && explicit.local) return explicit;
    return {
      modelId: PRIVACY_MODEL,
      routeModelId: PRIVACY_MODEL,
      local: true,
      usableNow: true,
    };
  }
  const preferred = ctx.hasImage
    ? ['gemma-3-12b-vision', 'qwen3-8b', 'gpt-oss-20b']
    : ['qwen3-8b', 'qwen3-14b', 'gpt-oss-20b'];
  for (const id of preferred) {
    const m = byRoute.get(id);
    if (m && m.local && m.usableNow) return m;
  }
  return usable.find(m => m.local && m.usableNow) || null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function upstreamRequest(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({}, headers, {
      host: BASE_HOST,
      authorization: `Bearer ${OWNER_KEY}`,
    });
    delete h['content-length'];
    if (body) h['content-length'] = body.length;
    const r = http.request({ host: BASE_HOST, port: BASE_PORT, path, method, headers: h }, res => resolve(res));
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function sendJson(res, code, obj, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, extra || {}));
  res.end(JSON.stringify(obj));
}

function modelsPayload(profile) {
  const list = profile === 'friend' ? usable.filter(m => !m.local) : usable;
  const data = aliases.map(id => ({
    id, object: 'model', created: 0, owned_by: 'task-router',
    name: id === 'auto' ? 'Auto task router' : id,
  }));
  for (const m of list) {
    data.push({
      id: m.routeModelId, object: 'model', created: 0, owned_by: m.platform,
      name: m.displayName, context_length: m.contextWindow || undefined,
    });
  }
  return { object: 'list', data };
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (url === '/health') {
    return sendJson(res, 200, {
      ok: true, active, activeFriends, maxConcurrent: MAX_CONCURRENT,
      friendMaxConcurrent: FRIEND_MAX_CONCURRENT, catalog: catalog.length, usable: usable.length,
    });
  }
  if (!(url === '/v1' || url.startsWith('/v1/'))) {
    return sendJson(res, 404, { error: { message: 'Only /v1 is exposed' } });
  }
  const profile = authProfile(req);
  if (!profile) return sendJson(res, 401, { error: { message: 'Invalid API key' } });
  const ip = clientIp(req);
  if (profile === 'friend') {
    if (!rateOk(ip, FRIEND_RATE_PER_MIN, friendBuckets)) {
      return sendJson(res, 429, { error: { message: 'Friend rate limit exceeded' } });
    }
    if (friendUsed(ip) >= FRIEND_DAILY) {
      return sendJson(res, 429, { error: { message: 'Friend daily quota exceeded' } });
    }
  } else if (!rateOk(ip, OWNER_RATE_PER_MIN, buckets)) {
    return sendJson(res, 429, { error: { message: 'Owner rate limit exceeded' } });
  }
  if (url === '/v1/usage') {
    return sendJson(res, 200, {
      profile, ip,
      used: profile === 'friend' ? friendUsed(ip) : null,
      dailyLimit: profile === 'friend' ? FRIEND_DAILY : null,
      remaining: profile === 'friend' ? Math.max(0, FRIEND_DAILY - friendUsed(ip)) : null,
    });
  }
  if (url === '/v1/models') return sendJson(res, 200, modelsPayload(profile));
  if (profile === 'friend' && (activeFriends >= FRIEND_MAX_CONCURRENT || active >= MAX_CONCURRENT)) {
    return sendJson(res, 429, { error: { message: 'Server busy, try again shortly' } });
  }
  if (profile === 'owner' && active >= MAX_CONCURRENT + 1) {
    return sendJson(res, 429, { error: { message: 'Server busy, try again shortly' } });
  }
  active++;
  if (profile === 'friend') activeFriends++;
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      active--;
      if (profile === 'friend') activeFriends--;
    }
  };
  res.on('close', finish);
  const started = Date.now();
  try {
    const isChat = req.method === 'POST' &&
      (url === '/v1/chat/completions' || url === '/v1/responses' || url === '/v1/messages');
    if (!isChat) {
      const up = await upstreamRequest(req.method, url, req.headers, null);
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
      up.on('end', finish);
      return;
    }
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { body = null; }
    if (!body || typeof body !== 'object') {
      const up = await upstreamRequest(req.method, url, req.headers, raw);
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
      up.on('end', finish);
      return;
    }
    const ctx = analyze(body);
    const requested = String(body.model || 'auto');
    const aliasTask = taskFromAlias(requested);
    const mode = (req.headers['x-router-mode'] ||
      (requested === 'smart' ? 'quality' : requested === 'fast' ? 'fast' : 'balanced')).toString();
    const task = aliasTask && aliasTask !== 'auto' ? aliasTask : ctx.task;
    const privacy = ctx.privacy || { sensitive: false, reasons: [] };
    if (privacy.sensitive && profile === 'friend') {
      log({ profile, ip, task, requested, mode, status: 400, reason: 'privacy_block', reasons: privacy.reasons });
      return sendJson(res, 400, {
        error: {
          message: 'Sensitive content blocked for public/friend requests. Use a local model on the owner machine.',
          type: 'privacy_block',
          reasons: privacy.reasons,
        },
      }, { 'x-privacy-guard': 'blocked' });
    }
    if (privacy.sensitive && profile === 'owner') {
      if (url !== '/v1/chat/completions') {
        finish();
        log({ profile, ip, task, requested, mode, status: 400, reason: 'privacy_local_endpoint_only', reasons: privacy.reasons });
        return sendJson(res, 400, {
          error: {
            message: 'Sensitive content is restricted to local OpenAI-compatible chat. Use Cline/Codex with a local model, or remove the sensitive data.',
            type: 'privacy_local_endpoint_only',
            reasons: privacy.reasons,
          },
        }, { 'x-privacy-guard': 'local-only' });
      }
      const chosen = localPrivacyModel(ctx);
      if (!chosen) {
        finish();
        log({ profile, ip, task, requested, mode, status: 503, reason: 'privacy_no_local', reasons: privacy.reasons });
        return sendJson(res, 503, {
          error: {
            message: 'Sensitive content detected, but no local model is available. Request blocked.',
            type: 'privacy_no_local',
            reasons: privacy.reasons,
          },
        }, { 'x-privacy-guard': 'local-only' });
      }
      const payload = Buffer.from(JSON.stringify(Object.assign({}, body, { model: chosen.modelId })));
      try {
        const up = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        if (up.status >= 400) {
          const detail = (await up.text()).slice(0, 400);
          finish();
          log({ profile, ip, task, mode, requested, status: 503, reason: 'privacy_local_unavailable', detail, privacy: 'local-only' });
          return sendJson(res, 503, {
            error: {
              message: '敏感内容仅允许本地模型，但本地模型当前无法加载（显存/内存不足）。请求已阻断，未发送到云端。请关闭占用显存的程序或重启 Ollama 后重试。',
              type: 'privacy_local_unavailable',
              detail,
            },
          }, { 'x-privacy-guard': 'local-only' });
        }
        const headers = Object.assign({}, Object.fromEntries(up.headers.entries()), {
          'x-task-router': task,
          'x-model-selected': chosen.routeModelId,
          'x-router-mode': mode,
          'x-router-profile': profile,
          'x-privacy-guard': 'local-only',
        });
        res.writeHead(up.status, headers);
        if (up.body) {
          const stream = Readable.fromWeb(up.body);
          stream.pipe(res);
          stream.on('end', finish);
          stream.on('close', finish);
        } else {
          finish();
          res.end();
        }
        log({ profile, ip, task, mode, requested, chosen: chosen.routeModelId, status: up.status, privacy: 'local-only', reasons: privacy.reasons });
      } catch (e) {
        finish();
        log({ profile, ip, status: 503, error: e.message, privacy: 'local-only' });
        if (!res.headersSent) {
          sendJson(res, 503, {
            error: {
              message: '敏感内容仅允许本地模型，但本地模型当前无法连接。请求已阻断，未发送到云端。',
              type: 'privacy_local_unavailable',
              detail: e.message,
            },
          }, { 'x-privacy-guard': 'local-only' });
        }
      }
      return;
    }
    let candidates = [];
    if (privacy.sensitive) {
      candidates = pick(task, ctx, mode, profile, true) || [];
    } else if (!aliasTask && byRoute.has(requested)) {
      const explicit = byRoute.get(requested);
      if (!(profile === 'friend' && explicit.local)) candidates = [explicit];
    } else {
      candidates = pick(task, ctx, mode, profile) || [];
    }
    if (privacy.sensitive && profile === 'owner' && !candidates.length) {
      log({ profile, ip, task, requested, mode, status: 503, reason: 'privacy_no_local', reasons: privacy.reasons });
      return sendJson(res, 503, {
        error: {
          message: 'Sensitive content detected, but no local model is available. Request blocked to avoid sending it to the cloud.',
          type: 'privacy_no_local',
          reasons: privacy.reasons,
        },
      }, { 'x-privacy-guard': 'local-only' });
    }
    if (!candidates.length) {
      log({ profile, ip, task, requested, mode, status: 503, reason: 'no candidate' });
      return sendJson(res, 503, {
        error: { message: `No usable free model for task=${task} in ${profile} profile` },
      });
    }
    let lastStatus = 502;
    let lastBody = null;
    for (let i = 0; i < Math.min(candidates.length, 3); i++) {
      const chosen = candidates[i];
      const payload = Buffer.from(JSON.stringify(Object.assign({}, body, { model: chosen.routeModelId })));
      let up;
      try {
        up = await upstreamRequest(
          req.method, url,
          Object.assign({}, req.headers, { 'content-type': 'application/json' }),
          payload,
        );
      } catch (e) {
        lastBody = String(e.message);
        continue;
      }
      lastStatus = up.statusCode || 502;
      if (lastStatus >= 400 && lastStatus !== 401 && lastStatus !== 403 && i < Math.min(candidates.length, 3) - 1) {
        let err = '';
        for await (const c of up) {
          err += c.toString();
          if (err.length > 2000) break;
        }
        lastBody = err.slice(0, 500);
        continue;
      }
      const headers = Object.assign({}, up.headers, {
        'x-task-router': task,
        'x-model-selected': chosen.routeModelId,
        'x-router-mode': mode,
        'x-router-attempt': String(i + 1),
        'x-router-profile': profile,
        'x-privacy-guard': privacy.sensitive ? 'local-only' : 'normal',
        'x-friend-quota-remaining': profile === 'friend'
          ? String(Math.max(0, FRIEND_DAILY - friendUsed(ip)))
          : 'unlimited',
      });
      res.writeHead(lastStatus, headers);
      up.pipe(res);
      up.on('end', () => {
        finish();
        if (profile === 'friend') friendInc(ip);
        log({
          profile, ip, task, mode, requested, chosen: chosen.routeModelId,
          attempt: i + 1, status: lastStatus, ms: Date.now() - started,
        });
      });
      return;
    }
    finish();
    log({ profile, ip, task, mode, requested, status: lastStatus, reason: 'all candidates failed', detail: lastBody });
    sendJson(res, lastStatus >= 400 ? lastStatus : 502, {
      error: { message: 'All candidate models failed', detail: lastBody },
    });
  } catch (e) {
    finish();
    log({ profile, ip, status: 500, error: e.message });
    if (!res.headersSent) sendJson(res, 500, { error: { message: e.message } });
  }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`task-router listening on ${LISTEN_HOST}:${LISTEN_PORT} usable=${usable.length} friendQuota=${FRIEND_DAILY}`);
});

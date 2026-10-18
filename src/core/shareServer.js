import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { loadCatalog } from './catalog.js';
import { mask } from './keys.js';
import { renderSharePage } from './sharePage.js';

function json(res, code, value, extra = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(JSON.stringify(value));
}

function html(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  });
  res.end(body);
}

export class ShareServer {
  constructor({ layout, store, routerPort, port, coreDir, getPublicUrl, getFriendKey }) {
    this.layout = layout;
    this.store = store;
    this.routerPort = routerPort;
    this.port = port;
    this.coreDir = coreDir;
    this.getPublicUrl = getPublicUrl;
    this.getFriendKey = getFriendKey;
    this.host = '127.0.0.1';
    this.server = null;
    this.ready = false;
  }

  token() {
    let token = this.store.getSecret('shareToken');
    if (!token) {
      token = crypto.randomBytes(24).toString('hex');
      this.store.setSecret('shareToken', token);
    }
    return token;
  }

  baseFor(req) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http';
    const host = req.headers.host || `127.0.0.1:${this.port}`;
    return `${proto}://${host}`;
  }

  localUrl() {
    return `http://127.0.0.1:${this.port}/share/${this.token()}`;
  }

  publicUrl() {
    const base = this.getPublicUrl();
    return base ? `${base}/share/${this.token()}` : '';
  }

  lanAddress() {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) return entry.address;
      }
    }
    return '';
  }

  lanUrl() {
    const address = this.lanAddress();
    return address ? `http://${address}:${this.port}/share/${this.token()}` : '';
  }

  packageText(base) {
    const key = this.getFriendKey();
    const modelFile = path.join(this.coreDir || this.layout.dataDir, 'model-catalog.json');
    const catalog = loadCatalog(modelFile);
    const models = catalog.usable.filter((model) => !model.local).slice(0, 30);
    return [
      'FreeLLM 朋友连接包',
      '',
      `OpenAI Base URL: ${base}/v1`,
      `Anthropic Base URL: ${base}`,
      `API Key: ${key}`,
      '默认模型: auto:code',
      '可用别名: auto / auto:code / auto:office / auto:reasoning / auto:vision / smart / fast',
      '',
      '可用模型:',
      ...models.map((model) => `- ${model.id}  ${model.name}`),
      '',
      '把 Base URL 和 API Key 填进任意 OpenAI 兼容客户端即可。',
      '敏感内容会被直接拒绝，不会发到云端。',
    ].join('\n');
  }

  async start() {
    if (this.server) return;
    fs.mkdirSync(this.layout.logDir, { recursive: true });
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        try { json(res, 500, { error: error.message }); } catch {}
      });
    });
    try {
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.port, this.host, resolve);
      });
      this.ready = true;
    } catch (error) {
      this.server = null;
      this.ready = false;
      throw error;
    }
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.ready = false;
    await new Promise((resolve) => server.close(resolve));
  }

  async restart(host) {
    await this.stop();
    this.host = host || '127.0.0.1';
    await this.start();
  }

  proxy(req, res) {
    const upstream = http.request({
      host: '127.0.0.1',
      port: this.routerPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1' },
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) json(res, 502, { error: 'router unavailable' });
      else res.end();
    });
    req.pipe(upstream);
  }

  async handle(req, res) {
    const url = new URL(req.url || '/', this.baseFor(req));
    const pathname = url.pathname;
    const token = this.token();

    if (pathname === '/health' || pathname === '/v1' || pathname.startsWith('/v1/')) {
      return this.proxy(req, res);
    }

    if (pathname === '/' && this.host === '127.0.0.1') {
      res.writeHead(302, { Location: `/share/${token}` });
      return res.end();
    }

    if (pathname === `/share/${token}`) {
      return html(res, renderSharePage(token));
    }

    if (pathname === `/share/${token}/info`) {
      const base = this.baseFor(req);
      const modelFile = path.join(this.coreDir || this.layout.dataDir, 'model-catalog.json');
      const catalog = loadCatalog(modelFile);
      return json(res, 200, {
        title: 'FreeLLM 朋友入口',
        apiBase: `${base}/v1`,
        anthropicBase: base,
        friendKeyMasked: mask(this.getFriendKey()),
        models: catalog.usable.filter((model) => !model.local).map((model) => ({
          id: model.id,
          name: model.name,
          tags: model.tags,
          contextWindow: model.contextWindow,
        })),
        total: catalog.total,
        usable: catalog.usableCount,
      });
    }

    if (pathname === `/share/${token}/key`) {
      const key = this.getFriendKey();
      if (!key) return json(res, 404, { error: 'Friend Key 尚未生成' });
      return json(res, 200, { key });
    }

    if (pathname === `/share/${token}/package`) {
      const base = this.baseFor(req);
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="freellm-connect.txt"',
        'Cache-Control': 'no-store',
      });
      return res.end(this.packageText(base));
    }

    return json(res, 404, { error: 'Not found' });
  }

  page() {
    const token = this.token();
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>FreeLLM 朋友入口</title>
<style>
:root{--bg:#0b0e11;--panel:#151b21;--line:#28343d;--text:#e9eef2;--muted:#93a1ac;--amber:#e6b45e;--mint:#7bd6b1;--coral:#ef7d6d;--mono:"Cascadia Mono","SFMono-Regular",Consolas,monospace;--sans:"Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(700px 400px at 80% 0,rgba(230,180,94,.09),transparent 60%),var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.7;font-synthesis:none;-webkit-font-smoothing:auto}
.wrap{max-width:860px;margin:0 auto;padding:30px 18px 60px}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.mark{width:38px;height:38px;border:1px solid var(--line);border-radius:10px;background:#12181d;position:relative}
.mark:before,.mark:after{content:"";position:absolute;left:11px;top:18px;width:16px;height:2px;background:var(--amber);border-radius:2px}
.mark:before{transform:rotate(28deg);width:11px;left:11px;top:13px}.mark:after{transform:rotate(-28deg);width:11px;left:11px;top:24px}
.brand b{font-size:17px}.brand span{display:block;font-family:var(--sans);font-size:10px;font-weight:600;letter-spacing:.08em;color:var(--muted)}
h1{font-size:36px;line-height:1.18;margin:0 0 8px;letter-spacing:-.3px}
.lead{color:var(--muted);margin:0 0 20px;font-size:15px;max-width:680px}
.panel{background:linear-gradient(180deg,rgba(255,255,255,.02),transparent 50%),var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px;margin:12px 0}
.signal{display:flex;align-items:center;gap:8px;margin:0 0 22px;flex-wrap:wrap}
.signal-node{border:1px solid var(--line);border-radius:8px;padding:5px 9px;font-size:11px;font-weight:500;background:var(--panel);color:var(--muted)}
.signal-node.live{border-color:rgba(123,214,177,.3);color:var(--mint);background:rgba(123,214,177,.06)}
.signal-line{width:22px;height:1px;background:var(--line);position:relative}
.signal-line:after{content:"";position:absolute;top:-1px;left:0;width:5px;height:3px;border-radius:2px;background:var(--amber);opacity:.8}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 18px}
.stat{padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.stat b{display:block;font-size:15px}.stat span{display:block;font-size:10px;color:var(--faint);margin-top:1px}
.package{border-color:rgba(230,180,94,.24);background:linear-gradient(120deg,rgba(230,180,94,.08),transparent 65%),var(--panel)}
.eyebrow{font-family:var(--sans);font-size:10px;font-weight:600;letter-spacing:.06em;color:var(--muted);margin:0 0 6px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.row>div{flex:1;min-width:220px}
code,.mono{font-family:var(--mono);font-size:11px;word-break:break-all}
.value{background:#0d1216;border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:6px;color:var(--mint)}
button{height:38px;border-radius:9px;border:1px solid var(--line);background:#1b242b;color:var(--text);padding:0 14px;font-size:12px;font-weight:500;cursor:pointer;transition:transform .14s cubic-bezier(.23,1,.32,1),background .18s ease,border-color .18s ease}
button.primary{background:var(--amber);border-color:var(--amber);color:#1b1407;font-weight:600}
button:active{transform:scale(.97)}
button:hover{border-color:#44535f;background:#222c34}
button.primary:hover{background:#f0c273;border-color:#f0c273}
.warn{border-color:rgba(230,180,94,.28);background:rgba(230,180,94,.07);color:var(--muted);font-size:12px}
.warn b{color:var(--text)}
.search{width:100%;height:36px;border:1px solid var(--line);border-radius:8px;background:#0d1216;color:var(--text);padding:0 11px;margin:10px 0}
.model{display:flex;justify-content:space-between;gap:12px;padding:10px 11px;border-bottom:1px solid var(--line);font-size:13px}
.model:last-child{border-bottom:0}.model span{color:var(--muted);font-family:var(--mono);font-size:9px}
.tag{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 6px;font-family:var(--mono);font-size:9px;color:var(--muted);margin-left:5px}
.steps{font-size:12px;color:var(--muted);padding-left:18px}.steps li{margin:6px 0}.steps b{color:var(--text)}
.foot{color:var(--muted);font-size:10px;margin-top:20px;text-align:center}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#1d262e;border:1px solid var(--line);border-radius:8px;padding:9px 13px;font-size:12px;opacity:0;transition:.2s;pointer-events:none}
.toast.on{opacity:1}
@media(max-width:600px){h1{font-size:28px}.wrap{padding:20px 14px 42px}.panel{padding:15px}.stats{grid-template-columns:1fr 1fr}.brand{margin-bottom:18px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><div class="mark"></div><div><b>FreeLLM</b><span>朋友入口</span></div></div>
  <h1>你的免费模型入口</h1>
  <p class="lead">这里是一个只读连接页。把下面的地址和 Key 填进任意 OpenAI 兼容客户端即可使用；不包含管理后台。</p>
  <div class="signal">
    <span class="signal-node live">你</span><span class="signal-line"></span>
    <span class="signal-node live">统一网关</span><span class="signal-line"></span>
    <span class="signal-node">免费模型池</span>
  </div>
  <div class="stats">
    <div class="stat"><b id="statModels">—</b><span>可用模型</span></div>
    <div class="stat"><b>OpenAI + Anthropic</b><span>兼容协议</span></div>
    <div class="stat"><b>只读访问</b><span>不含管理后台</span></div>
  </div>

  <div class="panel">
    <p class="eyebrow">OpenAI 地址</p>
    <div class="row"><div><div class="value" id="apiBase">连接中…</div></div><button class="primary" id="copyBase">复制</button></div>
    <p class="eyebrow" style="margin-top:14px">朋友 Key</p>
    <div class="row"><div><div class="value" id="keyMasked">未加载</div></div><button id="copyKey">显示并复制</button></div>
  </div>

  <div class="panel package">
    <div class="row"><div><p class="eyebrow">快捷连接包</p><b>一键复制连接包</b><div style="color:var(--muted);font-size:11px;margin-top:3px">包含 Base URL、Friend Key、模型别名和客户端填写说明。</div></div><button class="primary" id="copyPackage">复制连接包</button></div>
  </div>

  <div class="panel">
    <p class="eyebrow">模型</p>
    <div class="row"><div><b>可用模型</b><div style="color:var(--muted);font-size:11px" id="modelCount">加载中</div></div></div>
    <input class="search" id="search" placeholder="搜索模型或标签">
    <div id="models"></div>
  </div>

  <div class="panel">
    <p class="eyebrow">使用方法</p>
    <ol class="steps">
      <li><b>Cline / Cherry Studio</b>：Provider 选 OpenAI Compatible，Base URL 填上面的地址，Key 粘贴 Friend Key。</li>
      <li><b>Codex / Claude Code / Aider</b>：把 Base URL 和 Key 写进对应环境变量或配置。</li>
      <li><b>模型名</b>：日常用 <code>auto:code</code>，通用问答用 <code>auto</code>，需要更强推理用 <code>smart</code>。</li>
    </ol>
  </div>

  <div class="panel warn"><b>注意：</b>这个链接本身就是访问凭证，拿到链接的人可以使用 Friend Key。不要发到公开群组；敏感内容会被服务端直接拒绝，不会发往云端。</div>
  <div class="foot">FreeLLM Console · 只读朋友入口</div>
</div>
<div class="toast" id="toast"></div>
<script>
const TOKEN = ${JSON.stringify(token)};
let info = null;
const $ = (id) => document.getElementById(id);
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('on');setTimeout(()=>el.classList.remove('on'),1800)}
async function copy(text,label){try{await navigator.clipboard.writeText(text);toast(label||'已复制')}catch{toast('复制失败，请手动选择')}}
function renderModels(){
  const q=($('search').value||'').toLowerCase();
  const list=(info?.models||[]).filter(m=>!q||(m.id+' '+m.name+' '+(m.tags||[]).join(' ')).toLowerCase().includes(q));
  $('models').innerHTML=list.map(m=>'<div class="model"><div><b>'+esc(m.name)+'</b><span style="display:block">'+esc(m.id)+'</span></div><div>'+(m.tags||[]).slice(0,3).map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div></div>').join('')||'<div style="color:var(--muted);font-size:12px;padding:12px 0">没有匹配模型</div>';
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function boot(){
  const r=await fetch('/share/'+TOKEN+'/info');
  info=await r.json();
  $('apiBase').textContent=info.apiBase;
  $('keyMasked').textContent=info.friendKeyMasked;
  $('modelCount').textContent=info.usable+' 个可用 / '+info.total+' 个目录';
  $('statModels').textContent=info.usable+' 个';
  renderModels();
}
$('copyBase').onclick=()=>copy(info?.apiBase||'','Base URL 已复制');
$('copyKey').onclick=async()=>{const r=await fetch('/share/'+TOKEN+'/key');const j=await r.json();if(j.key){$('keyMasked').textContent=j.key;copy(j.key,'Friend Key 已复制')}else toast(j.error||'没有 Key')};
$('copyPackage').onclick=async()=>{const r=await fetch('/share/'+TOKEN+'/package');copy(await r.text(),'连接包已复制')};
$('search').oninput=renderModels;
boot().catch(()=>toast('加载失败，请让主人检查服务'));
</script>
</body>
</html>`;
  }
}

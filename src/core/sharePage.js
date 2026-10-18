export function renderSharePage(token) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0e11">
<meta name="robots" content="noindex,nofollow">
<title>FreeLLM 朋友入口</title>
<style>
:root{
  --bg:#0a0d10;--panel:#141a1f;--panel2:#1a2229;--panel3:#202a32;
  --line:#27323a;--line2:#35434d;--text:#edf1f4;--muted:#95a3ad;--faint:#64727c;
  --amber:#e6b45e;--mint:#7bd6b1;--coral:#ef7d6d;
  --sans:"Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Segoe UI",sans-serif;
  --mono:"Cascadia Mono","SFMono-Regular",Consolas,monospace;
  --ease:cubic-bezier(.23,1,.32,1);
}
[data-theme="light"]{--bg:#f3f1ea;--panel:#fffdf8;--panel2:#f6f3eb;--panel3:#eeebe2;--line:#ddd7ca;--line2:#c9c1b1;--text:#182026;--muted:#5d6a71;--faint:#8b948f}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:radial-gradient(900px 520px at 78% -8%,rgba(230,180,94,.1),transparent 65%),radial-gradient(700px 500px at 2% 100%,rgba(123,214,177,.06),transparent 65%),var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.7;font-synthesis:none;-webkit-font-smoothing:auto}
button,input{font:inherit;color:inherit}
button{cursor:pointer}
button:focus-visible,input:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px 90px}
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;padding:14px 0;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:11px}
.mark{width:36px;height:36px;border:1px solid var(--line2);border-radius:10px;background:linear-gradient(145deg,var(--panel3),var(--panel));position:relative;flex:none}
.mark:before,.mark:after{content:"";position:absolute;left:10px;top:17px;width:16px;height:2px;background:var(--amber);border-radius:2px}
.mark:before{transform:rotate(28deg);width:11px;top:12px}.mark:after{transform:rotate(-28deg);width:11px;top:23px}
.brand b{display:block;font-size:15px;line-height:1.2}.brand span{display:block;font-size:10px;color:var(--faint);letter-spacing:.06em}
.top-spacer{flex:1}
.pill{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px;border:1px solid var(--line);border-radius:999px;background:var(--panel);font-size:11px;color:var(--muted)}
.pill .dot{width:6px;height:6px;border-radius:50%;background:var(--faint)}
.pill.live .dot{background:var(--mint);box-shadow:0 0 0 3px rgba(123,214,177,.1);animation:breathe 2.4s ease-in-out infinite}
.icon{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--muted)}
.icon:hover{color:var(--text);border-color:var(--line2)}
.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:30px;align-items:start;padding:54px 0 34px}
.hero-copy{max-width:760px}
.eyebrow{margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:.08em;color:var(--faint)}
.hero h1{margin:0;font-size:clamp(34px,5.2vw,58px);line-height:1.08;letter-spacing:-.8px;font-weight:600}
.hero h1 span{color:var(--amber)}
.hero .lead{max-width:620px;margin:16px 0 0;color:var(--muted);font-size:15px}
.hero-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:24px}
.btn{height:40px;padding:0 16px;border:1px solid var(--line2);border-radius:10px;background:var(--panel2);color:var(--text);font-size:13px;font-weight:500;transition:transform .14s var(--ease),background .18s ease,border-color .18s ease}
.btn:hover{background:var(--panel3);border-color:var(--line2)}
.btn:active{transform:scale(.97)}
.btn.primary{background:var(--amber);border-color:var(--amber);color:#1b1407;font-weight:600}
.btn.primary:hover{background:#f0c273;border-color:#f0c273}
.hero-stats{display:flex;gap:24px;margin-top:26px}
.hero-stat b{display:block;font-size:22px;line-height:1.1}.hero-stat span{display:block;font-size:10px;color:var(--faint);margin-top:4px}
.signal{display:flex;align-items:center;gap:8px;margin-top:18px;flex-wrap:wrap}
.signal-node{padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--panel);font-size:11px;color:var(--muted)}
.signal-node.live{border-color:rgba(123,214,177,.28);color:var(--mint);background:rgba(123,214,177,.06)}
.signal-line{width:24px;height:1px;background:var(--line);position:relative}
.signal-line:after{content:"";position:absolute;top:-1px;left:0;width:5px;height:3px;border-radius:2px;background:var(--amber);opacity:.8}
.hero-aside{padding:6px;border:1px solid var(--line);border-radius:20px;background:color-mix(in srgb,var(--panel) 65%,transparent);align-self:end}
.hero-aside-card{padding:20px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(160deg,rgba(230,180,94,.09),transparent 60%),var(--panel)}
.hero-aside-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.hero-aside-big{display:flex;align-items:flex-end;gap:8px;margin:18px 0 14px}
.hero-aside-big b{font-size:48px;line-height:.9;letter-spacing:-1px}.hero-aside-big span{font-size:10px;color:var(--faint);padding-bottom:4px}
.hero-aside-rows{display:flex;flex-direction:column;gap:7px;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.hero-aside-row{display:flex;justify-content:space-between;gap:12px;font-size:10px}.hero-aside-row span{color:var(--faint)}.hero-aside-row b{font-weight:500;text-align:right}
.hero-aside .btn{width:100%;margin-top:14px}
.pass-shell{grid-column:1/-1;width:100%;padding:7px;border:1px solid var(--line);border-radius:24px;background:color-mix(in srgb,var(--panel) 72%,transparent);box-shadow:inset 0 1px 1px rgba(255,255,255,.04)}
.pass{display:grid;grid-template-columns:1fr 300px;border:1px solid var(--line);border-radius:18px;background:var(--panel);overflow:hidden}
.pass-main{padding:22px}
.pass-side{padding:22px;border-left:1px dashed var(--line2);background:linear-gradient(180deg,rgba(230,180,94,.06),transparent 65%),var(--panel2)}
.pass-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.pass-head b{font-size:13px}.pass-head span{font-family:var(--mono);font-size:9px;color:var(--mint);letter-spacing:.1em}
.field{margin-bottom:14px}
.field label{display:block;font-size:10px;color:var(--faint);margin-bottom:5px}
.field-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
.value{padding:10px 11px;border:1px solid var(--line);border-radius:9px;background:var(--bg);font-family:var(--mono);font-size:11px;color:var(--mint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mini-btn{height:36px;padding:0 12px;border:1px solid var(--line2);border-radius:8px;background:var(--panel3);font-size:11px}
.mini-btn:hover{border-color:var(--amber);color:var(--amber)}
.pass-side h3{margin:0 0 5px;font-size:14px}.pass-side p{margin:0 0 16px;font-size:11px;color:var(--faint)}
.side-model{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:11px}
.side-model:last-of-type{border-bottom:0}.side-model span{color:var(--faint);font-family:var(--mono);font-size:9px}
.side-note{margin-top:14px;padding:10px;border:1px solid rgba(230,180,94,.2);border-radius:9px;background:rgba(230,180,94,.06);font-size:10px;color:var(--muted)}
.section{padding:38px 0 0}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:14px}
.section-head h2{margin:0;font-size:22px;letter-spacing:-.2px}.section-head p{margin:3px 0 0;font-size:11px;color:var(--faint)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
.step{padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.step .n{font-family:var(--mono);font-size:10px;color:var(--amber)}
.step b{display:block;margin:8px 0 3px;font-size:13px}.step span{font-size:10px;color:var(--faint)}
.clients{display:grid;grid-template-columns:190px 1fr;gap:10px}
.tabs{display:flex;flex-direction:column;gap:5px}
.tab{text-align:left;padding:9px 11px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--muted);font-size:11px}
.tab:hover{background:var(--panel2);color:var(--text)}
.tab.is-on{border-color:rgba(230,180,94,.25);background:rgba(230,180,94,.08);color:var(--amber)}
.client-panel{padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.client-panel h3{margin:0 0 5px;font-size:15px}.client-panel p{margin:0 0 12px;font-size:11px;color:var(--faint)}
.config{position:relative;padding:14px;border:1px solid var(--line);border-radius:9px;background:var(--bg);font-family:var(--mono);font-size:10px;line-height:1.85;color:var(--muted);white-space:pre-wrap;overflow:auto}
.config-actions{display:flex;gap:7px;justify-content:flex-end;margin-top:10px}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.chip{height:28px;padding:0 10px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--muted);font-size:10px}
.chip.is-on{border-color:rgba(230,180,94,.3);background:rgba(230,180,94,.08);color:var(--amber)}
.search{flex:1;min-width:190px;height:34px;padding:0 11px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);font-size:11px}
.model-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.model-card{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;border:1px solid var(--line);border-radius:10px;background:var(--panel);cursor:pointer;transition:border-color .16s ease,transform .16s var(--ease)}
.model-card:hover{border-color:var(--line2);transform:translateY(-1px)}
.model-card b{display:block;font-size:12px}.model-card span{display:block;font-family:var(--mono);font-size:9px;color:var(--faint);margin-top:2px}
.model-tags{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.model-tags i{font-style:normal;padding:1px 5px;border:1px solid var(--line);border-radius:4px;font-size:9px;color:var(--faint)}
.foot{padding:34px 0 0;text-align:center;font-size:10px;color:var(--faint)}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,8px);z-index:50;padding:9px 14px;border:1px solid var(--line2);border-radius:9px;background:var(--panel3);font-size:12px;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s var(--ease)}
.toast.on{opacity:1;transform:translate(-50%,0)}
.mobile-bar{display:none}
@keyframes breathe{0%,100%{opacity:1}50%{opacity:.45}}
@media(max-width:860px){
  .wrap{padding:0 16px 100px}.hero{grid-template-columns:1fr;padding:36px 0 26px}.pass-shell{grid-column:auto}.pass{grid-template-columns:1fr}.pass-side{border-left:0;border-top:1px dashed var(--line2)}
  .steps,.model-grid{grid-template-columns:1fr}.clients{grid-template-columns:1fr}.tabs{flex-direction:row;overflow-x:auto}.tab{flex:none}
  .mobile-bar{display:grid;grid-template-columns:1fr 1fr;gap:8px;position:fixed;left:0;right:0;bottom:0;z-index:30;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(16px);border-top:1px solid var(--line)}
}
@media(max-width:520px){.hero h1{font-size:34px}.hero-stats{gap:16px}.field-row{grid-template-columns:1fr}.mini-btn{width:100%}.section-head{flex-direction:column;align-items:flex-start}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand"><div class="mark"></div><div><b>FreeLLM</b><span>朋友入口 · FRIEND PASS</span></div></div>
    <div class="top-spacer"></div>
    <span class="pill" id="healthPill"><span class="dot"></span><span id="healthText">检查网关</span></span>
    <button class="icon" id="themeBtn" aria-label="切换主题" title="切换主题">◐</button>
  </header>

  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">FREELLM · FRIEND ACCESS</p>
      <h1>一个地址，<br><span>接上你的免费模型。</span></h1>
      <p class="lead">这里是一个只读连接页。复制连接包，填进 Cline、Cherry Studio、Codex 或任意 OpenAI 兼容客户端即可开始；不包含管理后台。</p>
      <div class="hero-actions">
        <button class="btn primary" id="heroCopy">复制连接包</button>
        <button class="btn" id="heroGuide">查看客户端指南</button>
      </div>
      <div class="signal">
        <span class="signal-node live">你</span><span class="signal-line"></span>
        <span class="signal-node live">统一网关</span><span class="signal-line"></span>
        <span class="signal-node">免费模型池</span>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><b id="statModels">—</b><span>可用模型</span></div>
        <div class="hero-stat"><b>2</b><span>兼容协议</span></div>
        <div class="hero-stat"><b>0</b><span>需要安装的客户端</span></div>
      </div>
    </div>
    <aside class="hero-aside">
      <div class="hero-aside-card">
        <div class="hero-aside-head"><p class="eyebrow">LIVE CONNECTION</p><span class="pill live"><span class="dot"></span>在线</span></div>
        <div class="hero-aside-big"><b id="heroModels">—</b><span>个可用模型</span></div>
        <div class="hero-aside-rows">
          <div class="hero-aside-row"><span>协议</span><b>OpenAI + Anthropic</b></div>
          <div class="hero-aside-row"><span>路由</span><b>自动按任务选择</b></div>
          <div class="hero-aside-row"><span>隐私</span><b>敏感内容本地或阻断</b></div>
        </div>
        <button class="btn primary" id="asideCopy">复制连接包</button>
      </div>
    </aside>
    <div class="pass-shell">
      <div class="pass">
        <div class="pass-main">
          <div class="pass-head"><b>连接凭证</b><span>ACTIVE</span></div>
          <div class="field">
            <label>OpenAI Base URL</label>
            <div class="field-row"><div class="value" id="apiBase">加载中…</div><button class="mini-btn" data-copy="apiBase">复制</button></div>
          </div>
          <div class="field">
            <label>Anthropic Base URL</label>
            <div class="field-row"><div class="value" id="anthropicBase">加载中…</div><button class="mini-btn" data-copy="anthropicBase">复制</button></div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>朋友 Key</label>
            <div class="field-row"><div class="value" id="friendKey">freellmapi-f…</div><button class="mini-btn" id="revealKey">显示并复制</button></div>
          </div>
        </div>
        <aside class="pass-side">
          <h3>模型池</h3>
          <p>自动路由优先选可用的免费模型。</p>
          <div id="sideModels"></div>
          <div class="side-note">链接本身就是访问凭证。不要把朋友链接发到公开群组。</div>
        </aside>
      </div>
    </div>
  </section>

  <section class="section" id="guide">
    <div class="section-head"><div><h2>三步开始</h2><p>不需要注册、不需要装网关。</p></div></div>
    <div class="steps">
      <div class="step"><div class="n">01 / COPY</div><b>复制连接包</b><span>地址、Key、模型名一次复制。</span></div>
      <div class="step"><div class="n">02 / PASTE</div><b>填进客户端</b><span>Cline、Cherry、Codex、Claude Code 或任意 OpenAI 兼容客户端。</span></div>
      <div class="step"><div class="n">03 / CHAT</div><b>开始使用</b><span>模型名用 auto:code；复杂任务换 smart。</span></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>客户端配置</h2><p>选一个客户端，直接复制完整配置。</p></div></div>
    <div class="clients">
      <div class="tabs" id="clientTabs"></div>
      <div class="client-panel"><h3 id="clientTitle"></h3><p id="clientDesc"></p><pre class="config" id="clientConfig"></pre><div class="config-actions"><button class="btn small" id="copyClient">复制这份配置</button></div></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>模型池</h2><p>点击模型卡片即可复制模型 ID。</p></div></div>
    <div class="filters">
      <input class="search" id="modelSearch" placeholder="搜索模型或标签" />
      <button class="chip is-on" data-filter="all">全部</button>
      <button class="chip" data-filter="中文">中文</button>
      <button class="chip" data-filter="代码">代码</button>
      <button class="chip" data-filter="推理">推理</button>
      <button class="chip" data-filter="视觉">视觉</button>
      <button class="chip" data-filter="免Key">免 Key</button>
    </div>
    <div class="model-grid" id="modelGrid"></div>
  </section>

  <div class="foot">FreeLLM Console · 只读朋友入口 · 敏感内容会被拒绝，不会发往云端</div>
</div>

<div class="mobile-bar"><button class="btn primary" id="mobileCopy">复制连接包</button><button class="btn" id="mobileKey">显示 Key</button></div>
<div class="toast" id="toast"></div>
<script>
const TOKEN = ${JSON.stringify(token)};
const $ = (id) => document.getElementById(id);
let info = null;
let health = null;
let filter = 'all';
let query = '';
let client = 'cline';
let shownKey = '';
const clients = {
  cline: { title: 'Cline / VS Code', desc: 'OpenAI Compatible，适合多文件 Agent。', build: (k) => 'API Provider: OpenAI Compatible\\nBase URL: ' + info.apiBase + '\\nAPI Key: ' + k + '\\nModel: auto:code\\nContext Window: 32768\\nMax Output: 4096' },
  cherry: { title: 'Cherry Studio', desc: '类型选 OpenAI 兼容，API 地址填根地址。', build: (k) => '类型: OpenAI 兼容\\nAPI 地址: ' + info.anthropicBase + '\\nAPI 密钥: ' + k + '\\n模型: auto / auto:code / auto:office / auto:vision' },
  codex: { title: 'Codex CLI', desc: 'OpenAI Responses 协议。', build: (k) => 'OPENAI_BASE_URL=' + info.apiBase + '\\nOPENAI_API_KEY=' + k + '\\nmodel=smart\\nwire_api=responses' },
  claude: { title: 'Claude Code', desc: 'Anthropic Messages 协议。', build: (k) => 'ANTHROPIC_BASE_URL=' + info.anthropicBase + '\\nANTHROPIC_AUTH_TOKEN=' + k + '\\nANTHROPIC_MODEL=claude-sonnet-4-5' },
  aider: { title: 'Aider', desc: '终端结对编程，OpenAI 兼容。', build: (k) => 'OPENAI_API_BASE=' + info.apiBase + '\\nOPENAI_API_KEY=' + k + '\\naider --model openai/gpt-oss-20b' },
};
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(t){const el=$('toast');el.textContent=t;el.classList.add('on');setTimeout(()=>el.classList.remove('on'),1600)}
async function copy(text,label){try{await navigator.clipboard.writeText(text);toast(label||'已复制')}catch{toast('复制失败，请手动选择')}}
function renderSide(){
  $('sideModels').innerHTML=(info?.models||[]).slice(0,4).map(m=>'<div class="side-model"><b>'+esc(m.name)+'</b><span>'+esc(m.id)+'</span></div>').join('');
}
function renderModels(){
  const list=(info?.models||[]).filter(m=>{
    if(filter!=='all' && !(m.tags||[]).includes(filter)) return false;
    const q=query.toLowerCase();
    return !q || (m.id+' '+m.name+' '+(m.tags||[]).join(' ')).toLowerCase().includes(q);
  });
  $('modelGrid').innerHTML=list.map(m=>'<div class="model-card" data-model="'+esc(m.id)+'"><div><b>'+esc(m.name)+'</b><span>'+esc(m.id)+'</span></div><div class="model-tags">'+(m.tags||[]).slice(0,3).map(t=>'<i>'+esc(t)+'</i>').join('')+'</div></div>').join('')||'<div style="padding:18px;color:var(--faint);font-size:11px">没有匹配模型</div>';
  document.querySelectorAll('[data-model]').forEach(card=>card.onclick=()=>copy(card.dataset.model,'模型 ID 已复制'));
}
function renderClients(){
  $('clientTabs').innerHTML=Object.entries(clients).map(([id,c])=>'<button class="tab '+(id===client?'is-on':'')+'" data-client="'+id+'">'+esc(c.title)+'</button>').join('');
  document.querySelectorAll('[data-client]').forEach(btn=>btn.onclick=()=>{client=btn.dataset.client;renderClients()});
  const c=clients[client];
  $('clientTitle').textContent=c.title;
  $('clientDesc').textContent=c.desc;
  $('clientConfig').textContent=c.build(shownKey||'<Friend Key>');
}
async function loadKey(){
  if(shownKey) return shownKey;
  const r=await fetch('/share/'+TOKEN+'/key');
  const j=await r.json();
  if(!j.key) throw new Error(j.error||'没有 Key');
  shownKey=j.key;
  $('friendKey').textContent=shownKey;
  renderClients();
  return shownKey;
}
function setHealth(ok, label){
  const pill=$('healthPill'); pill.classList.toggle('live',!!ok); $('healthText').textContent=label;
}
async function boot(){
  try{
    const ir=await fetch('/share/'+TOKEN+'/info');
    info=await ir.json();
    try{const hr=await fetch('/health');health=await hr.json()}catch{health=null}
    $('apiBase').textContent=info.apiBase;
    $('anthropicBase').textContent=info.anthropicBase;
    $('friendKey').textContent=info.friendKeyMasked;
    $('statModels').textContent=info.usable;
    $('heroModels').textContent=info.usable;
    setHealth(health&&health.ok,health&&health.ok?'网关在线':'网关离线');
    renderSide(); renderModels(); renderClients();
  }catch(e){toast('加载失败，请让主人检查服务')}
}
document.querySelectorAll('[data-copy]').forEach(btn=>btn.onclick=()=>copy($(btn.dataset.copy).textContent,'已复制'));
$('revealKey').onclick=async()=>{try{const k=await loadKey();await copy(k,'Friend Key 已复制')}catch(e){toast(e.message)}};
$('heroCopy').onclick=async()=>{const r=await fetch('/share/'+TOKEN+'/package');await copy(await r.text(),'连接包已复制')};
$('asideCopy').onclick=$('heroCopy').onclick;
$('mobileCopy').onclick=$('heroCopy').onclick;
$('mobileKey').onclick=$('revealKey').onclick;
$('heroGuide').onclick=()=>$('guide').scrollIntoView({behavior:'smooth'});
$('copyClient').onclick=async()=>{try{const k=await loadKey();await copy(clients[client].build(k),'客户端配置已复制')}catch(e){toast(e.message)}};
$('modelSearch').oninput=e=>{query=e.target.value;renderModels()};
document.querySelectorAll('[data-filter]').forEach(btn=>btn.onclick=()=>{filter=btn.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('is-on',b===btn));renderModels()});
$('themeBtn').onclick=()=>{const light=document.documentElement.dataset.theme==='light';document.documentElement.dataset.theme=light?'':'light';localStorage.setItem('freellm-theme',light?'dark':'light')};
if(localStorage.getItem('freellm-theme')==='light')document.documentElement.dataset.theme='light';
boot();
</script>
</body>
</html>`;
}

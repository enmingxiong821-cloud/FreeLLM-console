// Dev-only helper: evaluate an expression inside the running Electron window.
// Usage:  @' ...js... '@ | node scripts/cdp-eval.mjs [--screenshot out.png]
import fs from 'node:fs';
import path from 'node:path';

const port = process.env.CDP_PORT || 9222;
const args = process.argv.slice(2);
const shotIndex = args.indexOf('--screenshot');
const shotPath = shotIndex >= 0 ? args[shotIndex + 1] : '';
const source = fs.readFileSync(0, 'utf8').trim();
if (!source) {
  console.error('cdp-eval: pass a JavaScript expression on stdin');
  process.exit(1);
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((item) => item.type === 'page');
if (!target) throw new Error('no Electron page target found');

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
};

await new Promise((resolve) => { ws.onopen = resolve; });
const result = await call('Runtime.evaluate', {
  expression: source,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});
if (result.exceptionDetails) {
  console.error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  process.exitCode = 1;
} else {
  const value = result.result?.value;
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
if (shotPath) {
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: ${shotPath}`);
}
ws.close();

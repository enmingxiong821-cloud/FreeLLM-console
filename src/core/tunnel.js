import fs from 'node:fs';
import path from 'node:path';
import { spawnLogged, stopProcess, commandPath } from './process.js';
import { ensureDir, isWindows } from './paths.js';
import { restrictFile } from './store.js';

export class TunnelManager {
  constructor({ layout, port, coreDir, resourcesPath, getTargetPort, onChange }) {
    this.layout = layout;
    this.port = port;
    this.getTargetPort = getTargetPort;
    this.coreDir = coreDir;
    this.resourcesPath = resourcesPath;
    this.onChange = onChange || (() => {});
    this.child = null;
    this.url = this.readUrl();
  }

  readUrl() {
    try {
      return fs.readFileSync(this.layout.publicUrlFile, 'utf8').trim();
    } catch {
      return '';
    }
  }

  writeUrl(url) {
    ensureDir(path.dirname(this.layout.publicUrlFile));
    fs.writeFileSync(this.layout.publicUrlFile, url || '', 'utf8');
    restrictFile(this.layout.publicUrlFile);
    this.url = url || '';
  }

  binary() {
    const names = isWindows ? ['cloudflared.exe', 'cloudflared'] : ['cloudflared'];
    const candidates = [];
    if (this.coreDir) candidates.push(...names.map((name) => path.join(this.coreDir, name)));
    if (this.resourcesPath) candidates.push(...names.map((name) => path.join(this.resourcesPath, 'bin', name)));
    for (const file of candidates) {
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {}
    }
    return commandPath('cloudflared');
  }

  status() {
    return {
      running: Boolean(this.child && this.child.exitCode === null),
      url: this.currentUrl(),
      binary: Boolean(this.binary()),
    };
  }

  currentUrl() {
    return this.child && this.child.exitCode === null ? this.readUrl() : '';
  }

  async start() {
    if (this.child && this.child.exitCode === null) return { ok: true, url: this.currentUrl() };
    const binary = this.binary();
    if (!binary) {
      throw new Error('未找到 cloudflared。把 cloudflared 放到安装目录，或先安装 Cloudflare Tunnel 客户端。');
    }
    this.writeUrl('');
    const logFile = path.join(this.layout.logDir, 'tunnel.log');
    let found = '';
    const targetPort = this.getTargetPort ? this.getTargetPort() : this.port;
    const child = spawnLogged(binary, [
      'tunnel', '--url', `http://127.0.0.1:${targetPort}`, '--no-autoupdate', '--logfile', logFile,
    ], {
      cwd: this.coreDir || this.layout.dataDir,
      logFile: path.join(this.layout.logDir, 'tunnel.stdout.log'),
      onLine: (line) => {
        const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match && !found) {
          found = match[0];
          this.writeUrl(found);
          this.onChange();
        }
      },
    });
    this.child = child;
    child.once('exit', () => {
      this.child = null;
      this.onChange();
    });
    const started = Date.now();
    while (!found && Date.now() - started < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (child.exitCode !== null) break;
    }
    if (!found) {
      await stopProcess(child);
      this.child = null;
      throw new Error('隧道没有在 30 秒内拿到公网地址，请查看 tunnel.log。');
    }
    this.onChange();
    return { ok: true, url: found };
  }

  async stop() {
    if (this.child) {
      await stopProcess(this.child);
      this.child = null;
    }
    this.writeUrl('');
    this.onChange();
    return { ok: true };
  }
}

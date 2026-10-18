import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { isWindows } from './paths.js';

const execFileAsync = promisify(execFile);

export async function run(command, args = [], options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeout || 8000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
    return { ok: true, stdout: String(stdout).trim(), stderr: String(stderr).trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || '').trim(),
      code: error.code,
    };
  }
}

export function commandPath(command) {
  try {
    const finder = isWindows ? 'where' : 'which';
    const output = execFileSync(finder, [command], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 2500,
    }).toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return output[0] || '';
  } catch {
    return '';
  }
}

export function commandExists(command) {
  return Boolean(commandPath(command));
}

export function spawnLogged(command, args, { cwd, env, logFile, onLine } = {}) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  const consume = (chunk) => {
    stream.write(chunk);
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    if (onLine) lines.forEach((line) => onLine(line));
  };
  child.stdout?.on('data', consume);
  child.stderr?.on('data', consume);
  child.once('exit', (code, signal) => {
    stream.write(`\n[${new Date().toISOString()}] exited code=${code} signal=${signal}\n`);
    stream.end();
  });
  return child;
}

export async function stopProcess(child, { timeout = 2500 } = {}) {
  if (!child || child.killed || child.exitCode !== null) return true;
  const pid = child.pid;
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.once('exit', () => done(true));
    try {
      // Always terminate the direct child first. On Windows taskkill can be
      // blocked by policy; child.kill() still reaches the process we spawned.
      child.kill();
      if (isWindows) {
        execFile('taskkill', ['/PID', String(pid), '/T'], { windowsHide: true }, () => {});
      }
    } catch {
      done(false);
    }
    setTimeout(() => {
      try {
        if (isWindows) {
          execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
        } else {
          child.kill('SIGKILL');
        }
      } catch {}
      done(true);
    }, timeout);
  });
}

export async function fetchJson(url, { timeout = 4000, ...options } = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ok: response.ok, status: response.status, data, text, headers: response.headers };
}

export async function waitForHealth(url, { timeout = 20000, interval = 350 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const result = await fetchJson(url, { timeout: 1500 });
      if (result.ok) return result;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}

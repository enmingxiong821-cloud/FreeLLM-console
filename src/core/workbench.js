import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isWindows } from './paths.js';

export function resolveWorkbench() {
  const env = process.env.PI_WORKBENCH_EXE;
  if (env && fs.existsSync(env)) return env;
  const candidates = [];
  if (isWindows) {
    candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Pi 工作台', 'Pi 工作台.exe'));
    candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Pi Workbench', 'Pi Workbench.exe'));
    const programs = path.join(process.env.LOCALAPPDATA || '', 'Programs');
    try {
      for (const name of fs.readdirSync(programs)) {
        if (!/pi.*(工作台|workbench)/i.test(name)) continue;
        const dir = path.join(programs, name);
        for (const exe of ['Pi 工作台.exe', 'Pi Workbench.exe', 'pi-workbench.exe']) {
          candidates.push(path.join(dir, exe));
        }
      }
    } catch {}
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Pi 工作台.app');
    candidates.push('/Applications/Pi Workbench.app');
  } else {
    candidates.push('/opt/Pi Workbench/pi-workbench');
  }
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function projectFiles() {
  const appData = process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config'));
  return [
    path.join(appData, 'pi-desktop-poc', 'projects.json'),
    path.join(appData, 'Pi 工作台', 'projects.json'),
  ];
}

export function readRecentProjects() {
  for (const file of projectFiles()) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(data.projects)) continue;
      return data.projects
        .filter((item) => item && typeof item.path === 'string' && typeof item.name === 'string')
        .slice(0, 12)
        .map((item) => ({
          name: item.name,
          path: item.path,
          lastUsed: Number(item.lastUsed) || 0,
          exists: fs.existsSync(item.path),
        }));
    } catch {}
  }
  return [];
}

export function launchWorkbench(project) {
  const exe = resolveWorkbench();
  if (!exe) throw new Error('没有找到 Pi 工作台。请先安装，或把 PI_WORKBENCH_EXE 指到可执行文件。');
  const args = project ? ['--project', project] : [];
  if (process.platform === 'darwin' && exe.endsWith('.app')) {
    spawn('open', ['-a', exe, '--args', ...args], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  }
  return { ok: true, exe, project: project || '' };
}

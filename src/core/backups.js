import fs from 'node:fs';
import path from 'node:path';
import { isWindows } from './paths.js';
import { restrictFile } from './store.js';

export function backupTargets(home) {
  const sh = isWindows ? '.cmd' : '.sh';
  return [
    { id: 'codex-local', app: 'Codex CLI', file: path.join(home, '.codex', 'freellm.config.toml') },
    { id: 'codex-smart', app: 'Codex CLI', file: path.join(home, '.codex', 'freellm-smart.config.toml') },
    { id: 'claude-settings', app: 'Claude Code', file: path.join(home, '.claude', 'settings.json') },
    { id: 'claude-launcher', app: 'Claude Code', file: path.join(home, '.freellm', `claude-freellm${sh}`) },
    { id: 'ccswitch', app: 'CC Switch', file: path.join(home, '.cc-switch', 'config.json') },
    { id: 'ccswitch-db', app: 'CC Switch 数据库', file: path.join(home, '.cc-switch', 'cc-switch.db') },
    { id: 'echobird', app: 'EchoBird', file: path.join(home, '.echobird', 'config', 'models.json') },
    { id: 'continue', app: 'Continue', file: path.join(home, '.continue', 'config.json') },
    { id: 'pi', app: 'Pi', file: path.join(home, '.pi', 'agent', 'models.json') },
    { id: 'aider-launcher', app: 'Aider', file: path.join(home, '.freellm', `aider-freellm${sh}`) },
  ];
}

function stampOf(file) {
  const match = path.basename(file).match(/\.freellm-backup-(\d{4})-(\d{2})-(\d{2})T(.+)$/);
  if (!match) return '';
  const clock = match[4].replace(/Z$/, '').replace(/-/g, ':').slice(0, 8);
  return `${match[1]}-${match[2]}-${match[3]} ${clock}`.trim();
}

export function listBackups(home) {
  const out = [];
  for (const target of backupTargets(home)) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.dirname(target.file));
    } catch {
      continue;
    }
    const prefix = `${path.basename(target.file)}.freellm-backup-`;
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue;
      const file = path.join(path.dirname(target.file), name);
      try {
        const stat = fs.statSync(file);
        out.push({
          id: `${target.id}:${name}`,
          targetId: target.id,
          app: target.app,
          target: target.file,
          backup: file,
          createdAt: stat.mtime.toISOString(),
          label: stampOf(file),
          size: stat.size,
        });
      } catch {}
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function insideHome(home, file) {
  const root = path.resolve(home).toLowerCase();
  const resolved = path.resolve(file).toLowerCase();
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export function restoreBackup(home, { targetId, backup }) {
  const target = backupTargets(home).find((item) => item.id === targetId);
  if (!target) throw new Error('未知的还原目标');
  const backupPath = path.resolve(backup);
  if (!insideHome(home, target.file) || !insideHome(home, backupPath)) {
    throw new Error('还原路径不在用户目录内，已拒绝');
  }
  if (path.dirname(backupPath) !== path.dirname(target.file)) {
    throw new Error('备份文件与目标不在同一目录，已拒绝');
  }
  if (!path.basename(backupPath).startsWith(`${path.basename(target.file)}.freellm-backup-`)) {
    throw new Error('不是 FreeLLM 生成的有效备份');
  }
  if (!fs.existsSync(backupPath)) throw new Error('备份文件不存在');
  if (fs.existsSync(target.file)) {
    const safety = `${target.file}.freellm-pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(target.file, safety);
    restrictFile(safety);
  }
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.copyFileSync(backupPath, target.file);
  restrictFile(target.file);
  return { ok: true, target: target.file, app: target.app };
}

export function restoreLatest(home, targetId) {
  const backups = listBackups(home);
  const target = targetId
    ? backups.find((item) => item.targetId === targetId)
    : null;
  if (targetId) {
    if (!target) throw new Error('这个软件还没有可还原的备份');
    return restoreBackup(home, { targetId, backup: target.backup });
  }
  const latestByTarget = new Map();
  for (const item of backups) {
    if (!latestByTarget.has(item.targetId)) latestByTarget.set(item.targetId, item);
  }
  const results = [];
  for (const item of latestByTarget.values()) {
    try {
      results.push({ ok: true, app: item.app, ...restoreBackup(home, { targetId: item.targetId, backup: item.backup }) });
    } catch (error) {
      results.push({ ok: false, app: item.app, error: error.message });
    }
  }
  return results;
}

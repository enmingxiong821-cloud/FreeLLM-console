import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandPath, run } from './process.js';
import { isLinux, isMac, isWindows, resolveOllama } from './paths.js';
import { isPortFree } from './ports.js';

function gb(bytes) {
  return Math.round((Number(bytes) || 0) / 1024 ** 3 * 10) / 10;
}

async function windowsGpu() {
  const result = await run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress',
  ], { timeout: 9000 });
  let list = [];
  try {
    const parsed = JSON.parse(result.stdout || '[]');
    list = Array.isArray(parsed) ? parsed : [parsed];
  } catch {}
  const nvidia = await run('nvidia-smi', [
    '--query-gpu=name,memory.total', '--format=csv,noheader,nounits',
  ], { timeout: 4000 });
  const nvidiaList = nvidia.ok
    ? nvidia.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, vram] = line.split(',').map((item) => item.trim());
      return { name, vramGB: Math.round(Number(vram) / 1024 * 10) / 10, source: 'nvidia-smi' };
    })
    : [];
  const real = list.filter((gpu) => gpu?.Name && !/virtual|basic display|remote|gameviewer/i.test(gpu.Name));
  const byName = new Map(nvidiaList.map((item) => [item.name.toLowerCase(), item]));
  const mapped = real.map((gpu) => ({
    name: gpu.Name,
    vramGB: byName.get(gpu.Name.toLowerCase())?.vramGB || gb(gpu.AdapterRAM),
    driver: gpu.DriverVersion || '',
    source: byName.has(gpu.Name.toLowerCase()) ? 'nvidia-smi' : 'cim',
  }));
  const seen = new Set(mapped.map((gpu) => gpu.name.toLowerCase()));
  for (const gpu of nvidiaList) {
    if (!seen.has(gpu.name.toLowerCase())) mapped.push({ ...gpu, driver: '' });
  }
  return mapped;
}

async function macGpu() {
  const result = await run('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 12000 });
  try {
    const parsed = JSON.parse(result.stdout);
    return (parsed.SPDisplaysDataType || []).map((item) => {
      const raw = String(item.spdisplays_vram || '');
      const amount = Number(raw.replace(/[^\d.]/g, '')) || 0;
      const vramGB = /mb/i.test(raw) ? Math.round(amount / 102.4) / 10
        : /gb/i.test(raw) ? amount
          : null;
      return {
        name: item.sppci_model || item._name || 'Apple GPU',
        vramGB,
        driver: item.spdisplays_metalfamily || '',
        source: 'system_profiler',
      };
    });
  } catch {
    return [];
  }
}

async function linuxGpu() {
  const result = await run('sh', ['-c', 'lspci 2>/dev/null | grep -Ei "vga|3d|display"'], { timeout: 4000 });
  const nvidia = await run('nvidia-smi', [
    '--query-gpu=name,memory.total', '--format=csv,noheader,nounits',
  ], { timeout: 4000 });
  const nvidiaList = nvidia.ok
    ? nvidia.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, vram] = line.split(',').map((item) => item.trim());
      return { name, vramGB: Math.round(Number(vram) / 1024 * 10) / 10, source: 'nvidia-smi' };
    })
    : [];
  if (nvidiaList.length) return nvidiaList;
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => ({
    name: line.replace(/^.*?:\s*/, ''),
    vramGB: null,
    driver: '',
    source: 'lspci',
  }));
}

function diskFree(dir) {
  try {
    const stat = fs.statfsSync(dir);
    return gb(stat.bavail * stat.bsize);
  } catch {
    return null;
  }
}

export function recommendLocalModel({ ramGB, gpu, diskGB }) {
  const vram = Math.max(0, ...(gpu || []).map((item) => Number(item.vramGB) || 0));
  if (ramGB < 8 || (diskGB !== null && diskGB < 8)) {
    return {
      level: 'none',
      model: '',
      title: '只跑云端',
      detail: '内存或磁盘偏紧，本地模型会拖慢整台电脑。云端模式已经够用。',
    };
  }
  if (ramGB >= 24 && vram >= 20) {
    return {
      level: 'heavy',
      model: 'qwen3:30b-a3b',
      title: '可以尝试 30B',
      detail: '显存足够大。仍建议手动启用，自动路由不会主动加载 30B。',
    };
  }
  if (ramGB >= 24 && vram >= 14) {
    return {
      level: 'strong',
      model: 'gpt-oss:20b',
      title: '推荐 GPT-OSS 20B',
      detail: '隐私请求的本地主力，速度和质量比较均衡。',
    };
  }
  if (ramGB >= 16 && vram >= 12) {
    return {
      level: 'balanced',
      model: 'qwen3:14b',
      title: '推荐 Qwen3 14B',
      detail: '内存和显存都够时选 14B；仍建议先测速，再决定是否常驻。',
    };
  }
  return {
    level: 'light',
    model: 'qwen3:8b',
    title: '推荐 Qwen3 8B',
    detail: ramGB >= 16
      ? '显存低于 12GB 时优先 8B，避免加载 12B/14B 时显存不足。'
      : '小模型占用低，适合作为隐私兜底，不追求复杂推理。',
  };
}

export async function detectSystem({ dataDir, ports }) {
  const cpus = os.cpus();
  const ramGB = gb(os.totalmem());
  let gpu = [];
  try {
    gpu = isWindows ? await windowsGpu() : isMac ? await macGpu() : await linuxGpu();
  } catch {}

  let osName = `${os.type()} ${os.release()}`;
  if (isWindows) {
    const caption = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; (Get-CimInstance Win32_OperatingSystem).Caption',
    ], { timeout: 6000 });
    if (caption.ok && caption.stdout) osName = `${caption.stdout} (${os.release()})`;
  }

  const ollama = resolveOllama();
  const tools = [
    ['node', commandPath('node')],
    ['ollama', ollama || commandPath('ollama')],
    ['cloudflared', commandPath('cloudflared')],
    ['git', commandPath('git')],
    ['code', commandPath('code')],
    ['codex', commandPath('codex')],
    ['claude', commandPath('claude')],
    ['aider', commandPath('aider')],
    ['winget', commandPath('winget')],
    ['npm', commandPath('npm')],
    ['python', commandPath('python') || commandPath('python3')],
    ['go', commandPath('go')],
  ].map(([id, exe]) => ({ id, installed: Boolean(exe), path: exe || '' }));

  const portState = {};
  for (const [name, port] of Object.entries(ports || {})) {
    portState[name] = { port, free: await isPortFree(port) };
  }

  const report = {
    platform: process.platform,
    arch: process.arch,
    osName,
    hostname: os.hostname(),
    cpu: {
      model: cpus[0]?.model?.trim() || 'Unknown CPU',
      cores: cpus.length,
      speedGHz: cpus[0]?.speed ? Math.round(cpus[0].speed / 100) / 10 : null,
    },
    ramGB,
    gpu,
    diskGB: diskFree(dataDir || os.homedir()),
    tools,
    ports: portState,
    checkedAt: new Date().toISOString(),
  };
  report.recommendation = recommendLocalModel(report);
  return report;
}

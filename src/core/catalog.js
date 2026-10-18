import fs from 'node:fs';
import { readJson } from './store.js';

export function loadCatalog(file) {
  const data = readJson(file, { models: [] });
  const models = Array.isArray(data.models) ? data.models : [];
  const map = (model) => ({
    id: model.routeModelId || model.modelId || '',
    name: model.displayName || model.routeModelId || model.modelId || '未命名模型',
    platform: model.platform || '',
    tags: Array.isArray(model.tags) ? model.tags : [],
    strengths: String(model.strengths || ''),
    weaknesses: String(model.weaknesses || ''),
    contextWindow: Number(model.contextWindow) || 0,
    intelligenceRank: Number(model.intelligenceRank) || 0,
    speedRank: Number(model.speedRank) || 0,
    local: Boolean(model.local),
    keyless: Boolean(model.keyless),
    heavyLocal: Boolean(model.heavyLocal),
    usableNow: Boolean(model.usableNow && model.chatCapable),
    vision: Boolean(model.capabilities?.vision),
    tools: Boolean(model.capabilities?.tools),
  });
  const all = models.filter(Boolean).map(map);
  const usable = all.filter((model) => model.usableNow);
  return {
    file,
    generatedAt: data.generatedAt || '',
    total: Number(data.count) || models.length,
    usableCount: usable.length,
    usable,
    all,
  };
}

export function catalogExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

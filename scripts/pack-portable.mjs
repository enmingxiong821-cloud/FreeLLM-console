// Builds a runnable Windows portable folder + zip without electron-builder's
// network downloads. The bundled Node runtime lets sidecar services run on a
// machine that has never installed Node.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyCoreSanitized, findReleaseLeaks } from './core-copy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const distRoot = path.join(desktop, 'dist');
const folderName = `FreeLLM-Console-${pkg.version}-win32-x64`;
const out = path.join(distRoot, folderName);
const electronDist = path.join(desktop, 'node_modules', 'electron', 'dist');

if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('pack-portable: electron dist not found; run npm install first');
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(electronDist, out, { recursive: true });
fs.rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });

const appDir = path.join(out, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const name of ['src', 'renderer', 'assets']) {
  fs.cpSync(path.join(desktop, name), path.join(appDir, name), { recursive: true });
}
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  type: 'module',
  main: 'src/main.js',
}, null, 2));

const router = path.join(desktop, 'resources', 'task-router.cjs');
if (!fs.existsSync(router)) {
  console.error('pack-portable: run npm run sync:router first');
  process.exit(1);
}
fs.copyFileSync(router, path.join(out, 'resources', 'task-router.cjs'));
const ccSwitchHelper = path.join(desktop, 'resources', 'ccswitch-db.cjs');
if (fs.existsSync(ccSwitchHelper)) {
  fs.copyFileSync(ccSwitchHelper, path.join(out, 'resources', 'ccswitch-db.cjs'));
}

const bundledNode = path.join(desktop, 'resources', 'runtime', 'node.exe');
if (!fs.existsSync(bundledNode)) {
  const systemNode = 'C:\\Program Files\\nodejs\\node.exe';
  if (fs.existsSync(systemNode)) {
    fs.mkdirSync(path.dirname(bundledNode), { recursive: true });
    fs.copyFileSync(systemNode, bundledNode);
  }
}
if (fs.existsSync(bundledNode)) {
  fs.mkdirSync(path.join(out, 'resources', 'runtime'), { recursive: true });
  fs.copyFileSync(bundledNode, path.join(out, 'resources', 'runtime', 'node.exe'));
}

const core = path.join(desktop, 'resources', 'core');
const hasCore = fs.existsSync(path.join(core, 'server', 'dist', 'index.js'));
if (hasCore) {
  copyCoreSanitized(core, path.join(out, 'resources', 'core'));
  const leaks = findReleaseLeaks(path.join(out, 'resources', 'core'));
  if (leaks.length) {
    console.error('pack-portable: refusing to package core with local secrets/data:');
    for (const leak of leaks) console.error(`  ${leak}`);
    process.exit(1);
  }
}

const bin = path.join(desktop, 'resources', 'bin');
try {
  const files = fs.readdirSync(bin).filter((name) => name !== 'README.md');
  if (files.length) {
    fs.mkdirSync(path.join(out, 'resources', 'bin'), { recursive: true });
    for (const file of files) fs.copyFileSync(path.join(bin, file), path.join(out, 'resources', 'bin', file));
  }
} catch {}

fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'FreeLLM Console.exe'));
fs.writeFileSync(path.join(out, 'portable.txt'), '1\n');
const notices = path.join(desktop, 'THIRD_PARTY_NOTICES.md');
if (fs.existsSync(notices)) fs.copyFileSync(notices, path.join(out, 'THIRD_PARTY_NOTICES.md'));
fs.writeFileSync(path.join(out, 'README.txt'), `FreeLLM Console ${pkg.version}

双击 "FreeLLM Console.exe" 启动。

数据保存在本目录的 data 文件夹，删除程序目录即可整体迁移。
${hasCore ? '已内置 FreeLLMAPI 核心。' : '首次启动需要在设置里选择已有的 FreeLLMAPI 安装目录。'}
`, 'utf8');

const zip = path.join(distRoot, `${folderName}.zip`);
fs.rmSync(zip, { force: true });
const tar = spawnSync('tar', ['-a', '-c', '-f', zip, '-C', distRoot, folderName], {
  stdio: 'inherit',
  windowsHide: true,
});
if (tar.status !== 0) console.warn('pack-portable: zip creation failed; the folder is still runnable');

console.log(`pack-portable: ${out}`);
if (fs.existsSync(zip)) {
  console.log(`pack-portable: ${zip} (${Math.round(fs.statSync(zip).size / 1024 / 1024)} MB)`);
}

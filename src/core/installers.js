import { commandPath } from './process.js';
import { execFileSync } from 'node:child_process';

const SPECS = {
  codex: { kind: 'npm', pkg: '@openai/codex', label: 'npm 全局安装 Codex CLI' },
  claude: { kind: 'npm', pkg: '@anthropic-ai/claude-code', label: 'npm 全局安装 Claude Code' },
  aider: { kind: 'pip', pkg: 'aider-install', label: 'pip 安装 Aider' },
  opencode: { kind: 'npm', pkg: 'opencode-ai', label: 'npm 全局安装 OpenCode' },
  qwen: { kind: 'npm', pkg: '@qwen-code/qwen-code', label: 'npm 全局安装 Qwen Code' },
  pi: { kind: 'npm', pkg: '@earendil-works/pi-coding-agent', label: 'npm 全局安装 Pi' },
  amp: { kind: 'npm', pkg: '@sourcegraph/amp', label: 'npm 全局安装 Amp' },
  crush: { kind: 'go', pkg: 'github.com/charmbracelet/crush@latest', label: 'go install Crush' },
  cline: { kind: 'code', ext: 'saoudrizwan.claude-dev', label: '安装 Cline VS Code 扩展' },
  continue: { kind: 'code', ext: 'Continue.continue', label: '安装 Continue VS Code 扩展' },
  roo: { kind: 'code', ext: 'RooVeterinaryInc.roo-cline', label: '安装 Roo Code VS Code 扩展' },
  kilo: { kind: 'code', ext: 'kilocode.kilo-code', label: '安装 Kilo Code VS Code 扩展' },
  cursor: { kind: 'winget', id: 'Anysphere.Cursor', label: 'winget 安装 Cursor' },
  windsurf: { kind: 'winget', id: 'Codeium.Windsurf', label: 'winget 安装 Windsurf' },
  zed: { kind: 'winget', id: 'ZedIndustries.Zed', label: 'winget 安装 Zed' },
  cherry: { kind: 'winget', id: 'kangfenmao.CherryStudio', label: 'winget 安装 Cherry Studio' },
  lmstudio: { kind: 'winget', id: 'ElementLabs.LMStudio', label: 'winget 安装 LM Studio' },
  jan: { kind: 'winget', id: 'Jan.Jan', label: 'winget 安装 Jan' },
  chatbox: { kind: 'winget', id: 'Bin-Huang.Chatbox', label: 'winget 安装 Chatbox' },
};

let wingetCache = { value: false, at: 0 };

export function hasWinget() {
  if (process.platform !== 'win32') return false;
  if (Date.now() - wingetCache.at < 60000) return wingetCache.value;
  const exe = commandPath('winget') || commandPath('winget.exe') || 'winget';
  let value = false;
  try {
    execFileSync(exe, ['--version'], {
      timeout: 3500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    value = true;
  } catch {
    value = false;
  }
  wingetCache = { value, at: Date.now() };
  return value;
}

export function installSpec(id) {
  const spec = SPECS[id];
  if (!spec) return null;
  if (spec.kind === 'winget' && !hasWinget()) return null;
  if (spec.kind === 'code' && !commandPath('code')) return null;
  if (spec.kind === 'pip' && !commandPath('python') && !commandPath('python3')) return null;
  if (spec.kind === 'go' && !commandPath('go')) return null;
  return spec;
}

export function installCommand(spec) {
  if (!spec) return '';
  switch (spec.kind) {
    case 'npm': return `npm install -g ${spec.pkg}`;
    case 'pip': return `${commandPath('python') ? 'python' : 'python3'} -m pip install ${spec.pkg}`;
    case 'go': return `go install ${spec.pkg}`;
    case 'code': return `code --install-extension ${spec.ext}`;
    case 'winget': return `winget install --id ${spec.id} --exact --silent --accept-package-agreements --accept-source-agreements`;
    default: return '';
  }
}

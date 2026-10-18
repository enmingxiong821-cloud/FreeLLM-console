// Curated entry points for free tiers. Terms and quotas change often; the UI
// labels these as signup/key pages, never as guaranteed quota.
export const FREE_SOURCES = [
  { id: 'openrouter', name: 'OpenRouter', note: '部分 :free 模型，按模型限流', signup: 'https://openrouter.ai/models?max_price=0', keys: 'https://openrouter.ai/keys', tag: '聚合' },
  { id: 'groq', name: 'Groq', note: '高速推理，免费额度', signup: 'https://console.groq.com/', keys: 'https://console.groq.com/keys', tag: '高速' },
  { id: 'cerebras', name: 'Cerebras', note: '高速推理，免费额度', signup: 'https://cloud.cerebras.ai/', keys: 'https://cloud.cerebras.ai/', tag: '高速' },
  { id: 'google', name: 'Google AI Studio', note: 'Gemini 免费额度', signup: 'https://aistudio.google.com/', keys: 'https://aistudio.google.com/app/apikey', tag: 'Gemini' },
  { id: 'mistral', name: 'Mistral', note: '免费实验额度', signup: 'https://console.mistral.ai/', keys: 'https://console.mistral.ai/api-keys/', tag: '欧洲' },
  { id: 'github', name: 'GitHub Models', note: 'GitHub 账号免费试用', signup: 'https://github.com/marketplace/models', keys: 'https://github.com/settings/tokens', tag: 'GitHub' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', note: '每日免费神经元额度', signup: 'https://dash.cloudflare.com/', keys: 'https://dash.cloudflare.com/', tag: '边缘' },
  { id: 'huggingface', name: 'Hugging Face', note: 'Inference 免费额度', signup: 'https://huggingface.co/', keys: 'https://huggingface.co/settings/tokens', tag: '开源' },
  { id: 'modelscope', name: 'ModelScope 魔搭', note: '国内模型社区免费额度', signup: 'https://modelscope.cn/', keys: 'https://modelscope.cn/my/myaccesstoken', tag: '国内' },
  { id: 'siliconflow', name: 'SiliconFlow', note: '国内聚合，部分模型免费', signup: 'https://cloud.siliconflow.cn/', keys: 'https://cloud.siliconflow.cn/account/ak', tag: '国内' },
  { id: 'zhipu', name: '智谱 BigModel', note: 'GLM 系列免费额度', signup: 'https://open.bigmodel.cn/', keys: 'https://open.bigmodel.cn/usercenter/apikeys', tag: 'GLM' },
  { id: 'dashscope', name: '阿里云百炼', note: 'Qwen 系列免费额度', signup: 'https://bailian.console.aliyun.com/', keys: 'https://bailian.console.aliyun.com/', tag: 'Qwen' },
  { id: 'deepseek', name: 'DeepSeek', note: '新用户/活动额度，以官网为准', signup: 'https://platform.deepseek.com/', keys: 'https://platform.deepseek.com/api_keys', tag: '推理' },
  { id: 'nvidia', name: 'NVIDIA NIM', note: '开发者免费推理额度', signup: 'https://build.nvidia.com/', keys: 'https://build.nvidia.com/', tag: 'GPU' },
  { id: 'ollama', name: 'Ollama', note: '本机运行，无云端额度', signup: 'https://ollama.com/', keys: 'https://ollama.com/', tag: '本地', local: true },
  { id: 'lmstudio', name: 'LM Studio', note: '本机运行，兼容 OpenAI', signup: 'https://lmstudio.ai/', keys: 'https://lmstudio.ai/', tag: '本地', local: true },
];

export const SIMILAR_PROJECTS = [
  { name: 'LiteLLM', note: '多 Provider 统一网关与路由', url: 'https://github.com/BerriAI/litellm' },
  { name: 'OpenRouter', note: '聚合模型市场与免费模型筛选', url: 'https://openrouter.ai/' },
  { name: 'LibreChat', note: '自托管多模型聊天界面', url: 'https://github.com/danny-avila/LibreChat' },
  { name: 'Open WebUI', note: '自托管聊天与模型管理', url: 'https://github.com/open-webui/open-webui' },
  { name: 'LobeChat', note: '桌面/网页多模型聊天', url: 'https://github.com/lobehub/lobe-chat' },
  { name: 'AnythingLLM', note: '知识库 + 多模型桌面端', url: 'https://anythingllm.com/' },
  { name: 'Cherry Studio', note: '桌面多模型客户端', url: 'https://www.cherry-ai.com/' },
  { name: 'Cline', note: 'VS Code 多文件 Agent', url: 'https://github.com/cline/cline' },
  { name: 'Continue', note: '开源 IDE 编程助手', url: 'https://github.com/continuedev/continue' },
  { name: 'Aider', note: '终端结对编程', url: 'https://aider.chat/' },
  { name: 'OpenCode', note: '终端编程 Agent', url: 'https://opencode.ai/' },
  { name: 'Pi', note: '终端 Agent 与扩展生态', url: 'https://pi.dev/' },
  { name: 'PI-Desktop', note: '基于 Pi 的桌面 Agent 工作区', url: 'https://github.com/vastsa/PI-Desktop' },
];

export const CLOSED_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', protocol: 'openai', tag: '官方', note: '按账号可用模型修改模型名' },
  { id: 'anthropic', name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', protocol: 'anthropic', tag: '官方', note: 'Anthropic 原生协议' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-pro', protocol: 'openai', tag: '官方', note: '使用 Gemini 的 OpenAI 兼容端点' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', protocol: 'openai', tag: '国内', note: 'DeepSeek 官方 API' },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2', protocol: 'openai', tag: '国内', note: 'Kimi 长文本与 Agent' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5', protocol: 'openai', tag: '国内', note: 'GLM 官方 API' },
  { id: 'dashscope', name: '阿里云百炼 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-max', protocol: 'openai', tag: '国内', note: 'Qwen 的 OpenAI 兼容端点' },
  { id: 'doubao', name: '火山方舟 Doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1.6', protocol: 'openai', tag: '国内', note: '火山引擎方舟 API' },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', protocol: 'openai', tag: '聚合', note: '国内多模型聚合' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', protocol: 'openai', tag: '聚合', note: '海外多模型聚合' },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M2', protocol: 'openai', tag: '国内', note: 'MiniMax 官方 API' },
  { id: 'stepfun', name: '阶跃星辰 StepFun', baseUrl: 'https://api.stepfun.com/v1', model: 'step-2-16k', protocol: 'openai', tag: '国内', note: 'StepFun 官方 API' },
];

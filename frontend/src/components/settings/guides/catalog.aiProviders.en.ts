/**
 * AI settings “Quick access”: per-provider guides (English)
 */
import type { SettingGuideEntry } from './types'

export const aiProvidersQuickAccessEn: SettingGuideEntry = {
  what: 'Quick directory of common AI providers: where to get API keys, docs, and default base URLs.',
  chain:
    '1) Open “Quick access” in the AI section header.\n2) Find the provider’s key page, docs, and API base URL.\n3) Back on this page, pick the matching provider (or OpenAI-compatible + Base URL), paste key and model → save at the bottom.\n4) Send one short message in the assistant to test connectivity.',
  frontend:
    'Settings → AI → “Quick access” between Reset and Show details.\nStandard / Lite / Pro / Image can each use different providers.',
  notes:
    'Keys stay on the server. Your browser reaching a site does not mean the server can (configure proxy under Advanced if needed).\nAfter switching providers, re-check model names. Most OpenAI-compatible vendors work via “OpenAI compatible” + their Base URL.',
}

export const aiProvidersEn: Record<string, SettingGuideEntry> = {
  openrouter: {
    what: 'OpenRouter: multi-model gateway (good default).',
    chain:
      '1) Create a key: https://openrouter.ai/keys\n2) Copy the API key.\n3) On this page pick OpenRouter (or OpenAI-compatible + Base URL).\n4) Use model ids from their console/docs (e.g. openai/gpt-4o, anthropic/claude-…).\n5) Docs: https://openrouter.ai/docs\n6) API: https://openrouter.ai/api/v1',
    frontend: 'Available for Standard / Lite / Pro / Image.',
    notes: 'One key can route many upstreams; billing and rate limits follow your OpenRouter account.',
  },
  openai: {
    what: 'Official OpenAI API.',
    chain:
      '1) Keys: https://platform.openai.com/api-keys\n2) Docs: https://platform.openai.com/docs\n3) API: https://api.openai.com/v1\n4) Pick OpenAI / OpenAI-compatible, fill key and model.\n5) Usage: https://platform.openai.com/usage',
    frontend: 'Text tiers and image generation.',
    notes: 'Model access depends on your org; some regions need payment/compliance setup.',
  },
  azureOpenAI: {
    what: 'Azure OpenAI (OpenAI-compatible endpoints on Azure).',
    chain:
      '1) Portal: https://portal.azure.com\n2) Docs: https://learn.microsoft.com/azure/ai-services/openai/\n3) Create resource + deployment; copy endpoint and key.\n4) Pick OpenAI-compatible; Base URL = your Azure endpoint (see current Azure format).\n5) Model field = deployment name.',
    frontend: 'Same fields as OpenAI-compatible; model = deployment name.',
    notes: 'Regions, quotas, and key rotation are managed in Azure.',
  },
  gemini: {
    what: 'Google Gemini (AI Studio / Gemini API).',
    chain:
      '1) Keys: https://aistudio.google.com/apikey\n2) Docs: https://ai.google.dev/gemini-api/docs\n3) Pick Gemini on this page and paste the key.\n4) Model names follow Google docs (e.g. gemini-2.5-flash).',
    frontend: 'Text tiers with Gemini; optional global Gemini base URL under Advanced.',
    notes: 'Not OpenAI protocol — do not paste Gemini keys into plain OpenAI-compatible fields without a proper adapter.',
  },
  anthropic: {
    what: 'Anthropic Claude official API.',
    chain:
      '1) Console: https://console.anthropic.com/\n2) Keys: https://console.anthropic.com/settings/keys\n3) Docs: https://docs.anthropic.com/\n4) Common path here: OpenRouter anthropic/… models, or an OpenAI-compatible proxy.\n5) Native API is not OpenAI-shaped.',
    frontend: 'Prefer OpenRouter or a compatible proxy.',
    notes: 'Do not send Anthropic keys to endpoints that only speak OpenAI without translation.',
  },
  deepseek: {
    what: 'DeepSeek (OpenAI-compatible).',
    chain:
      '1) Platform: https://platform.deepseek.com/\n2) Keys: https://platform.deepseek.com/api_keys\n3) Docs: https://api-docs.deepseek.com/\n4) API: https://api.deepseek.com or https://api.deepseek.com/v1\n5) Pick OpenAI-compatible; models e.g. deepseek-chat, deepseek-reasoner.',
    frontend: 'OpenAI-compatible + DeepSeek Base URL.',
    notes: 'Confirm model ids and pricing in the console.',
  },
  volcengine: {
    what: 'Volcengine Ark (Doubao, etc.; image provider on this site).',
    chain:
      '1) Console: https://console.volcengine.com/ark\n2) Docs: https://www.volcengine.com/docs/82379\n3) Create an endpoint and copy the API key.\n4) Text: OpenAI-compatible + Ark base URL (see official OpenAI SDK notes).\n5) Image: Image generation → Volcengine.',
    frontend: 'Dedicated Volcengine fields under Image; text via OpenAI-compatible.',
    notes: 'Endpoint IDs and model names must match the console.',
  },
  dashscope: {
    what: 'Alibaba Cloud Model Studio / DashScope (Qwen, OpenAI-compatible).',
    chain:
      '1) Console: https://bailian.console.aliyun.com/\n2) API keys in the console API-KEY page.\n3) Docs: https://help.aliyun.com/zh/model-studio/\n4) Compatible base (example): https://dashscope.aliyuncs.com/compatible-mode/v1\n5) OpenAI-compatible; models e.g. qwen-plus, qwen-max.',
    frontend: 'OpenAI-compatible + DashScope Base URL.',
    notes: 'International vs China endpoints may differ by account region.',
  },
  moonshot: {
    what: 'Moonshot (Kimi, OpenAI-compatible).',
    chain:
      '1) Platform: https://platform.moonshot.cn/\n2) Create an API key in the console.\n3) Docs: https://platform.moonshot.cn/docs\n4) API: https://api.moonshot.cn/v1\n5) OpenAI-compatible; model names per docs.',
    frontend: 'OpenAI-compatible + Moonshot Base URL.',
    notes: 'Long-context models cost more per token.',
  },
  zhipu: {
    what: 'Zhipu BigModel (GLM, OpenAI-compatible).',
    chain:
      '1) Platform: https://open.bigmodel.cn/\n2) Keys: https://open.bigmodel.cn/usercenter/apikeys\n3) Docs: https://docs.bigmodel.cn/\n4) Compatible API example: https://open.bigmodel.cn/api/paas/v4\n5) OpenAI-compatible; models e.g. glm-4, glm-4-flash.',
    frontend: 'OpenAI-compatible + Zhipu Base URL.',
    notes: 'Confirm the current OpenAI-compatible path in Zhipu docs.',
  },
  siliconflow: {
    what: 'SiliconFlow (multi-model, OpenAI-compatible).',
    chain:
      '1) Console: https://cloud.siliconflow.cn/\n2) Create an API key in account settings.\n3) Docs: https://docs.siliconflow.cn/\n4) API: https://api.siliconflow.cn/v1\n5) OpenAI-compatible; copy model ids from the model catalog.',
    frontend: 'OpenAI-compatible + SiliconFlow Base URL.',
    notes: 'Watch free-tier rate limits vs paid models.',
  },
  groq: {
    what: 'Groq (fast inference, OpenAI-compatible).',
    chain:
      '1) Console: https://console.groq.com/\n2) Keys: https://console.groq.com/keys\n3) Docs: https://console.groq.com/docs\n4) API: https://api.groq.com/openai/v1\n5) OpenAI-compatible; model ids per Groq docs.',
    frontend: 'OpenAI-compatible + Groq Base URL.',
    notes: 'Free tiers have strict RPM limits.',
  },
  xai: {
    what: 'xAI Grok API (OpenAI-compatible).',
    chain:
      '1) Console: https://console.x.ai/\n2) Docs: https://docs.x.ai/\n3) API: https://api.x.ai/v1\n4) OpenAI-compatible; models e.g. grok-3 (see docs).',
    frontend: 'OpenAI-compatible + xAI Base URL.',
    notes: 'Availability depends on your xAI account.',
  },
  mistral: {
    what: 'Mistral AI (OpenAI-compatible).',
    chain:
      '1) Console: https://console.mistral.ai/\n2) Keys: https://console.mistral.ai/api-keys/\n3) Docs: https://docs.mistral.ai/\n4) API: https://api.mistral.ai/v1\n5) OpenAI-compatible; models e.g. mistral-large-latest.',
    frontend: 'OpenAI-compatible + Mistral Base URL.',
    notes: 'Check enterprise docs for data residency options.',
  },
  together: {
    what: 'Together AI (open models, OpenAI-compatible).',
    chain:
      '1) Console: https://api.together.xyz/\n2) Keys: https://api.together.xyz/settings/api-keys\n3) Docs: https://docs.together.ai/\n4) API: https://api.together.xyz/v1\n5) OpenAI-compatible; paste full model ids from Together.',
    frontend: 'OpenAI-compatible + Together Base URL.',
    notes: 'Model ids are often long — copy exactly.',
  },
  fireworks: {
    what: 'Fireworks AI (OpenAI-compatible).',
    chain:
      '1) Console: https://fireworks.ai/\n2) API keys under Account.\n3) Docs: https://docs.fireworks.ai/\n4) API: https://api.fireworks.ai/inference/v1\n5) OpenAI-compatible; model paths per Fireworks docs.',
    frontend: 'OpenAI-compatible + Fireworks Base URL.',
    notes: 'Watch the inference path and account/model namespace.',
  },
  perplexity: {
    what: 'Perplexity API (OpenAI-compatible chat).',
    chain:
      '1) API settings: https://www.perplexity.ai/settings/api\n2) Docs: https://docs.perplexity.ai/\n3) API: https://api.perplexity.ai\n4) OpenAI-compatible; models e.g. sonar, sonar-pro.',
    frontend: 'OpenAI-compatible + Perplexity Base URL.',
    notes: 'Search-augmented answers; billing may differ from the consumer app.',
  },
  minimax: {
    what: 'MiniMax (OpenAI-compatible).',
    chain:
      '1) Platform: https://platform.minimaxi.com/\n2) Docs: https://platform.minimaxi.com/document/\n3) Create Group / API key.\n4) Use official OpenAI-compatible base URL and model names.\n5) OpenAI-compatible on this page.',
    frontend: 'OpenAI-compatible + MiniMax Base URL.',
    notes: 'Global vs regional hostnames may differ.',
  },
  ollama: {
    what: 'Ollama: local / LAN models (OpenAI-compatible).',
    chain:
      '1) Install: https://ollama.com/ and https://github.com/ollama/ollama\n2) Default API: http://127.0.0.1:11434/v1\n3) ollama pull a model, then OpenAI-compatible + that Base URL.\n4) Model name = local tag (e.g. llama3.2).\n5) If a key is required, any non-empty placeholder is often enough.',
    frontend: 'OpenAI-compatible; the Myriad server must reach Ollama.',
    notes: 'On a remote server, 127.0.0.1 is the server itself — use a LAN IP or tunnel to your machine.',
  },
  cloudflare: {
    what: 'Cloudflare Workers AI (OpenAI-compatible gateway).',
    chain:
      '1) Dashboard: https://dash.cloudflare.com/\n2) Docs: https://developers.cloudflare.com/workers-ai/\n3) Use the OpenAI-compatible Workers AI / AI Gateway base URL from docs.\n4) OpenAI-compatible + API token.',
    frontend: 'OpenAI-compatible + Cloudflare base URL from docs.',
    notes: 'Model ids come from the Cloudflare model catalog.',
  },
  cohere: {
    what: 'Cohere (via compatible gateway or OpenRouter).',
    chain:
      '1) Dashboard: https://dashboard.cohere.com/\n2) Keys: https://dashboard.cohere.com/api-keys\n3) Docs: https://docs.cohere.com/\n4) Prefer an OpenAI-compatible proxy or OpenRouter cohere/… models.',
    frontend: 'OpenRouter or compatible gateway recommended.',
    notes: 'Native Cohere APIs are not full OpenAI clones.',
  },
  nvidia: {
    what: 'NVIDIA NIM / build.nvidia.com (OpenAI-compatible).',
    chain:
      '1) Catalog: https://build.nvidia.com/ and https://docs.nvidia.com/nim/\n2) Get an API key and the documented OpenAI-compatible endpoint.\n3) OpenAI-compatible; copy model ids from build.nvidia.com.',
    frontend: 'OpenAI-compatible + NVIDIA base URL.',
    notes: 'Some models require accepting terms before use.',
  },
  tencentHunyuan: {
    what: 'Tencent Hunyuan.',
    chain:
      '1) Console: https://console.cloud.tencent.com/hunyuan\n2) Docs: https://cloud.tencent.com/document/product/1729\n3) Create credentials / compatible endpoint per docs.\n4) If OpenAI-compatible URL exists, use OpenAI-compatible here.',
    frontend: 'OpenAI-compatible when an endpoint is provided.',
    notes: 'Speech on this site still uses separate Tencent TTS/ASR settings.',
  },
  baiduQianfan: {
    what: 'Baidu Qianfan (Wenxin, etc.).',
    chain:
      '1) Console: https://console.bce.baidu.com/qianfan/\n2) Docs: https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html\n3) Create app credentials or compatible-mode keys.\n4) Use OpenAI-compatible when Qianfan exposes that base URL.',
    frontend: 'Same as other OpenAI-compatible vendors when supported.',
    notes: 'Auth details change with Qianfan versions — follow latest docs.',
  },
  openaiCompatible: {
    what: 'Any OpenAI-compatible relay (One-API, New API, self-hosted gateway).',
    chain:
      '1) Get Base URL, API key, and model list from the relay operator.\n2) Provider = OpenAI-compatible.\n3) Base URL usually ends with /v1 (do not append /chat/completions unless told to).\n4) Model names must match the relay’s upstream config.\n5) Save and test with low traffic first.',
    frontend: 'OpenAI-compatible fields on every text tier.',
    notes: 'You own the risk of third-party relays; avoid untrusted free proxies for sensitive data.',
  },
}

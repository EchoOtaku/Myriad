/**
 * AI 設定「クイックアクセス」：サービス別ガイド（日本語）
 */
import type { SettingGuideEntry } from './types'

export const aiProvidersQuickAccessJa: SettingGuideEntry = {
  what: 'よく使う AI 提供者の API キー取得先・ドキュメント・既定 API 住所の一覧。',
  chain:
    '① AI 設定見出しの「クイックアクセス」を開く。\n② 各提供者の鍵ページ／ドキュメント／API 住所を確認。\n③ 本ページで提供者（または OpenAI 互換 + Base URL）を選び、鍵とモデルを貼って下部で保存。\n④ 助手で短い一文を送り接続を確認。',
  frontend:
    '設定 → AI 設定 →「リセット」と「説明表示」の間の「クイックアクセス」。\n標準／Lite／Pro／画像は別々の提供者にできる。',
  notes:
    '鍵はサーバー側のみ。ブラウザで開ける＝サーバーも届く、ではない（必要なら「高度」でプロキシ）。\n提供者変更後はモデル名を必ず確認。OpenAI 互換の多くは「OpenAI 互換」+ 各社 Base URL で使える。',
}

export const aiProvidersJa: Record<string, SettingGuideEntry> = {
  openrouter: {
    what: 'OpenRouter：複数モデルをまとめるゲートウェイ（はじめやすい）。',
    chain:
      '① キー：https://openrouter.ai/keys\n② API Key を作成してコピー。\n③ 本ページで OpenRouter（または OpenAI 互換 + Base URL）。\n④ モデル ID はコンソール／ドキュメント通り（例 openai/gpt-4o）。\n⑤ ドキュメント：https://openrouter.ai/docs\n⑥ API：https://openrouter.ai/api/v1',
    frontend: '標準／Lite／Pro／画像で利用可。',
    notes: '1 つの Key で複数上流へ。料金・制限は OpenRouter 口座に従う。',
  },
  openai: {
    what: 'OpenAI 公式 API。',
    chain:
      '① キー：https://platform.openai.com/api-keys\n② ドキュメント：https://platform.openai.com/docs\n③ API：https://api.openai.com/v1\n④ OpenAI／OpenAI 互換を選び鍵とモデルを記入。\n⑤ 利用量：https://platform.openai.com/usage',
    frontend: 'テキスト各段と画像生成。',
    notes: '組織の権限・支払い設定が必要な場合あり。',
  },
  azureOpenAI: {
    what: 'Azure OpenAI（Azure 上の OpenAI 互換）。',
    chain:
      '① ポータル：https://portal.azure.com\n② ドキュメント：https://learn.microsoft.com/azure/ai-services/openai/\n③ リソースとデプロイを作成し endpoint と key を取得。\n④ OpenAI 互換 + Azure の Base URL。\n⑤ モデル欄＝デプロイ名。',
    frontend: 'OpenAI 互換と同じ欄。モデル＝デプロイ名。',
    notes: 'リージョン・クォータは Azure で管理。',
  },
  gemini: {
    what: 'Google Gemini（AI Studio / Gemini API）。',
    chain:
      '① キー：https://aistudio.google.com/apikey\n② ドキュメント：https://ai.google.dev/gemini-api/docs\n③ 本ページで Gemini を選び鍵を貼る。\n④ モデル名は Google ドキュメントに合わせる。',
    frontend: 'テキスト段で Gemini。高度設定にグローバル Base URL がある場合あり。',
    notes: 'OpenAI プロトコルではない。素の互換欄に Gemini 鍵を入れない。',
  },
  anthropic: {
    what: 'Anthropic Claude 公式 API。',
    chain:
      '① コンソール：https://console.anthropic.com/\n② キー：https://console.anthropic.com/settings/keys\n③ ドキュメント：https://docs.anthropic.com/\n④ 本サイトでは OpenRouter の anthropic/… か互換プロキシが一般的。\n⑤ ネイティブ API は OpenAI 形ではない。',
    frontend: 'OpenRouter または互換プロキシ推奨。',
    notes: '変換なしの OpenAI 端点に Anthropic 鍵を送らない。',
  },
  deepseek: {
    what: 'DeepSeek（OpenAI 互換）。',
    chain:
      '① プラットフォーム：https://platform.deepseek.com/\n② キー：https://platform.deepseek.com/api_keys\n③ ドキュメント：https://api-docs.deepseek.com/\n④ API：https://api.deepseek.com または /v1\n⑤ OpenAI 互換 + 上記 Base URL。モデル例 deepseek-chat。',
    frontend: 'OpenAI 互換 + DeepSeek Base URL。',
    notes: 'モデル名と料金はコンソールで確認。',
  },
  volcengine: {
    what: '火山エンジン方舟（本サイトの画像生成でも選択可）。',
    chain:
      '① コンソール：https://console.volcengine.com/ark\n② ドキュメント：https://www.volcengine.com/docs/82379\n③ エンドポイント作成後に API Key をコピー。\n④ テキスト：OpenAI 互換 + 方舟 Base URL（公式の互換説明を参照）。\n⑤ 画像：画像生成で火山を選択。',
    frontend: '画像に専用項目。テキストは互換欄が多い。',
    notes: 'エンドポイント ID・モデル名はコンソールと一致させる。',
  },
  dashscope: {
    what: '阿里雲百煉 / DashScope（通義、OpenAI 互換）。',
    chain:
      '① コンソール：https://bailian.console.aliyun.com/\n② API-KEY をコンソールで作成。\n③ ドキュメント：https://help.aliyun.com/zh/model-studio/\n④ 互換例：https://dashscope.aliyuncs.com/compatible-mode/v1\n⑤ OpenAI 互換。モデル例 qwen-plus。',
    frontend: 'OpenAI 互換 + DashScope Base URL。',
    notes: '国際／中国の endpoint がアカウント地域で異なる場合あり。',
  },
  moonshot: {
    what: 'Moonshot（Kimi、OpenAI 互換）。',
    chain:
      '① プラットフォーム：https://platform.moonshot.cn/\n② コンソールで API Key を作成。\n③ ドキュメント：https://platform.moonshot.cn/docs\n④ API：https://api.moonshot.cn/v1\n⑤ OpenAI 互換。モデル名はドキュメント準拠。',
    frontend: 'OpenAI 互換 + Moonshot Base URL。',
    notes: '長コンテキストは単価に注意。',
  },
  zhipu: {
    what: '智譜 BigModel（GLM、OpenAI 互換）。',
    chain:
      '① プラットフォーム：https://open.bigmodel.cn/\n② キー：https://open.bigmodel.cn/usercenter/apikeys\n③ ドキュメント：https://docs.bigmodel.cn/\n④ 互換例：https://open.bigmodel.cn/api/paas/v4\n⑤ OpenAI 互換。モデル例 glm-4。',
    frontend: 'OpenAI 互換 + 智譜 Base URL。',
    notes: '互換パスは最新ドキュメントを確認。',
  },
  siliconflow: {
    what: 'SiliconFlow 硅基流動（OpenAI 互換）。',
    chain:
      '① コンソール：https://cloud.siliconflow.cn/\n② アカウントで API キーを作成。\n③ ドキュメント：https://docs.siliconflow.cn/\n④ API：https://api.siliconflow.cn/v1\n⑤ OpenAI 互換。モデル ID をカタログからコピー。',
    frontend: 'OpenAI 互換 + SiliconFlow Base URL。',
    notes: '無料枠のレート制限に注意。',
  },
  groq: {
    what: 'Groq（高速推論、OpenAI 互換）。',
    chain:
      '① コンソール：https://console.groq.com/\n② キー：https://console.groq.com/keys\n③ ドキュメント：https://console.groq.com/docs\n④ API：https://api.groq.com/openai/v1\n⑤ OpenAI 互換。',
    frontend: 'OpenAI 互換 + Groq Base URL。',
    notes: '無料枠は RPM が厳しい。',
  },
  xai: {
    what: 'xAI Grok API（OpenAI 互換）。',
    chain:
      '① コンソール：https://console.x.ai/\n② ドキュメント：https://docs.x.ai/\n③ API：https://api.x.ai/v1\n④ OpenAI 互換。モデルはドキュメント参照。',
    frontend: 'OpenAI 互換 + xAI Base URL。',
    notes: '利用可否は xAI 口座による。',
  },
  mistral: {
    what: 'Mistral AI（OpenAI 互換）。',
    chain:
      '① コンソール：https://console.mistral.ai/\n② キー：https://console.mistral.ai/api-keys/\n③ ドキュメント：https://docs.mistral.ai/\n④ API：https://api.mistral.ai/v1\n⑤ OpenAI 互換。',
    frontend: 'OpenAI 互換 + Mistral Base URL。',
    notes: 'データ所在はエンタープライズ資料を参照。',
  },
  together: {
    what: 'Together AI（OpenAI 互換）。',
    chain:
      '① コンソール：https://api.together.xyz/\n② キー：https://api.together.xyz/settings/api-keys\n③ ドキュメント：https://docs.together.ai/\n④ API：https://api.together.xyz/v1\n⑤ OpenAI 互換。モデル ID を正確に貼る。',
    frontend: 'OpenAI 互換 + Together Base URL。',
    notes: 'モデル ID が長いことが多い。',
  },
  fireworks: {
    what: 'Fireworks AI（OpenAI 互換）。',
    chain:
      '① コンソール：https://fireworks.ai/\n② Account で API キー。\n③ ドキュメント：https://docs.fireworks.ai/\n④ API：https://api.fireworks.ai/inference/v1\n⑤ OpenAI 互換。',
    frontend: 'OpenAI 互換 + Fireworks Base URL。',
    notes: 'inference パスと名前空間に注意。',
  },
  perplexity: {
    what: 'Perplexity API（OpenAI 互換チャット）。',
    chain:
      '① 設定：https://www.perplexity.ai/settings/api\n② ドキュメント：https://docs.perplexity.ai/\n③ API：https://api.perplexity.ai\n④ OpenAI 互換。モデル例 sonar。',
    frontend: 'OpenAI 互換 + Perplexity Base URL。',
    notes: '検索強化回答。課金はアプリと別の場合あり。',
  },
  minimax: {
    what: 'MiniMax（OpenAI 互換）。',
    chain:
      '① プラットフォーム：https://platform.minimaxi.com/\n② ドキュメント：https://platform.minimaxi.com/document/\n③ Group / API Key を作成。\n④ 公式の OpenAI 互換 Base URL とモデル名を使用。\n⑤ 本ページで OpenAI 互換。',
    frontend: 'OpenAI 互換 + MiniMax Base URL。',
    notes: '国内外でホスト名が異なる場合あり。',
  },
  ollama: {
    what: 'Ollama：ローカル／LAN モデル（OpenAI 互換）。',
    chain:
      '① 導入：https://ollama.com/ と https://github.com/ollama/ollama\n② 既定 API：http://127.0.0.1:11434/v1\n③ ollama pull 後、OpenAI 互換 + 上記 Base URL。\n④ モデル名＝ローカルタグ。\n⑤ 鍵が必須なら任意の非空文字で足りることが多い。',
    frontend: 'OpenAI 互換。Myriad サーバーから Ollama に届く必要あり。',
    notes: 'リモートサーバー上の 127.0.0.1 はサーバー自身。PC 上なら LAN IP やトンネルを使う。',
  },
  cloudflare: {
    what: 'Cloudflare Workers AI（OpenAI 互換）。',
    chain:
      '① ダッシュボード：https://dash.cloudflare.com/\n② ドキュメント：https://developers.cloudflare.com/workers-ai/\n③ ドキュメント記載の OpenAI 互換 endpoint を使用。\n④ OpenAI 互換 + API トークン。',
    frontend: 'OpenAI 互換 + Cloudflare の Base URL。',
    notes: 'モデル ID は Cloudflare カタログから。',
  },
  cohere: {
    what: 'Cohere（互換ゲートウェイまたは OpenRouter）。',
    chain:
      '① ダッシュボード：https://dashboard.cohere.com/\n② キー：https://dashboard.cohere.com/api-keys\n③ ドキュメント：https://docs.cohere.com/\n④ OpenAI 互換プロキシまたは OpenRouter の cohere/… を推奨。',
    frontend: 'OpenRouter または互換ゲートウェイ推奨。',
    notes: 'ネイティブ API は OpenAI と完全同一ではない。',
  },
  nvidia: {
    what: 'NVIDIA NIM / build.nvidia.com（OpenAI 互換）。',
    chain:
      '① カタログ：https://build.nvidia.com/ と https://docs.nvidia.com/nim/\n② API Key と公式の互換 endpoint を取得。\n③ OpenAI 互換。モデル ID をコピー。',
    frontend: 'OpenAI 互換 + NVIDIA Base URL。',
    notes: '利用前に規約同意が必要なモデルあり。',
  },
  tencentHunyuan: {
    what: '騰訊混元。',
    chain:
      '① コンソール：https://console.cloud.tencent.com/hunyuan\n② ドキュメント：https://cloud.tencent.com/document/product/1729\n③ 資格情報／互換 endpoint を作成。\n④ OpenAI 互換 URL があれば本ページの互換欄へ。',
    frontend: '互換 endpoint があるとき OpenAI 互換。',
    notes: '音声は本ページの騰訊雲 TTS/ASR 設定が別。',
  },
  baiduQianfan: {
    what: '百度千帆（文心など）。',
    chain:
      '① コンソール：https://console.bce.baidu.com/qianfan/\n② ドキュメント：https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html\n③ アプリ資格情報または互換モード鍵を作成。\n④ 互換 Base URL があれば OpenAI 互換で接続。',
    frontend: '互換モード時は他社と同様。',
    notes: '認証方式は版で変わる。最新ドキュメント準拠。',
  },
  openaiCompatible: {
    what: '任意の OpenAI 互換中継（One-API、New API、自前ゲートウェイなど）。',
    chain:
      '① 中継管理者から Base URL・API Key・モデル一覧を受け取る。\n② 提供者＝OpenAI 互換。\n③ Base URL は通常 /v1 で終わる（指示がない限り /chat/completions は付けない）。\n④ モデル名は中継の上流設定と一致させる。\n⑤ 保存後、まず少量でテスト。',
    frontend: '各テキスト段の OpenAI 互換フォーム。',
    notes: '不明な無料中継に機微データを流さないこと。',
  },
}

import { CLAUDE_API_HEADERS } from "../shared.js";

// ZCode (Z.ai) OAuth subscription — GLM Coding Plan via the ZCode platform gateway.
// OAuth login (Z.ai account) mints a coding-plan API key ("apiKey.secretKey") at
// api.z.ai; model requests go through the ZCode platform gateway, which does the
// plan entitlement check and forwards to the model service. Mirrors the official
// ZCode CLI (apps/zcode-cli official-coding-plan-gateway):
//   https://api.z.ai/api/anthropic/v1/messages → https://zcode.z.ai/api/v1/ultra-zai/anthropic/v1/messages
// Model ids are the ZCode plan canonical ids (capability whitelist is case-matched).
export default {
  id: "zcode",
  priority: 145,
  alias: "zc",
  display: {
    name: "ZCode",
    icon: "terminal",
    color: "#4F46E5",
    textIcon: "ZC",
    website: "https://zcode.z.ai",
    notice: {
      signupUrl: "https://chat.z.ai",
    },
  },
  category: "oauth",
  hasOAuth: true,
  transport: {
    baseUrl: "https://zcode.z.ai/api/v1/ultra-zai/anthropic/v1/messages",
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
      hooks: ["zcodeHeaders"],
    },
    usage: {
      url: "https://api.z.ai/api/monitor/usage/quota/limit",
    },
  },
  models: [
    { id: "GLM-5.3", name: "GLM 5.3" },
    { id: "GLM-5.3-Flash", name: "GLM 5.3 Flash" },
    { id: "GLM-5V-Turbo", name: "GLM 5V Turbo (Vision)" },
    { id: "GLM-5.2", name: "GLM 5.2" },
    { id: "GLM-5.1", name: "GLM 5.1" },
    { id: "GLM-5.1-Highspeed", name: "GLM 5.1 Highspeed" },
    { id: "GLM-5", name: "GLM 5" },
    { id: "GLM-5-Turbo", name: "GLM 5 Turbo" },
    { id: "GLM-4.7", name: "GLM 4.7" },
    { id: "GLM-4.7-FlashX", name: "GLM 4.7 FlashX" },
    { id: "GLM-4.7-Flash", name: "GLM 4.7 Flash" },
    { id: "GLM-4.6", name: "GLM 4.6" },
    { id: "GLM-4.5-Air", name: "GLM 4.5 Air" },
    { id: "GLM-4.5", name: "GLM 4.5" },
    { id: "GLM-4.6V", name: "GLM 4.6V (Vision)" },
    { id: "GLM-4.6V-Flash", name: "GLM 4.6V Flash (Vision)" },
    { id: "GLM-4.6V-FlashX", name: "GLM 4.6V FlashX (Vision)" },
    { id: "GLM-4.1V-Thinking-FlashX", name: "GLM 4.1V Thinking FlashX (Vision)" },
    { id: "GLM-4.1V-Thinking-Flash", name: "GLM 4.1V Thinking Flash (Vision)" },
  ],
  serviceKinds: ["llm"],
  oauth: {
    // ZCode CLI polling flow (apps/zcode-cli cli-oauth.ts) — no PKCE, no local
    // callback: init mints a one-off poll token, the browser authorize_url is
    // server-generated, and poll/ready carries the tokens directly.
    providerId: "zai",
    cliInitUrl: "https://zcode.z.ai/api/v1/oauth/cli/init",
    cliPollUrl: "https://zcode.z.ai/api/v1/oauth/cli/poll",
    // Z.AI OAuth token → platform business JWT (ZaiBusinessTokenResolver)
    businessLoginUrl: "https://api.z.ai/api/auth/z/login",
    // Business JWT → coding-plan API key ("zcode-api-key"."secretKey")
    apiBaseUrl: "https://api.z.ai",
    planApiKeyName: "zcode-api-key",
    // No refresh_token grant on the ZAI OAuth provider — the coding-plan API key
    // is long-lived; expiry/revocation means re-login (same as the official CLI).
  },
  features: {
    usage: true,
  },
};

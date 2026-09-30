import { CLAUDE_API_HEADERS } from "../shared.js";

// Z.ai ZCode subscription (OAuth). Mirrors zai-org/ZCode: authorize on chat.z.ai,
// code exchanged via zcode.z.ai, then swapped for a business token (api.z.ai) that
// authenticates the GLM Coding endpoints. No refresh token — re-login on expiry.
export default {
  id: "zcode",
  priority: 141,
  alias: "zcode",
  display: {
    name: "ZCode (Z.ai)",
    icon: "terminal",
    color: "#2563EB",
    textIcon: "ZC",
    website: "https://zcode.z.ai",
    notice: {
      text: "Sign in with your Z.ai account. After approving, the browser is redirected to zcode://oauth/callback?... — copy that full URL from the address bar (or the failed-redirect link) and paste it back here.",
    },
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_API_HEADERS },
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5-turbo", name: "GLM 5 Turbo" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-4.7", name: "GLM 4.7" },
  ],
  serviceKinds: ["llm"],
  oauth: {
    clientId: "client_P8X5CMWmlaRO9gyO-KSqtg",
    authorizeUrl: "https://chat.z.ai/api/oauth/authorize",
    tokenUrl: "https://zcode.z.ai/api/v1/oauth/token",
    userinfoUrl: "https://chat.z.ai/api/oauth/userinfo",
    businessLoginUrl: "https://api.z.ai/api/auth/z/login",
    redirectUri: "zcode://oauth/callback",
  },
};

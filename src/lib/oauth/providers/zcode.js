import { ZCODE_CONFIG } from "../constants/oauth.js";

// ZCode (Z.ai) — authorization code flow (no PKCE) per zai-org/ZCode.
// The upstream OAuth app only allows the desktop redirect (zcode://oauth/callback), so the
// user pastes the callback URL. Token endpoint returns { code, data: { token, zai: { access_token }, user } };
// zai.access_token is then swapped for the business token that authenticates api.z.ai.
const zcode = {
  config: ZCODE_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config, redirectUri, state) => {
    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      response_type: "code",
      client_id: config.clientId,
      state,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config, code, redirectUri, _codeVerifier, state) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ provider: "zai", code, redirect_uri: redirectUri, state }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || (payload.code !== undefined && payload.code !== 0)) {
      throw new Error(`Token exchange failed: ${payload?.msg || response.status}`);
    }
    const oauthToken = payload.data?.zai?.access_token;
    if (!oauthToken) throw new Error("Token exchange failed: missing data.zai.access_token");

    const loginRes = await fetch(config.businessLoginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: oauthToken }),
    });
    const login = await loginRes.json().catch(() => null);
    const okCode = [undefined, null, 0, 200, "0", "200"].includes(login?.code);
    const accessToken = (login?.data?.access_token || login?.data?.accessToken || "").trim();
    if (!loginRes.ok || !okCode || login?.success === false || !accessToken) {
      throw new Error("Z.ai business login failed");
    }
    return {
      accessToken,
      expiresIn: login.data?.expires_in || payload.data?.expires_in,
      user: payload.data?.user,
    };
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: null,
    expiresIn: Number.isFinite(tokens.expiresIn) && tokens.expiresIn > 0 ? tokens.expiresIn : null,
    email: tokens.user?.email || undefined,
    displayName: tokens.user?.name || undefined,
    providerSpecificData: {
      authMethod: "oauth",
      ...(tokens.user?.user_id ? { userId: tokens.user.user_id } : {}),
    },
  }),
};

export default zcode;

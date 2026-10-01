import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// proxyAwareFetch captures globalThis.fetch at import time — mock the module
// (like kimi-usage.test.js) instead of stubbing global fetch for usage tests.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
  default: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import zcodeProvider from "../../src/lib/oauth/providers/zcode.js";
import { getProvider } from "../../src/lib/oauth/providers";
import { PROVIDERS as TRANSPORTS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const GATEWAY_URL = "https://zcode.z.ai/api/v1/ultra-zai/anthropic/v1/messages";
const START_PLAN_URL = "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages";
const PLAN_KEY = "key123.secret456";
const ZCODE_JWT = "zcode-jwt";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("zcode registry entry", () => {
  it("is an oauth provider listed via byCategory with usage enabled", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("zcode");
    expect(PROVIDER_OAUTH.zcode).toBeDefined();
  });

  it("routes model requests through the ZCode platform gateway (anthropic format)", () => {
    expect(TRANSPORTS.zcode.baseUrl).toBe(GATEWAY_URL);
    expect(TRANSPORTS.zcode.startPlanBaseUrl).toBe(START_PLAN_URL);
    expect(TRANSPORTS.zcode.format).toBe("claude");
    // gateway reads x-api-key OR Bearer — hook mirrors the official CLI (both)
    expect(TRANSPORTS.zcode.auth.header).toBe("x-api-key");
    expect(TRANSPORTS.zcode.auth.hooks).toContain("zcodeHeaders");
  });

  it("declares the ZCode CLI polling OAuth endpoints (no refresh grant)", () => {
    expect(PROVIDER_OAUTH.zcode.cliInitUrl).toBe("https://zcode.z.ai/api/v1/oauth/cli/init");
    expect(PROVIDER_OAUTH.zcode.cliPollUrl).toBe("https://zcode.z.ai/api/v1/oauth/cli/poll");
    expect(PROVIDER_OAUTH.zcode.businessLoginUrl).toBe("https://api.z.ai/api/auth/z/login");
    expect(PROVIDER_OAUTH.zcode.planBalanceUrl).toBe(
      "https://zcode.z.ai/api/v1/zcode-plan/billing/balance",
    );
    expect(PROVIDER_OAUTH.zcode.refresh).toBeUndefined();
  });

  it("is wired into the generic OAuth provider registry", () => {
    expect(getProvider("zcode")).toBe(zcodeProvider);
  });
});

describe("zcode OAuth flow (ZCode CLI poll protocol)", () => {
  let calls;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        const entry = { url: String(url), method: init.method || "GET", init };
        calls.push(entry);
        const u = new URL(url);

        if (u.href === "https://zcode.z.ai/api/v1/oauth/cli/init") {
          return jsonResponse({
            code: 0,
            data: {
              authorize_url: "https://chat.z.ai/api/oauth/authorize?x=1",
              flow_id: "flow-123",
              poll_interval_sec: 2,
              expires_at: Math.floor(Date.now() / 1000) + 300,
            },
          });
        }
        if (u.pathname.startsWith("/api/v1/oauth/cli/poll/")) {
          if (globalThis.__zcodePollState === "pending") {
            return jsonResponse({ code: 0, data: { status: "pending" } });
          }
          return jsonResponse({
            code: 0,
            data: {
              status: "ready",
              token: "zcode-jwt",
              providerId: "zai",
              user: { user_id: "u-1", name: "Feavy", email: "feavy@example.com" },
              zai: { access_token: "zai-oauth-token", refresh_token: "zai-refresh-token" },
            },
          });
        }
        if (u.href === "https://api.z.ai/api/auth/z/login") {
          return jsonResponse({ code: 200, data: { access_token: "zai-business-jwt" } });
        }
        if (u.href === "https://api.z.ai/api/biz/customer/getCustomerInfo") {
          return jsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-1",
                  organizationName: "默认机构",
                  projects: [{ projectId: "p-1", projectName: "默认项目", projectType: "1" }],
                },
              ],
            },
          });
        }
        if (u.pathname.endsWith("/api_keys") && entry.method === "GET") {
          return jsonResponse({ code: 200, data: [] });
        }
        if (u.pathname.endsWith("/api_keys")) {
          return jsonResponse({ code: 200, data: { apiKey: "key123", name: "zcode-api-key" } });
        }
        if (u.pathname.endsWith("/copy/key123")) {
          return jsonResponse({ code: 200, data: { secretKey: "secret456" } });
        }
        if (u.pathname === "/api/v1/zcode-plan/billing/balance") {
          if (!globalThis.__zcodeNoStartPlan) {
            return jsonResponse({
              code: 0,
              data: {
                plans: [
                  { plan_id: "zcode-v3-start-plan-1001", name: "ZCode Start Plan", status: "active" },
                ],
                balances: [],
              },
            });
          }
          return jsonResponse({ code: 0, data: { plans: [], balances: [] } });
        }
        return jsonResponse({ code: 500, msg: `unexpected ${url}` }, 500);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__zcodePollState;
    delete globalThis.__zcodeNoStartPlan;
  });

  it("init returns the server-generated authorize URL + flow id", async () => {
    const device = await zcodeProvider.requestDeviceCode(zcodeProvider.config);
    expect(device.device_code).toBe("flow-123");
    expect(device.verification_uri).toBe("https://chat.z.ai/api/oauth/authorize?x=1");
    expect(device._zcodePollToken).toEqual(expect.any(String));
    expect(calls[0].init.headers.Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(calls[0].init.body)).toEqual({ provider: "zai" });
  });

  it("maps pending poll state to authorization_pending", async () => {
    globalThis.__zcodePollState = "pending";
    const result = await zcodeProvider.pollToken(zcodeProvider.config, "flow-123", null, {
      _zcodePollToken: "t",
    });
    expect(result).toEqual({ ok: true, data: { error: "authorization_pending" } });
  });

  it("derives the coding-plan API key and detects an active Start Plan", async () => {
    const result = await zcodeProvider.pollToken(zcodeProvider.config, "flow-123", null, {
      _zcodePollToken: "t",
    });

    expect(result.ok).toBe(true);
    expect(result.data._zcodePlanKind).toBe("start-plan");
    // Start Plan accounts authenticate with the zcode JWT, not the coding-plan key
    expect(result.data.access_token).toBe(ZCODE_JWT);
    expect(result.data._zcodeCodingPlanApiKey).toBe(PLAN_KEY);
    expect(result.data._zcodeJwtToken).toBe(ZCODE_JWT);

    // derivation chain: business login → customer info → api_keys create → copy
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("https://api.z.ai/api/auth/z/login");
    expect(urls).toContain("https://api.z.ai/api/biz/customer/getCustomerInfo");
    expect(urls).toContain("https://api.z.ai/api/biz/v1/organization/org-1/projects/p-1/api_keys");
    expect(urls).toContain(
      "https://api.z.ai/api/biz/v1/organization/org-1/projects/p-1/api_keys/copy/key123",
    );
  });

  it("uses the coding-plan API key when no Start Plan is active", async () => {
    globalThis.__zcodeNoStartPlan = true;
    const result = await zcodeProvider.pollToken(zcodeProvider.config, "flow-123", null, {
      _zcodePollToken: "t",
    });

    expect(result.ok).toBe(true);
    expect(result.data._zcodePlanKind).toBe("coding-plan");
    expect(result.data.access_token).toBe(PLAN_KEY);
  });

  it("checks the Start Plan balance with the zcode JWT and a device id", async () => {
    globalThis.__zcodeNoStartPlan = true;
    await zcodeProvider.pollToken(zcodeProvider.config, "flow-123", null, { _zcodePollToken: "t" });

    const balanceCall = calls.find((c) => c.url.includes("/api/v1/zcode-plan/billing/balance"));
    expect(balanceCall).toBeDefined();
    expect(balanceCall.init.headers.Authorization).toBe(`Bearer ${ZCODE_JWT}`);
    expect(balanceCall.init.headers["X-Device-Mid"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("mapTokens stores the active credential, plan kind and account identity", () => {
    const tokens = zcodeProvider.mapTokens({
      access_token: ZCODE_JWT,
      _zcodePlanKind: "start-plan",
      _zcodeCodingPlanApiKey: PLAN_KEY,
      _zcodeDeviceMid: "mid-1",
      _zcodeJwtToken: ZCODE_JWT,
      _zaiBusinessToken: "zai-business-jwt",
      _zaiRefreshToken: "zai-refresh-token",
      _zcodeUser: { user_id: "u-1", name: "Feavy", email: "feavy@example.com" },
    });

    expect(tokens.accessToken).toBe(ZCODE_JWT);
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.email).toBe("feavy@example.com");
    expect(tokens.displayName).toBe("Feavy");
    expect(tokens.providerSpecificData).toMatchObject({
      authMethod: "cli_poll",
      username: "Feavy",
      userId: "u-1",
      planKind: "start-plan",
      codingPlanApiKey: PLAN_KEY,
      deviceMid: "mid-1",
      zcodeJwtToken: ZCODE_JWT,
      zaiBusinessToken: "zai-business-jwt",
      zaiRefreshToken: "zai-refresh-token",
    });
  });

  it("fails cleanly without the poll token (restart required)", async () => {
    const result = await zcodeProvider.pollToken(zcodeProvider.config, "flow-123", null, {});
    expect(result.data.error).toBe("access_denied");
  });
});

describe("zcode executor + usage", () => {
  const startPlanCreds = {
    accessToken: ZCODE_JWT,
    apiKey: null,
    providerSpecificData: { planKind: "start-plan", zcodeJwtToken: ZCODE_JWT },
  };
  const codingPlanCreds = {
    accessToken: PLAN_KEY,
    apiKey: null,
    providerSpecificData: { planKind: "coding-plan", zcodeJwtToken: ZCODE_JWT },
  };

  it("sends the plan key as x-api-key AND Bearer to the gateway URL", () => {
    const executor = new DefaultExecutor("zcode");
    const creds = { accessToken: PLAN_KEY, refreshToken: null };

    const headers = executor.buildHeaders(creds, true, GATEWAY_URL, "GLM-5.3", {});
    expect(headers["x-api-key"]).toBe(PLAN_KEY);
    expect(headers["Authorization"]).toBe(`Bearer ${PLAN_KEY}`);
    expect(executor.buildUrl("GLM-5.3", true, 0, creds)).toBe(GATEWAY_URL);
  });

  it("routes start-plan accounts to the zcode-plan gateway with the JWT", () => {
    const executor = new DefaultExecutor("zcode");

    expect(executor.buildUrl("GLM-5.3-Flash", true, 0, startPlanCreds)).toBe(START_PLAN_URL);

    const headers = executor.buildHeaders(startPlanCreds, true, START_PLAN_URL, "GLM-5.3-Flash", {});
    expect(headers["x-api-key"]).toBe(ZCODE_JWT);
    expect(headers["Authorization"]).toBe(`Bearer ${ZCODE_JWT}`);
    // ZCode client identity headers the gateway expects
    expect(headers["User-Agent"]).toMatch(/^ZCode\//);
    expect(headers["X-Title"]).toBe("Z Code@cli");
    expect(headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("routes coding-plan accounts to the ultra-zai gateway with the plan key", () => {
    const executor = new DefaultExecutor("zcode");
    expect(executor.buildUrl("GLM-5.3-Flash", true, 0, codingPlanCreds)).toBe(GATEWAY_URL);
  });

  it("tries the start-plan route first for connections with no recorded plan", () => {
    const executor = new DefaultExecutor("zcode");
    const creds = {
      accessToken: PLAN_KEY,
      providerSpecificData: { zcodeJwtToken: ZCODE_JWT },
    };
    expect(executor.buildUrl("GLM-5.3-Flash", true, 0, creds)).toBe(START_PLAN_URL);
    expect(executor.buildUrl("GLM-5.3-Flash", true, 1, creds)).toBe(GATEWAY_URL);
  });

  it("falls back to the coding-plan route only on auth failures", () => {
    const executor = new DefaultExecutor("zcode");
    // 429/1113 (no resource package) is terminal, not a routing signal
    expect(executor.shouldRetry(429, 0)).toBe(false);
    expect(executor.shouldRetry(401, 0)).toBe(true);
    expect(executor.shouldRetry(403, 0)).toBe(true);
    expect(executor.shouldRetry(401, 1)).toBe(false);
  });

  it("explains the 3012 Start Plan client rejection instead of leaking the code", () => {
    const executor = new DefaultExecutor("zcode");
    const body = JSON.stringify({ code: 3012, msg: "request has been blocked due to unusual activity." });

    const parsed = executor.parseError({ status: 405 }, body);
    expect(parsed.status).toBe(405);
    expect(parsed.message).toMatch(/official ZCode/i);
    expect(parsed.message).toMatch(/3012/);
  });

  it("leaves other zcode errors untouched", () => {
    const executor = new DefaultExecutor("zcode");
    const parsed = executor.parseError({ status: 500 }, "upstream exploded");
    expect(parsed.message).toBe("upstream exploded");
  });

  it("never schedules a token refresh (no refresh grant upstream)", async () => {
    const executor = new DefaultExecutor("zcode");
    const result = await executor.refreshCredentials(
      { accessToken: PLAN_KEY, refreshToken: null },
      console,
    );
    expect(result).toBeNull();
  });

  it("fetches coding-plan quota from the GLM monitor endpoint with the plan key", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          level: "PRO",
          limits: [
            { type: "TOKENS_LIMIT", percentage: 35.5, number: 5, unit: 3, nextResetTime: Date.now() + 3600_000 },
          ],
        },
      }),
    );

    const usage = await getUsageForProvider(
      {
        provider: "zcode",
        accessToken: PLAN_KEY,
        apiKey: null,
        providerSpecificData: { planKind: "coding-plan" },
      },
      null,
    );
    expect(usage.plan).toBe("Pro");
    expect(usage.quotas["Session (5h)"].used).toBe(35.5);
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/monitor/usage/quota/limit",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${PLAN_KEY}` }) }),
      null,
    );
  });

  it("fetches start-plan quota from zcode-plan billing with the JWT", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        data: {
          plans: [{ plan_id: "zcode-v3-start-plan-1001", name: "ZCode Start Plan", status: "active" }],
          balances: [
            {
              show_name: "GLM-5.3-Flash",
              total_units: 1000,
              used_units: 250,
              expires_at: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        },
      }),
    );

    const usage = await getUsageForProvider(
      {
        provider: "zcode",
        accessToken: ZCODE_JWT,
        apiKey: null,
        providerSpecificData: { planKind: "start-plan", zcodeJwtToken: ZCODE_JWT, deviceMid: "mid-1" },
      },
      null,
    );

    expect(usage.plan).toBe("ZCode Start Plan");
    expect(usage.quotas["GLM-5.3-Flash"].used).toBe(25);
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toContain("https://zcode.z.ai/api/v1/zcode-plan/billing/balance");
    expect(init.headers.Authorization).toBe(`Bearer ${ZCODE_JWT}`);
    expect(init.headers["X-Device-Mid"]).toBe("mid-1");
  });
});

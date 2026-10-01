/**
 * ZCode (Z.ai) subscription usage. Two credential surfaces, mirroring the model
 * routing in executors/default.js:
 *   - Start Plan accounts authenticate with the zcode JWT; quota comes from the
 *     zcode-plan billing/balance endpoint (X-Device-Mid required).
 *   - Coding-plan accounts use the OAuth-derived API key, a regular api.z.ai
 *     coding-plan key, so quota comes from the GLM monitor endpoint.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";
import { parseGlmQuotaResponse } from "./glm.js";
import { PROVIDER_OAUTH } from "../../config/providers.js";
import { ZCODE_CLI_VERSION, buildZcodeDeviceMid } from "../../shared/zcodeSource.js";

const ZCODE_QUOTA_URL = U("zcode").url || "https://api.z.ai/api/monitor/usage/quota/limit";
const ZCODE_PLAN_BALANCE_URL = PROVIDER_OAUTH?.zcode?.planBalanceUrl;

export async function getZcodeUsage(connection, proxyOptions = null) {
  const psd = connection?.providerSpecificData || {};
  const jwt = psd.zcodeJwtToken || "";
  const apiKey = connection?.apiKey || connection?.accessToken || "";

  if (jwt && (psd.planKind === "start-plan" || !apiKey)) {
    return getZcodeStartPlanUsage(jwt, psd, proxyOptions);
  }
  if (!apiKey) {
    return { message: "ZCode API key not available." };
  }
  return getZcodeCodingPlanUsage(apiKey, proxyOptions);
}

async function getZcodeCodingPlanUsage(apiKey, proxyOptions) {
  try {
    const response = await proxyAwareFetch(
      ZCODE_QUOTA_URL,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (!response.ok) {
      if (response.status === 401) {
        return { message: "ZCode token invalid or expired. Reconnect the provider." };
      }
      return { message: `ZCode quota API error (${response.status}).` };
    }

    const json = await response.json();
    const { plan, quotas } = parseGlmQuotaResponse(json);
    return { plan, quotas };
  } catch (error) {
    return { message: `ZCode error: ${error.message}` };
  }
}

async function getZcodeStartPlanUsage(jwt, psd, proxyOptions) {
  if (!ZCODE_PLAN_BALANCE_URL) {
    return { message: "ZCode start-plan usage not configured." };
  }

  try {
    const response = await proxyAwareFetch(
      `${ZCODE_PLAN_BALANCE_URL}?app_version=${ZCODE_CLI_VERSION}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          "X-Device-Mid": psd.deviceMid || buildZcodeDeviceMid(psd.userId),
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (!response.ok) {
      if (response.status === 401) {
        return { message: "ZCode token invalid or expired. Reconnect the provider." };
      }
      return { message: `ZCode quota API error (${response.status}).` };
    }

    const json = await response.json();
    return parseStartPlanUsage(json);
  } catch (error) {
    return { message: `ZCode error: ${error.message}` };
  }
}

// billing/balance → { plan, quotas } with percent-based quota entries matching
// the GLM monitor shape consumed by the UI.
export function parseStartPlanUsage(json) {
  const data = json?.data && typeof json.data === "object" ? json.data : {};
  const balances = Array.isArray(data.balances) ? data.balances : [];
  const quotas = {};

  for (const balance of balances) {
    const total = Number(balance?.total_units);
    if (!Number.isFinite(total) || total <= 0) continue;
    const usedUnits = Math.max(0, Number(balance?.used_units) || 0);
    const usedPercent = Math.min(100, (usedUnits / total) * 100);
    const remaining = Math.max(0, 100 - usedPercent);
    const key = balance?.show_name || balance?.entitlement_id || "Tokens";

    quotas[key] = {
      used: usedPercent,
      total: 100,
      remaining,
      remainingPercentage: remaining,
      resetAt: toIso(balance?.expires_at),
      unlimited: false,
    };
  }

  const plans = Array.isArray(data.plans) ? data.plans : [];
  const active = plans.find((plan) => String(plan?.status || "").toLowerCase() === "active");
  const plan = active?.name || (plans.length ? "Start Plan" : "Unknown");

  return { plan, quotas };
}

function toIso(epochSeconds) {
  const value = Number(epochSeconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
}

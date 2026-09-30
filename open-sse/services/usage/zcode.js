/**
 * ZCode (Z.ai) subscription usage — the OAuth-derived coding-plan API key is a
 * regular api.z.ai coding-plan key, so quota comes from the same GLM monitor
 * endpoint (url from registry transport.usage).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";
import { parseGlmQuotaResponse } from "./glm.js";

const ZCODE_QUOTA_URL = U("zcode").url || "https://api.z.ai/api/monitor/usage/quota/limit";

export async function getZcodeUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "ZCode API key not available." };
  }

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

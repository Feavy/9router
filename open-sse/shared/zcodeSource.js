import { randomUUID, createHash } from "crypto";
import { platform, arch, release } from "os";

// ZCode client identity headers for the zcode.z.ai platform gateway. Mirrors
// apps/zcode-cli buildCliZCodeSourceHeaders + the model-request attribution
// headers: the gateway flags requests without them as abnormal clients.
const ZCODE_CLI_VERSION = "0.16.9";

export { ZCODE_CLI_VERSION };

export function isZcodePlanRoute(url) {
  return typeof url === "string" && url.includes("/zcode-plan/");
}

export function buildZcodeSourceHeaders() {
  const os = platform();
  const osCategory = os === "darwin" ? "macos" : os === "win32" ? "windows" : "linux";
  return {
    "HTTP-Referer": "https://zcode.z.ai",
    "User-Agent": `ZCode/${ZCODE_CLI_VERSION}`,
    "X-ZCode-App-Version": ZCODE_CLI_VERSION,
    "X-Title": "Z Code@cli",
    "X-Release-Channel": "production",
    "X-Client-Language": "en-US",
    "X-Client-Timezone": "UTC",
    "X-ZCode-Agent": "glm",
    ...(os && arch() ? { "X-Platform": `${os}-${arch()}` } : {}),
    "X-Os-Category": osCategory,
    ...(release() ? { "X-Os-Version": release() } : {}),
    // Per-request attribution (the CLI stamps these on every model request)
    "x-request-id": randomUUID(),
  };
}

// X-Device-Mid is required by the zcode-plan billing endpoints (3001 parameter
// error without it). Any stable UUID works; derive one deterministically from
// the OAuth user id so a connection keeps the same device identity.
export function buildZcodeDeviceMid(userKey) {
  const hex = createHash("md5").update(String(userKey || "zcode")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

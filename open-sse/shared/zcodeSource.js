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

// The zcode-plan gateway fingerprints the agent's system prompt and answers
// 405 {"code":3012,"msg":"request has been blocked due to unusual activity."}
// when it doesn't match the official ZCode client. Verified against the live
// gateway (tests/manual/zcode-plan-probe.mjs):
//   - system[0].text must equal ZCODE_CLI_PREFIX exactly (a trailing space fails).
//   - system[1].text must start with ZCODE_IDENTITY_PROMPT verbatim — the
//     identity intro, security notice and # Harness block from
//     ZCode apps/zcode-cli packages/core/src/context/sections/{cli-prefix,
//     identity}.ts. A single-character mutation inside the harness block fails;
//     extra content appended to the block and further system blocks are fine.
//   - Headers, metadata, tools and cache_control are not part of the check.
// 9router therefore prepends these two blocks to the client's own system prompt
// (the client prompt is preserved as the following blocks).
export const ZCODE_CLI_PREFIX = "You are ZCode, an interactive coding agent";

const ZCODE_SECURITY_NOTICE =
  "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";

export const ZCODE_IDENTITY_PROMPT = [
  "",
  "You are an interactive ZCode agent that helps users with software engineering tasks.",
  "",
  ZCODE_SECURITY_NOTICE,
  "",
  "# Harness",
  "- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
  "- Tools run behind a user-selected permission mode; a denied call means the user declined it \u2014 adjust, don't retry verbatim.",
  "- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.",
  "- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
  "- Reference code as `file_path:line_number` \u2014 it's clickable.",
].join("\n");

// Prepend the ZCode client identity blocks to body.system in place. Idempotent:
// a system prompt that already starts with the CLI prefix (a real ZCode client
// routed through 9router) is left untouched. No cache_control on the injected
// blocks so client cache breakpoints stay within the upstream limit.
export function applyZcodePlanSystemPrompt(body) {
  if (!body || typeof body !== "object") return body;

  const firstText = Array.isArray(body.system)
    ? body.system[0]?.text
    : typeof body.system === "string" ? body.system : undefined;
  if (typeof firstText === "string" && firstText.startsWith(ZCODE_CLI_PREFIX)) return body;

  const identityBlocks = [
    { type: "text", text: ZCODE_CLI_PREFIX },
    { type: "text", text: ZCODE_IDENTITY_PROMPT },
  ];
  if (Array.isArray(body.system)) {
    body.system = [...identityBlocks, ...body.system];
  } else if (typeof body.system === "string" && body.system.length > 0) {
    body.system = [...identityBlocks, { type: "text", text: body.system }];
  } else if (body.system && typeof body.system === "object") {
    body.system = [...identityBlocks, body.system];
  } else {
    body.system = identityBlocks;
  }
  return body;
}

// Probe the ZCode Start Plan gateway to identify the client fingerprint check.
// Usage: node tests/manual/zcode-plan-probe.mjs [case]  (case: minimal|full|sysblock|...)
import { randomUUID } from "node:crypto";
import { release } from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import Database from "better-sqlite3";
const db = new Database("/home/kasm-user/.9router/db/data.sqlite", { readonly: true });
const row = db.prepare("SELECT data FROM providerConnections WHERE provider='zcode'").get();
const conn = JSON.parse(row.data);
const jwt = conn.providerSpecificData.zcodeJwtToken;

const URL = "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages";

function baseHeaders() {
  const h = {
    "Content-Type": "application/json",
    "x-api-key": jwt,
    Authorization: `Bearer ${jwt}`,
    "HTTP-Referer": "https://zcode.z.ai",
    "User-Agent": "ZCode/0.16.9",
    "X-ZCode-App-Version": "0.16.9",
    "X-Title": "Z Code@cli",
    "X-Release-Channel": "production",
    "X-Client-Language": "en-US",
    "X-Client-Timezone": "UTC",
    "X-ZCode-Agent": "glm",
    "X-Platform": `linux-${process.arch}`,
    "X-Os-Category": "linux",
    "X-Os-Version": release(),
    "x-request-id": randomUUID(),
  };
  return h;
}

const CLI_PREFIX = "You are ZCode, an interactive coding agent";

const IDENTITY = [
  "",
  "You are an interactive ZCode agent that helps users with software engineering tasks.",
  "",
  "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.",
  "",
  "# Harness",
  "- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
  "- Tools run behind a user-selected permission mode; a denied call means the user declined it \u2014 adjust, don't retry verbatim.",
  "- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.",
  "- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
  "- Reference code as `file_path:line_number` \u2014 it's clickable.",
].join("\n");

const DESKTOP = [
  "# ZCode Desktop Context",
  "",
  "### Files & URLs",
  "- Return local web URLs as Markdown links (e.g., [label](http://127.0.0.1:8080)).",
  "- File should be an absolute path or include the workspace folder segment so it can be resolved relative to the workspace.",
  "- Unless otherwise specified, return local file references as Markdown links (e.g., [name.md](/absolute/path/to/name.md)).",
  "",
  "### Inline Code Comments",
  "- Use the ::code-comment{...} directive when you need to attach feedback directly to specific code lines.",
  "- Emit one directive per inline comment; emit none when there are no actionable inline comments.",
  "- Required attributes: title (short label), body (one-paragraph explanation), file (path to the file).",
  "- Optional attributes: start, end (1-based line numbers), priority (0-3).",
  "- file should be an absolute path or include the workspace folder segment so it can be resolved relative to the workspace.",
  "- Keep line ranges tight; end defaults to start.",
  '- Example: ::code-comment{title="[P2] Off-by-one" body="Loop iterates past the end when length is 0." file="/path/to/foo.ts" start=10 end=11 priority=2}',
].join("\n");

const CC_SYSTEM = `You are Claude Code, Anthropic's official CLI for Claude.`;

function sysBlock(text, cache = true) {
  const b = { type: "text", text };
  if (cache) b.cache_control = { type: "ephemeral" };
  return b;
}

function buildCase(name) {
  const headers = baseHeaders();
  const body = {
    model: "GLM-5.3-Flash",
    max_tokens: 32,
    stream: true,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  };

  switch (name) {
    case "minimal": {
      // exactly what 9router sends today: generic system prompt or none
      body.system = [sysBlock(CC_SYSTEM)];
      body.metadata = { user_id: "user_9router_test_account__session_abc123" };
      break;
    }
    case "nosys": {
      delete body.system;
      break;
    }
    case "full-zcode": {
      body.system = [
        sysBlock(CLI_PREFIX),
        sysBlock(IDENTITY + "\n\n" + DESKTOP),
      ];
      body.metadata = { user_id: "user_40b83df4_69b3_49cc_b7cf_b1eaf19ba184__session_" + randomUUID().replace(/-/g, "").slice(0, 16) };
      Object.assign(headers, {
        "x-zcode-trace-id": randomUUID(),
        "x-session-id": randomUUID(),
        "x-zcode-session-type": "main",
      });
      break;
    }
    case "full-nometa": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY + "\n\n" + DESKTOP)];
      break;
    }
    case "sys-only": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY + "\n\n" + DESKTOP)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "harness-only": {
      body.system = [sysBlock(IDENTITY)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-only": {
      body.system = [sysBlock(CLI_PREFIX)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "desktop-only": {
      body.system = [sysBlock(DESKTOP)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "identity-desktop": {
      body.system = [sysBlock(IDENTITY + "\n\n" + DESKTOP)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-desktop": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(DESKTOP)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "one-block-all": {
      body.system = [sysBlock(CLI_PREFIX + "\n\n" + IDENTITY + "\n\n" + DESKTOP)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity-desktop-3blocks": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY), sysBlock(DESKTOP)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "cc-plus-zcode": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(CC_SYSTEM)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-garbage": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock("Just a helpful assistant.")];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-harnessline-only": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock("# Harness\n- Reference code as `file_path:line_number` \u2014 it's clickable.")];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity-cc-third": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY), sysBlock(CC_SYSTEM)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity-merged2": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY + "\n\nJust a helpful assistant.")];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-trailing-space-identity": {
      body.system = [sysBlock(CLI_PREFIX + " "), sysBlock(IDENTITY)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-security-only": {
      const sec = IDENTITY.split("\n\n")[1];
      body.system = [sysBlock(CLI_PREFIX), sysBlock(sec)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-harnessblock-only": {
      const harness = IDENTITY.slice(IDENTITY.indexOf("# Harness"));
      body.system = [sysBlock(CLI_PREFIX), sysBlock(harness)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity-nosec": {
      const nosec = IDENTITY.replace(/^IMPORTANT:.*$/m, "").replace("\n\n\n\n", "\n\n");
      body.system = [sysBlock(CLI_PREFIX), sysBlock(nosec)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity-noharness": {
      const noharness = IDENTITY.slice(0, IDENTITY.indexOf("\n\n# Harness"));
      body.system = [sysBlock(CLI_PREFIX), sysBlock(noharness)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity-nostream": {
      body.stream = false;
      body.max_tokens = 16;
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity-mutated": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY.replace("clickable", "clickablr"))];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "prefix-identity-nothink": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(IDENTITY)];
      body.metadata = { user_id: "user_x__session_y" };
      body.thinking = { type: "disabled" };
      break;
    }
    case "prefix-identity-nocache": {
      body.system = [
        { type: "text", text: CLI_PREFIX },
        { type: "text", text: IDENTITY },
        { type: "text", text: CC_SYSTEM, cache_control: { type: "ephemeral" } },
      ];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "cc-with-zcode-prefix": {
      body.system = [sysBlock(CLI_PREFIX + "\n\n" + CC_SYSTEM)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    case "zcode-prefix-plus-cc": {
      body.system = [sysBlock(CLI_PREFIX), sysBlock(CC_SYSTEM)];
      body.metadata = { user_id: "user_x__session_y" };
      break;
    }
    default:
      throw new Error("unknown case: " + name);
  }
  return { headers, body };
}

const caseName = process.argv[2] || "minimal";
const { headers, body } = buildCase(caseName);

const res = await fetch(URL, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

console.log("case:", caseName, "status:", res.status);
const text = await res.text();
console.log(text.slice(0, 800));

/**
 * Unit tests for the ZCode Start Plan system-prompt cloak (applyZcodePlanSystemPrompt).
 *
 * The zcode-plan gateway fingerprints the agent's system prompt and answers
 * 405 {"code":3012} when system[0] isn't exactly the ZCode CLI prefix and
 * system[1] doesn't carry the ZCode identity/harness block. Verified against
 * the live gateway with tests/manual/zcode-plan-probe.mjs: headers, metadata,
 * tools and cache_control are not part of the check, extra content appended to
 * the identity block and extra system blocks are allowed, and a single-character
 * mutation inside the harness block is rejected.
 */

import { describe, it, expect } from "vitest";
import {
  applyZcodePlanSystemPrompt,
  ZCODE_CLI_PREFIX,
  ZCODE_IDENTITY_PROMPT,
} from "../../open-sse/shared/zcodeSource.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";

describe("applyZcodePlanSystemPrompt", () => {
  it("prepends the CLI prefix and identity blocks before the client's system blocks", () => {
    const body = {
      system: [{ type: "text", text: CLAUDE_CODE_SYSTEM, cache_control: { type: "ephemeral" } }],
    };
    applyZcodePlanSystemPrompt(body);
    expect(body.system).toHaveLength(2 + 1);
    expect(body.system[0].text).toBe(ZCODE_CLI_PREFIX);
    expect(body.system[1].text).toBe(ZCODE_IDENTITY_PROMPT);
    // Client block preserved behind the cloak, with its cache_control intact.
    expect(body.system[2].text).toBe(CLAUDE_CODE_SYSTEM);
    expect(body.system[2].cache_control).toEqual({ type: "ephemeral" });
    // No cache_control on injected blocks — client breakpoints stay within the upstream limit.
    expect(body.system[0]).not.toHaveProperty("cache_control");
    expect(body.system[1]).not.toHaveProperty("cache_control");
  });

  it("wraps a string system prompt as a trailing block", () => {
    const body = { system: "be helpful" };
    applyZcodePlanSystemPrompt(body);
    expect(body.system[0].text).toBe(ZCODE_CLI_PREFIX);
    expect(body.system[2].text).toBe("be helpful");
  });

  it("installs both blocks when the request has no system prompt", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    applyZcodePlanSystemPrompt(body);
    expect(body.system.map((b) => b.text)).toEqual([ZCODE_CLI_PREFIX, ZCODE_IDENTITY_PROMPT]);
  });

  it("leaves a real ZCode client prompt untouched (idempotent)", () => {
    const body = { system: [{ type: "text", text: ZCODE_CLI_PREFIX }, { type: "text", text: "more" }] };
    applyZcodePlanSystemPrompt(body);
    expect(body.system).toHaveLength(2);
    // Second pass is a no-op too.
    applyZcodePlanSystemPrompt(body);
    expect(body.system).toHaveLength(2);
  });

  it("matches the identity prompt that passes the live gateway: leading blank line, security notice, # Harness", () => {
    expect(ZCODE_IDENTITY_PROMPT.startsWith("\nYou are an interactive ZCode agent")).toBe(true);
    expect(ZCODE_IDENTITY_PROMPT).toContain("IMPORTANT: Assist with authorized security testing");
    expect(ZCODE_IDENTITY_PROMPT).toContain("# Harness");
    expect(ZCODE_IDENTITY_PROMPT.endsWith("Reference code as `file_path:line_number` \u2014 it's clickable.")).toBe(true);
    // No cache marker text, no trailing whitespace drift — the gateway compares verbatim.
    expect(ZCODE_IDENTITY_PROMPT.trim()).toBe(ZCODE_IDENTITY_PROMPT.slice(1));
  });
});

describe("DefaultExecutor.transformRequest — zcode cloak wiring", () => {
  const executor = new DefaultExecutor("zcode");

  it("applies the cloak when the connection carries a zcode JWT", () => {
    const body = {
      model: "GLM-5.3-Flash",
      system: [{ type: "text", text: CLAUDE_CODE_SYSTEM }],
      messages: [],
    };
    executor.transformRequest("GLM-5.3-Flash", body, true, {
      providerSpecificData: { zcodeJwtToken: "jwt", planKind: "start-plan" },
    });
    expect(body.system[0].text).toBe(ZCODE_CLI_PREFIX);
  });

  it("does not touch requests without a zcode JWT (coding-plan API key surface)", () => {
    const body = {
      model: "GLM-5.3",
      system: [{ type: "text", text: CLAUDE_CODE_SYSTEM }],
      messages: [],
    };
    executor.transformRequest("GLM-5.3", body, true, { providerSpecificData: {} });
    expect(body.system).toHaveLength(1);
    expect(body.system[0].text).toBe(CLAUDE_CODE_SYSTEM);
  });
});

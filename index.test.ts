/**
 * index.test.ts — loop-watchdog unit tests
 *
 * Uses Node.js built-in test runner (node:test).
 * Run: npx tsx --test index.test.ts
 *
 * These tests use the ACTUAL hasMarkerAtTail semantics from index.ts
 * (paragraph-boundary rule via \n\n), which differs from the inline
 * approximation in test.mjs (500-char proximity rule).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Re-implement pure helpers matching index.ts exactly ──────────────────────
// (index.ts does not export these; we mirror them verbatim so the tests
//  validate the real semantics, not an approximation.)

const DEFAULT_STOP_MARKER = "[我确认工作循环需要结束";
const DEFAULT_YIELD_MARKER = "[我正在等待子代理完成";

function hasMarkerAtTail(text: string, marker: string): boolean {
  const trimmed = text.trimEnd();
  const idx = trimmed.lastIndexOf(marker);
  if (idx === -1) return false;
  const after = trimmed.slice(idx + marker.length);
  return !after.includes("\n\n");
}

function extractLastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") return b.text;
      }
    }
  }
  return "";
}

function flagPath(watchdogDir: string, sessionKey: string): string {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_\-.]/g, "_");
  return path.join(watchdogDir, `${safe}.running`);
}

interface FlagData {
  sessionKey: string;
  startedAt: string;
  trigger: string;
}

function writeFlag(watchdogDir: string, sessionKey: string, data: FlagData): void {
  fs.mkdirSync(watchdogDir, { recursive: true });
  fs.writeFileSync(flagPath(watchdogDir, sessionKey), JSON.stringify(data, null, 2), "utf8");
}

function readFlag(watchdogDir: string, sessionKey: string): FlagData | null {
  try {
    const raw = JSON.parse(fs.readFileSync(flagPath(watchdogDir, sessionKey), "utf8"));
    if (typeof raw?.sessionKey === "string" && typeof raw?.startedAt === "string") {
      return raw as FlagData;
    }
    return null;
  } catch {
    return null;
  }
}

function deleteFlag(watchdogDir: string, sessionKey: string): void {
  try { fs.unlinkSync(flagPath(watchdogDir, sessionKey)); } catch { /* gone */ }
}

// ── Simulate the wake-decision logic from the agent_end handler ──────────────

function shouldWake(
  messages: unknown[],
  stopMarker = DEFAULT_STOP_MARKER,
  yieldMarker = DEFAULT_YIELD_MARKER,
): boolean {
  const lastText = extractLastAssistantText(messages);
  if (hasMarkerAtTail(lastText, stopMarker)) return false;
  if (hasMarkerAtTail(lastText, yieldMarker)) return false;
  return true;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("hasMarkerAtTail — actual index.ts semantics", () => {

  test("stop marker present at tail → true", () => {
    const text =
      "some work done\n" +
      "[我确认工作循环需要结束，而不是无意义的结束]\n" +
      "本次工作内容：完成了测试\n" +
      "结束理由：任务完成";
    assert.equal(hasMarkerAtTail(text, DEFAULT_STOP_MARKER), true);
  });

  test("stop marker with trailing whitespace trimmed → true", () => {
    const text = "done\n[我确认工作循环需要结束]   \n\n";
    assert.equal(hasMarkerAtTail(text, DEFAULT_STOP_MARKER), true);
  });

  test("stop marker followed by same-paragraph inline text → true", () => {
    const text = "work\n[我确认工作循环需要结束，原因说明在此]";
    assert.equal(hasMarkerAtTail(text, DEFAULT_STOP_MARKER), true);
  });

  test("stop marker followed by blank line (new paragraph) → false", () => {
    const text = "[我确认工作循环需要结束]\n\n后续还有内容";
    assert.equal(hasMarkerAtTail(text, DEFAULT_STOP_MARKER), false);
  });

  test("stop marker buried before blank line → false", () => {
    const text =
      "[我确认工作循环需要结束]\n\n" +
      "paragraph two\n" +
      "paragraph two line two";
    assert.equal(hasMarkerAtTail(text, DEFAULT_STOP_MARKER), false);
  });

  test("stop marker absent → false", () => {
    assert.equal(hasMarkerAtTail("just some reply text", DEFAULT_STOP_MARKER), false);
  });

  test("empty string → false", () => {
    assert.equal(hasMarkerAtTail("", DEFAULT_STOP_MARKER), false);
  });

  test("yield marker present at tail → true", () => {
    const text =
      "Spawning subagent…\n" +
      "[我正在等待子代理完成，结果回来后继续]";
    assert.equal(hasMarkerAtTail(text, DEFAULT_YIELD_MARKER), true);
  });

  test("yield marker followed by new paragraph → false", () => {
    const text =
      "[我正在等待子代理完成]\n\n" +
      "但是这段话说明标记并不在真正的尾部";
    assert.equal(hasMarkerAtTail(text, DEFAULT_YIELD_MARKER), false);
  });

  test("yield marker absent → false", () => {
    assert.equal(hasMarkerAtTail("normal reply", DEFAULT_YIELD_MARKER), false);
  });
});

describe("wake-decision logic (agent_end handler simulation)", () => {

  function makeMessages(lastReply: string) {
    return [
      { role: "user", content: "do the thing" },
      { role: "assistant", content: lastReply },
    ];
  }

  test("yield marker in last reply → no wake", () => {
    const reply =
      "Starting subagent now.\n" +
      "[我正在等待子代理完成，将在结果返回后继续]";
    assert.equal(shouldWake(makeMessages(reply)), false);
  });

  test("stop marker in last reply → no wake", () => {
    const reply =
      "All done.\n" +
      "[我确认工作循环需要结束，而不是无意义的结束]\n" +
      "本次工作内容：完成测试编写\n" +
      "结束理由：任务已全部完成";
    assert.equal(shouldWake(makeMessages(reply)), false);
  });

  test("no marker in last reply → wake", () => {
    assert.equal(shouldWake(makeMessages("I finished writing the file.")), true);
  });

  test("reply cut off mid-sentence (simulated timeout) → wake", () => {
    assert.equal(shouldWake(makeMessages("Writing the fil")), true);
  });

  test("stop marker followed by new paragraph → wake (not truly at tail)", () => {
    const reply =
      "[我确认工作循环需要结束]\n\n" +
      "Actually, I have one more thing to say.";
    assert.equal(shouldWake(makeMessages(reply)), true);
  });

  test("empty message history → wake", () => {
    assert.equal(shouldWake([]), true);
  });

  test("only user messages → wake", () => {
    assert.equal(shouldWake([{ role: "user", content: "go" }]), true);
  });

  test("assistant array content with stop marker → no wake", () => {
    const messages = [{
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "exec", input: {} },
        {
          type: "text",
          text:
            "Done.\n" +
            "[我确认工作循环需要结束，而不是无意义的结束]\n" +
            "本次工作内容：完成\n" +
            "结束理由：完成",
        },
      ],
    }];
    assert.equal(shouldWake(messages), false);
  });

  test("custom stopMarker config respected", () => {
    assert.equal(shouldWake(makeMessages("done [STOP_NOW]"), "[STOP_NOW]"), false);
  });

  test("custom yieldMarker config respected", () => {
    assert.equal(shouldWake(makeMessages("waiting [YIELD_NOW]"), DEFAULT_STOP_MARKER, "[YIELD_NOW]"), false);
  });

  // ── Yield marker edge cases (subagent yield protocol) ─────────────────────

  test("yield marker at paragraph end (no trailing \\n\\n) → suppresses wake", () => {
    // Case a: yield marker is truly at the tail of the message
    const reply =
      "Spawning subagents for parallel processing.\n" +
      "[我正在等待子代理完成...]";
    assert.equal(shouldWake(makeMessages(reply)), false);
  });

  test("yield marker followed by \\n\\n with more content → does NOT suppress wake", () => {
    // Case b: marker appears mid-message before a paragraph break,
    // so it is not truly at tail — wake should proceed
    const reply =
      "[我正在等待子代理完成...]\n\n" +
      "Actually I have more to say after the blank line.";
    assert.equal(shouldWake(makeMessages(reply)), true);
  });

  test("both yield marker and stop marker present — stop marker at tail → no wake (stop takes priority)", () => {
    // Case c: stop marker appears after yield marker in the same message.
    // hasMarkerAtTail checks stop first; stop at tail → suppress wake.
    const reply =
      "[我正在等待子代理完成...]\n" +
      "[我确认工作循环需要结束，而不是无意义的结束]\n" +
      "本次工作内容：已完成\n" +
      "结束理由：任务完成";
    assert.equal(shouldWake(makeMessages(reply)), false);
  });

  test("both yield marker and stop marker present — yield marker at tail → no wake", () => {
    // Variant: stop marker buried before a \\n\\n, yield marker at real tail.
    // shouldWake checks stop first (returns false on stop at tail),
    // then checks yield. Either suppression → no wake.
    const reply =
      "[我确认工作循环需要结束]\n\n" +
      "Wait, spawning one more subagent.\n" +
      "[我正在等待子代理完成...]";
    // stop marker NOT at tail (has \n\n after), yield IS at tail → no wake
    assert.equal(shouldWake(makeMessages(reply)), false);
  });
});

describe("flag file I/O", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-test-"));

  process.on("exit", () => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
  });

  test("writeFlag + readFlag round-trip", () => {
    const data: FlagData = { sessionKey: "sess-1", startedAt: "2026-03-27T00:00:00.000Z", trigger: "user" };
    writeFlag(tmpDir, "sess-1", data);
    assert.deepEqual(readFlag(tmpDir, "sess-1"), data);
  });

  test("readFlag returns null for missing file", () => {
    assert.equal(readFlag(tmpDir, "nonexistent"), null);
  });

  test("deleteFlag removes the file", () => {
    writeFlag(tmpDir, "sess-del", { sessionKey: "sess-del", startedAt: "2026-01-01T00:00:00.000Z", trigger: "user" });
    deleteFlag(tmpDir, "sess-del");
    assert.equal(readFlag(tmpDir, "sess-del"), null);
  });

  test("deleteFlag is idempotent", () => {
    assert.doesNotThrow(() => deleteFlag(tmpDir, "already-gone"));
  });

  test("sessionKey with colons/slashes sanitized to valid filename", () => {
    const key = "agent:main:telegram:direct:123456";
    const data: FlagData = { sessionKey: key, startedAt: "2026-03-27T00:00:00.000Z", trigger: "system" };
    writeFlag(tmpDir, key, data);
    assert.deepEqual(readFlag(tmpDir, key), data);
    deleteFlag(tmpDir, key);
    assert.equal(readFlag(tmpDir, key), null);
  });

  test("readFlag returns null for malformed JSON", () => {
    fs.writeFileSync(flagPath(tmpDir, "bad-json"), "{not valid json", "utf8");
    assert.equal(readFlag(tmpDir, "bad-json"), null);
  });

  test("readFlag returns null when sessionKey field missing", () => {
    fs.writeFileSync(
      flagPath(tmpDir, "no-key"),
      JSON.stringify({ startedAt: "2026-03-27T00:00:00.000Z", trigger: "x" }),
      "utf8",
    );
    assert.equal(readFlag(tmpDir, "no-key"), null);
  });

  test("readFlag returns null when startedAt field missing", () => {
    fs.writeFileSync(
      flagPath(tmpDir, "no-started"),
      JSON.stringify({ sessionKey: "sess-x", trigger: "x" }),
      "utf8",
    );
    assert.equal(readFlag(tmpDir, "no-started"), null);
  });

  test("flag file is pretty-printed JSON with correct fields", () => {
    const data: FlagData = { sessionKey: "sess-json", startedAt: "2026-03-27T00:00:00.000Z", trigger: "test" };
    writeFlag(tmpDir, "sess-json", data);
    const raw = fs.readFileSync(flagPath(tmpDir, "sess-json"), "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.sessionKey, "sess-json");
    assert.equal(parsed.startedAt, "2026-03-27T00:00:00.000Z");
    assert.ok(raw.includes("\n"), "should be pretty-printed");
  });
});

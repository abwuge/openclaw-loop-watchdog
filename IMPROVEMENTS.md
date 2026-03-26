# Loop Watchdog — Improvement Analysis

_Analyzed: 2026-03-27_

---

## Summary

The plugin is well-structured and covers the core use-case. However there are several correctness and robustness issues worth addressing, the most important being the lack of recognition for the "waiting for subagent" legitimate suspension state.

---

## Issue 1 (Critical): Subagent yield is not recognized as a legitimate suspension

### Problem

When the main agent spawns a subagent and calls `sessions_yield`, the host session ends its turn — `agent_end` fires. The watchdog sees no stop marker and immediately sends a wake message, which is wrong: the agent is legitimately suspended waiting for subagent results.

This creates a spurious interruption loop:
1. Agent spawns subagent, yields turn → `agent_end` fires
2. Watchdog sends wake message → agent is re-entered prematurely
3. Agent may clobber the pending subagent result or act out of order

### Root cause

`agent_end` has no way to distinguish between:
- Agent finished turn normally (good)
- Agent intentionally yielded to wait for subagent (should be exempt)
- Agent crashed/timed out (should wake)

### Solutions (in order of preference)

#### Option A: SDK-level yield flag (best, requires runtime support)

If `agent_end` event context exposes a `yieldedToSubagent: boolean` or similar field, check it:

```typescript
api.on("agent_end", async (event, ctx) => {
  if (ctx.yieldedToSubagent) {
    // Legitimate suspension — do not wake, but also do NOT delete the flag
    // (flag should persist so gateway_start can still recover if gateway crashes mid-yield)
    return;
  }
  // ... existing logic
});
```

#### Option B: Detect yield marker in last assistant message

Instead of (or in addition to) the stop marker, define a **yield marker** the agent writes when it intentionally yields:

```
[我正在等待子代理完成，将在结果返回后继续]
```

The watchdog checks for this marker and skips the wake:

```typescript
const YIELD_MARKER = "[我正在等待子代理完成";

if (hasMarkerAtTail(lastText, YIELD_MARKER)) {
  // Legitimate yield — leave the flag, don't wake
  return;
}
```

This requires the agent's AGENTS.md to instruct it to write the yield marker before `sessions_yield`. The marker itself is already informally encouraged by OpenClaw's subagent docs.

#### Option C: Scan for pending subagent sessions

At `agent_end` time, query whether the session has active child subagents. If yes, skip waking.

```typescript
const pendingSubagents = await api.runtime.subagent.listPending(sessionKey);
if (pendingSubagents.length > 0) return;
```

Depends on whether the runtime exposes such an API.

#### Option D: Short grace-period delay before waking (weak mitigation)

Delay the wake by e.g. 30s. If a subagent result arrives in that window and re-enters the agent, the flag gets overwritten and the delayed wake can be discarded. This is fragile and not recommended as a primary solution, but could act as a safety net.

### Recommended approach

Implement **Option B** (yield marker detection) as it requires no runtime changes. Pair it with the AGENTS.md instruction to write the marker before `sessions_yield`. If the SDK later exposes Option A, migrate to that.

---

## Issue 2 (Bug): `gateway_start` sessionKey restoration is incorrect

### Problem

The flag filename is created by sanitizing the sessionKey: replacing all chars outside `[a-zA-Z0-9_\-.]` with `_`. On `gateway_start`, the code attempts to reverse this by replacing all `_` with `:`:

```typescript
const sessionKey = file.replace(/\.running$/, "").replace(/_/g, ":");
```

This is wrong in two ways:
1. If the original sessionKey contained literal underscores, they become `:` — corrupted key.
2. The sanitizer replaces *any* non-alphanumeric char with `_`, not just `:`. So `agent:main:telegram:direct:123` and `agent_main_telegram_direct_123` would produce identical filenames.

The reverse mapping is ambiguous and lossy.

### Solution

Store the original `sessionKey` inside the flag file (already done — `sessionKey` field is written). Read it back on `gateway_start` instead of trying to reconstruct from the filename:

```typescript
for (const file of files) {
  const filePath = path.join(watchdogDir, file);
  let flagData: Record<string, unknown>;
  try {
    flagData = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    api.logger.warn(`[loop-watchdog] gateway_start: could not parse flag ${file}, skipping`);
    continue;
  }
  const sessionKey = typeof flagData.sessionKey === "string" ? flagData.sessionKey : null;
  if (!sessionKey) {
    api.logger.warn(`[loop-watchdog] gateway_start: no sessionKey in ${file}, skipping`);
    continue;
  }
  // ... use sessionKey
}
```

**This is a clear correctness bug with an obvious fix.** Applied directly to `index.ts` (see Changes section below).

---

## Issue 3 (Minor): `before_agent_start` skips non-user triggers — may skip watchdog-injected wakes

### Problem

```typescript
if (ctx.trigger && ctx.trigger !== "user") return;
```

This prevents flag planting for non-user triggers. The intent is to avoid planting flags for internal/system triggers. However, the watchdog's own wake messages are sent via `api.runtime.subagent.run()`. If that results in a `before_agent_start` with trigger `"subagent"` or `"system"`, no flag is planted for the resumed session, meaning if the resumed session also ends without a stop marker, it won't be caught.

### Solution

Also plant the flag when trigger is `"watchdog"` (if the runtime supports custom trigger labels), or remove the trigger guard and instead guard on whether the session is a top-level session (not a true subagent session). Alternatively, always plant the flag regardless of trigger — the flag is cheap and the worst case is an extra wake message for a session that finishes cleanly.

For now, at minimum document this behavior in the README.

---

## Issue 4 (Minor): `gateway_start` idempotency key uses `Date.now()`

### Problem

```typescript
idempotencyKey: `loop-watchdog-restart-${sessionKey}-${Date.now()}`,
```

Using wall-clock time means rapid gateway restarts (within the same millisecond, or in a tight crash loop) could send multiple wake messages to the same session. The idempotency key should be stable across a single restart cycle.

### Solution

Use the flag file's `startedAt` timestamp (already stored) as part of the key, making it stable per "run" of the agent:

```typescript
const startedAt = typeof flagData.startedAt === "string" ? flagData.startedAt : "unknown";
idempotencyKey: `loop-watchdog-restart-${sessionKey}-${startedAt}`,
```

This is fixed as part of the gateway_start rewrite in Issue 2.

---

## Issue 5 (Minor): `hasStopMarkerAtTail` logic is slightly fragile

### Problem

The current check:
```typescript
const after = trimmed.slice(idx + marker.length);
return !after.includes("\n\n");
```

This means: the marker is valid if there's no blank line after it. But if the agent writes a single newline after the marker text (e.g., trailing `\n`), it passes. If it writes extra content with a blank line, it fails. The intent is good, but the condition is subtle. A `\n\n` check for "new paragraph" is reasonable, but worth a comment.

### Solution

Add an inline comment explaining the logic. No code change needed, just documentation.

---

## Issue 6 (Minor): `readFlag` return type loses type safety

### Problem

```typescript
function readFlag(...): object | null
```

Returns `object | null` which requires casting at every call site. Since we know the shape of the flag, define an interface:

```typescript
interface FlagData {
  sessionKey: string;
  startedAt: string;
  trigger: string;
  yieldedAt?: string;   // future: written when agent yields
}
```

This makes downstream code safer and self-documenting.

---

## Issue 7 (Observation): Stored `trigger` field is never used

The flag stores `trigger: ctx.trigger ?? "unknown"` but no code reads it. This is fine as future-proofing (e.g., could be used to skip waking for certain trigger types), but worth noting.

---

## Changes Applied to `index.ts`

The following concrete fixes were applied directly:

1. **`gateway_start` sessionKey fix (Issue 2):** Read `sessionKey` from the flag file JSON instead of reverse-engineering from the filename. Also reads `startedAt` for a stable idempotency key (Issue 4).

2. **`FlagData` interface (Issue 6):** Added a typed interface for flag file contents. Updated `readFlag`, `writeFlag`, and call sites accordingly.

3. **Yield marker detection (Issue 1, Option B):** Added `YIELD_MARKER` constant and detection in `agent_end`. When the agent's last message contains the yield marker at its tail, the watchdog skips the wake (but leaves the flag, so `gateway_start` can still recover after a crash during yield).

4. **Comment on `hasStopMarkerAtTail` (Issue 5):** Added explanatory inline comment.

5. **Issue 3 fix (2026-03-27):** Changed trigger guard in `before_agent_start` from `ctx.trigger !== "user"` to `ctx.trigger === "subagent"`. This ensures watchdog-injected wake messages (trigger: system/undefined) also plant a flag, so re-entered sessions are properly tracked.

---

## Yield Marker — Required AGENTS.md Addition

For Issue 1 Option B to work, add this rule to `AGENTS.md` (and the plugin README):

```markdown
## Yield / Subagent Suspension

When you spawn a subagent and call `sessions_yield`, your last message MUST end with:

[我正在等待子代理完成，将在结果返回后继续]
子代理标签：<label or description>

This tells the loop-watchdog that the suspension is intentional.
Do NOT use this marker for anything other than subagent yield.
```

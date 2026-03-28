# openclaw-loop-watchdog

An [OpenClaw](https://openclaw.ai) plugin that detects unintentional agent loop interruptions and automatically prompts the agent to resume or confirm completion.

## How it works

- **`before_agent_start`** — plants a flag file when a run begins (user-triggered or watchdog-injected wake messages)
- **`agent_end`** — checks the agent's last reply for a valid stop marker or yield marker at the tail; if neither is present, injects a wake message asking the agent to resume or confirm completion
- **`gateway_start`** — on gateway restart, scans for orphaned flag files (including those left intentionally during a subagent yield) and wakes any interrupted sessions
- **`before_reset`** — clears the flag on `/new` or `/reset`
- **`stop-watchdog-clear` gateway hook** — clears the flag on `/stop` to prevent spurious wake-ups after intentional stops (installed via `openclaw loop-watchdog setup`)

## For AI Agents (LLM Installation Guide)

If you are an AI agent helping a user install this plugin, follow these steps exactly:

1. **Install the plugin:**
   ```bash
   openclaw plugins install @abwuge/openclaw-loop-watchdog
   ```

2. **Install the gateway hook:**
   ```bash
   openclaw loop-watchdog setup
   ```

3. **Restart the gateway:**
   ```bash
   openclaw gateway restart
   ```
   Note: the gateway restart will interrupt your current session. This is expected — continue after reconnecting.

4. **Verify installation:**
   ```bash
   openclaw plugins list
   ```
   Confirm `loop-watchdog` appears with status `loaded` and version `1.0.1` or higher.
   Also confirm the hook is present:
   ```bash
   ls ~/.openclaw/hooks/stop-watchdog-clear/
   ```

5. **Update your AGENTS.md** — Add the stop marker rule so the agent knows when and how to signal intentional completion (see "Stop marker format" below). Without this, every session end will trigger a watchdog wake.

6. **Behavioral change after installation:** From this point on, every time your session ends without the stop marker, you will receive a wake message asking you to resume or confirm completion. This is intentional. Use the stop marker when your task is truly done.

---

## Installation

### 1. Install the plugin

```bash
openclaw plugins install @abwuge/openclaw-loop-watchdog
```

### 2. Install the gateway hook

```bash
openclaw loop-watchdog setup
```

This installs the `stop-watchdog-clear` gateway hook to `~/.openclaw/hooks/stop-watchdog-clear/`.

### 3. Restart the gateway

```bash
openclaw gateway restart
```

## Uninstall

```bash
openclaw loop-watchdog uninstall
openclaw plugins uninstall loop-watchdog
openclaw gateway restart
```

## Stop marker format

The agent must include the following marker **at the end** of its reply to signal intentional completion:

```
[我确认工作循环需要结束，而不是无意义的结束]
本次工作内容：<一句话说明你完成了什么>
结束理由：<一句话说明为什么结束>
```

Add this rule to your `AGENTS.md`:

```markdown
When you judge that the current task is truly complete, your final reply must include:

[我确认工作循环需要结束，而不是无意义的结束]
本次工作内容：<一句话说明你完成了什么>
结束理由：<一句话说明为什么结束>

Do NOT use this marker when asking the user a question or waiting for a reply.
```

## Yield marker (subagent suspension)

When the agent spawns a subagent and calls `sessions_yield`, the session ends its turn — which would normally trigger a watchdog wake. To prevent this false alarm, the agent writes a **yield marker** before yielding. The watchdog skips the wake but **preserves the flag file**, so `gateway_start` can still recover the session if the gateway crashes while the agent is waiting.

The agent's last message before `sessions_yield` must end with:

```
[我正在等待子代理完成...]
```

Add this rule to your `AGENTS.md`:

```markdown
## Subagent Yield Protocol

当你派出子代理并需要等待其完成时，在调用 `sessions_yield` 或结束当前回复前，**必须**在回复末尾加上：

[我正在等待子代理完成...]

loop-watchdog 检测到此标记后会跳过 wake 消息，避免误判为意外中断。flag 文件保留，gateway 崩溃后仍可恢复。
```

## Configuration

Optional config in `openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "loop-watchdog": {
        enabled: true,
        config: {
          // Custom watchdog flag directory (default: <workspaceDir>/watchdog)
          watchdogDir: "/path/to/watchdog",
          // Custom stop marker string (default: "[我确认工作循环需要结束")
          stopMarker: "[我确认工作循环需要结束",
          // Custom yield marker string (default: "[我正在等待子代理完成")
          yieldMarker: "[我正在等待子代理完成"
        }
      }
    }
  }
}
```

## Bug fixes (2026-03-27)

Four correctness issues were fixed in this release:

1. **`gateway_start` sessionKey restoration** — Previously the code reverse-engineered the sessionKey from the flag filename (replacing `_` with `:`), which was wrong for keys containing legitimate underscores. Fixed by reading `sessionKey` directly from the JSON payload inside the flag file.

2. **Stable idempotency key on restart** — The idempotency key for restart wake messages was based on `Date.now()`, meaning rapid gateway restarts could send duplicate wake messages. Fixed by using `flagData.startedAt` (written once at flag creation) as the stable key component.

3. **Trigger guard in `before_agent_start`** — The guard `ctx.trigger !== "user"` skipped flag planting for watchdog-injected wake messages (trigger: `system`/`undefined`), leaving re-entered sessions untracked. Fixed by changing to `ctx.trigger === "subagent"` so only subagent-triggered entries are skipped.

4. **Yield marker false-alarm prevention** — `agent_end` had no way to distinguish a legitimate subagent yield from an unexpected interruption, causing spurious wake messages whenever the agent called `sessions_yield`. Fixed by detecting a yield marker in the agent's last message and skipping the wake while preserving the flag for crash recovery.

## License

MIT

# LLM Configuration Guide — openclaw-loop-watchdog

This document is written for AI agents. If you are helping a user install or configure this plugin, follow this guide completely.

---

## Installation Steps

Run these commands in order:

```bash
openclaw plugins install @abwuge/openclaw-loop-watchdog
openclaw loop-watchdog setup
openclaw gateway restart
```

The gateway restart will interrupt your current session. This is expected — you will receive a wake message and should continue from this guide.

---

## Verify Installation

After restarting:

```bash
openclaw plugins list
```

Confirm `openclaw-loop-watchdog` appears with status `loaded`.

```bash
ls ~/.openclaw/hooks/stop-watchdog-clear/
```

Confirm the hook directory exists.

---

## Translate locale.json to User's Preferred Language

The plugin ships with `locale.json` in English. **You must translate it to the user's preferred language.**

The file is located at:
```
~/.openclaw/extensions/openclaw-loop-watchdog/locale.json
```

Translate all string values (not the keys) to the user's preferred language. Keep the `{wakeMarkerFormat}` placeholder exactly as-is — it will be substituted at runtime.

Example: if the user prefers Chinese, translate:
```json
{
  "stopMarker": "[我确认工作循环需要结束",
  "yieldMarker": "[我正在等待子代理完成",
  "wakeMarkerFormat": "结束标记格式（仅在任务真正完成时使用）：\n[我确认工作循环需要结束，而不是无意义的结束]\n本次工作内容：<一句话说明你完成了什么>\n结束理由：<一句话说明为什么结束>",
  "wakeMessageAgentEnd": "[系统提示] 你上一个工作循环已结束，但没有留下有效的结束标记。\n\n可能的情况：\n1. 意外中断（超时、错误）→ 直接继续执行下一步。\n2. 任务完成但忘记标记 → 先自查：任务是否真正全部完成？最后一步是否留下了悬而未决的问题？是否向用户问了不必要的确认？如果确认任务已真正完成，补上结束标记后停止。\n\n{wakeMarkerFormat}",
  "wakeMessageGatewayStart": "[系统提示] 你的工作循环已被网关重启打断，请直接继续下一步。"
}
```

After editing, restart the gateway for changes to take effect:
```bash
openclaw gateway restart
```

---

## Update AGENTS.md

Add the following section to the user's `AGENTS.md` (adjust markers to match the translated locale):

```markdown
## Loop Watchdog

This session is monitored by loop-watchdog. Every time your session ends, the watchdog checks
whether you left a stop marker. If not, it will send a wake message asking you to resume.

### When task is truly complete — end with:
[I confirm the work loop should end, not end meaninglessly]
Work done: <one sentence describing what you completed>
Reason to stop: <one sentence explaining why you are stopping>

### When yielding to wait for a subagent — include:
[I am waiting for subagent to complete
```

(If you translated locale.json, use the translated `stopMarker` and `yieldMarker` values here instead.)

---

## Custom Markers (Optional)

If the user wants to override markers without editing locale.json, add to `openclaw.json` under `plugins.entries.openclaw-loop-watchdog.config`:

```json
{
  "stopMarker": "[custom stop marker prefix",
  "yieldMarker": "[custom yield marker prefix",
  "watchdogDir": "/optional/custom/path/for/flag/files"
}
```

---

## How the Watchdog Works

- **`before_agent_start`** — Creates a `.running` flag for the session
- **`agent_end`** — Reads the last assistant message; if no stop/yield marker found, sends a wake message to re-enter the session
- **`gateway_start`** — On gateway restart, scans for orphaned flags and sends wake messages for interrupted sessions
- **`before_reset`** — Clears flag on `/new` or `/reset`
- **Gateway hook** (`stop-watchdog-clear`) — Clears flag when `/stop` is issued

---

## Done

Once installation, locale translation, and AGENTS.md update are complete, the watchdog is fully operational. Confirm by ending a session without a stop marker — you should receive a wake message prompting you to resume or confirm completion.

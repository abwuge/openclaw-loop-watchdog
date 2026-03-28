# openclaw-loop-watchdog

An [OpenClaw](https://openclaw.ai) plugin that detects unintentional agent loop interruptions and automatically wakes the agent to resume or confirm completion.

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
   Confirm `openclaw-loop-watchdog` appears with status `loaded`.
   Also confirm the hook is present:
   ```bash
   ls ~/.openclaw/hooks/stop-watchdog-clear/
   ```

5. **Update your AGENTS.md** — Add the stop marker rule so the agent knows when and how to signal intentional completion (see "Stop marker format" below). Without this, every session end will trigger a watchdog wake.

6. **Configure language (optional):**
   In `openclaw.json`, under `plugins.entries.openclaw-loop-watchdog.config`, set:
   ```json
   { "lang": "zh" }
   ```
   Built-in languages: `en` (default), `zh`. Custom locales can be added to the plugin's `locales/` directory.

7. **Behavioral change after installation:** From this point on, every time your session ends without the stop marker, you will receive a wake message asking you to resume or confirm completion. This is intentional. Use the stop marker when your task is truly done.

---

## How It Works

The plugin maintains a `.running` flag file for each active agent session:

- **`before_agent_start`** — Creates the flag when a session starts
- **`agent_end`** — Checks the last assistant message for a stop or yield marker; if absent, sends a wake message to resume the session
- **`gateway_start`** — On gateway restart, scans for orphaned flags (sessions interrupted by crash/restart) and sends wake messages
- **`before_reset`** — Clears the flag on `/new` or `/reset`
- **Gateway hook** (`stop-watchdog-clear`) — Clears the flag when `/stop` is issued

## Stop Marker Format

The agent must include this marker at the end of its final message when a task is truly complete:

```
[I confirm the work loop should end, not end meaninglessly]
Work done: <one sentence describing what you completed>
Reason to stop: <one sentence explaining why you are stopping>
```

(For Chinese locale, the marker starts with `[我确认工作循环需要结束`)

## Yield Marker

When the agent intentionally yields to wait for a subagent, it should include:

```
[I am waiting for subagent to complete
```

The watchdog will not send a wake message when this marker is detected.

## Installation

### 1. Install the plugin

```bash
openclaw plugins install @abwuge/openclaw-loop-watchdog
```

### 2. Install the gateway hook

```bash
openclaw loop-watchdog setup
```

### 3. Restart the gateway

```bash
openclaw gateway restart
```

### 4. Update AGENTS.md

Add the following to your `AGENTS.md`:

```markdown
## Loop Watchdog

When your task is truly complete, end your final message with:

[I confirm the work loop should end, not end meaninglessly]
Work done: <one sentence>
Reason to stop: <one sentence>

When yielding to wait for a subagent result, include:
[I am waiting for subagent to complete
```

## Configuration

Add to `openclaw.json` under `plugins.entries.openclaw-loop-watchdog.config`:

```json
{
  "lang": "en",
  "watchdogDir": "/custom/path/to/watchdog",
  "stopMarker": "[custom stop marker",
  "yieldMarker": "[custom yield marker"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `lang` | `"en"` | Locale for messages. Built-in: `en`, `zh` |
| `watchdogDir` | `<workspace>/watchdog` | Directory for flag files |
| `stopMarker` | (from locale) | Custom stop marker prefix |
| `yieldMarker` | (from locale) | Custom yield marker prefix |

## Changelog

### 1.1.0
- Added i18n support with locale files (`locales/en.json`, `locales/zh.json`)
- Default language changed to English
- Fixed plugin id to `openclaw-loop-watchdog`
- Updated GitHub Actions to Node.js 24 compatible versions
- Added detailed LLM installation guide

### 1.0.2
- Added LLM installation guide to README
- Improved plugin description

### 1.0.1
- Fixed CI trusted publishing (npm OIDC)
- Upgraded npm in CI for trusted publishing support

### 1.0.0
- Initial release

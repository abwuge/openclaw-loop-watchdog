# openclaw-loop-watchdog

An [OpenClaw](https://openclaw.ai) plugin that detects unintentional agent loop interruptions and automatically wakes the agent to resume or confirm completion.

## How It Works

The plugin maintains a `.running` flag for each active agent session. When a session ends without a stop marker, the watchdog re-enters the session with a wake message. This prevents silent loop deaths where the agent simply stops responding without finishing its task.

- **`before_agent_start`** — Plants a flag when the session starts
- **`agent_end`** — Checks for a stop/yield marker; if absent, sends a wake message
- **`gateway_start`** — Recovers orphaned sessions after a gateway restart
- **`before_reset`** / **gateway hook** — Clears the flag on `/reset` or `/stop`

## Quick Install

```bash
openclaw plugins install @abwuge/openclaw-loop-watchdog
openclaw loop-watchdog setup
openclaw gateway restart
```

Then update your `AGENTS.md` so the agent knows when to use the stop marker (see [LLM.md](./LLM.md)).

## Localization

All wake messages and markers are defined in a single file:

```
~/.openclaw/extensions/openclaw-loop-watchdog/locale.json
```

Edit this file to change the language or wording. The default is English. You can ask your AI assistant to translate it to your preferred language — see [LLM.md](./LLM.md) for instructions.

## Configuration

Optional overrides in `openclaw.json` under `plugins.entries.openclaw-loop-watchdog.config`:

| Option | Default | Description |
|--------|---------|-------------|
| `stopMarker` | (from locale.json) | Custom stop marker prefix |
| `yieldMarker` | (from locale.json) | Custom yield marker prefix |
| `watchdogDir` | `<workspace>/watchdog` | Directory for flag files |

## For AI Agents

See **[LLM.md](./LLM.md)** for the complete installation and configuration guide written for AI agents, including locale translation instructions.

## Changelog

### 1.2.0
- Replaced multi-locale system with single `locale.json` — translate via LLM to any language
- Added `LLM.md` — dedicated AI agent configuration guide
- Removed `README_CN.md`
- Removed `lang` config option

### 1.1.0
- Added i18n support with locale files
- Fixed plugin id to `openclaw-loop-watchdog`
- Updated GitHub Actions to Node.js 24 compatible versions

### 1.0.2
- Added LLM installation guide to README

### 1.0.1
- Fixed CI trusted publishing

### 1.0.0
- Initial release

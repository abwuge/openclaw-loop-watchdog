# openclaw-loop-watchdog

An [OpenClaw](https://openclaw.ai) plugin that detects unintentional agent loop interruptions and automatically prompts the agent to resume or confirm completion.

## How it works

- **`before_agent_start`** — plants a flag file when a user-triggered run begins
- **`agent_end`** — checks if the agent's last reply contains a valid stop marker at the tail; if not, injects a wake message asking the agent to resume or confirm completion
- **`gateway_start`** — on gateway restart, scans for orphaned flag files and wakes any interrupted sessions
- **`before_reset`** — clears the flag on `/new` or `/reset`
- **`stop-watchdog-clear` gateway hook** — clears the flag on `/stop` to prevent spurious wake-ups after intentional stops (installed via `openclaw loop-watchdog setup`)

## Installation

### 1. Install the plugin

```bash
openclaw plugins install loop-watchdog
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
          stopMarker: "[我确认工作循环需要结束"
        }
      }
    }
  }
}
```

## License

MIT

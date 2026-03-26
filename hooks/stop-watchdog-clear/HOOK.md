---
name: stop-watchdog-clear
description: "Clear loop-watchdog flag file when /stop is issued, preventing spurious wake after intentional stop"
metadata:
  {
    "openclaw":
      {
        "emoji": "🛑",
        "events": ["command:stop"],
      },
  }
---

# stop-watchdog-clear

When `/stop` is issued, delete the watchdog flag file for the current session
so the loop-watchdog plugin does not inject a spurious wake message after an
intentional user-initiated stop.

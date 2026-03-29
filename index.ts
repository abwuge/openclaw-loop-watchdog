import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Locale support ───────────────────────────────────────────────────────────

interface Locale {
  stopMarker: string;
  yieldMarker: string;
  wakeMarkerFormat: string;
  wakeMessageAgentEnd: string;
  wakeMessageGatewayStart: string;
}

function loadLocale(pluginDir: string): Locale {
  const localePath = path.join(pluginDir, "locale.json");
  try {
    const raw = JSON.parse(fs.readFileSync(localePath, "utf8"));
    return raw as Locale;
  } catch {
    // Hardcoded fallback if locale.json is missing
    return {
      stopMarker: "[I confirm the work loop should end",
      yieldMarker: "[I am waiting for subagent to complete",
      wakeMarkerFormat:
        "Stop marker format (only use when the task is truly complete):\n" +
        "[I confirm the work loop should end, not end meaninglessly]\n" +
        "Work done: <one sentence describing what you completed>\n" +
        "Reason to stop: <one sentence explaining why you are stopping>",
      wakeMessageAgentEnd:
        "[System] Your last work loop ended without a valid stop marker.\n\n" +
        "Possible situations:\n" +
        "1. Unexpected interruption (timeout, error) → Continue directly with the next step.\n" +
        "2. Task completed but forgot the marker → Self-check: Is the task truly and fully complete? " +
        "Did you leave any unresolved questions? Did you ask any unnecessary confirmations? " +
        "If the task is truly done, add the stop marker and stop.\n\n" +
        "{wakeMarkerFormat}",
      wakeMessageGatewayStart:
        "[System] Your work loop was interrupted by a gateway restart. Please continue with the next step directly.",
    };
  }
}

function buildWakeMessageAgentEnd(locale: Locale): string {
  return locale.wakeMessageAgentEnd.replace("{wakeMarkerFormat}", locale.wakeMarkerFormat);
}

const DEFAULT_STOP_MARKER = "[I confirm the work loop should end";
const DEFAULT_YIELD_MARKER = "[I am waiting for subagent to complete";

// ── Flag data shape ──────────────────────────────────────────────────────────

interface FlagData {
  sessionKey: string;
  startedAt: string;
  trigger: string;
}

// ── Path helpers ────────────────────────────────────────────────────────────

function getWatchdogDir(workspaceDir?: string, customDir?: string): string {
  if (customDir) return customDir;
  if (workspaceDir) return path.join(workspaceDir, "watchdog");
  return path.join(os.homedir(), ".openclaw", "workspace", "watchdog");
}

function flagPath(watchdogDir: string, sessionKey: string): string {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_\-.]/g, "_");
  return path.join(watchdogDir, `${safe}.running`);
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

function extractLastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      // Concatenate ALL text blocks (marker may be in a later block)
      const parts: string[] = [];
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text as string);
      }
      if (parts.length > 0) return parts.join("");
    }
  }
  return "";
}

function hasMarkerAtTail(text: string, marker: string): boolean {
  const trimmed = text.trimEnd();
  const idx = trimmed.lastIndexOf(marker);
  if (idx === -1) return false;
  // Allow trailing text on the same paragraph, but reject if a blank line
  // (i.e. a new paragraph) appears after the marker — marker must be at the tail.
  const after = trimmed.slice(idx + marker.length);
  return !after.includes("\n\n");
}

/** @deprecated Use hasMarkerAtTail */
const hasStopMarkerAtTail = hasMarkerAtTail;

// ── Wake message templates ───────────────────────────────────────────────────

// Wake messages are loaded from locale files at plugin init time.

// ── CLI setup/uninstall helpers ──────────────────────────────────────────────

const HOOK_ID = "stop-watchdog-clear";

function getHooksDir(): string {
  return path.join(os.homedir(), ".openclaw", "hooks");
}

function getHookDir(): string {
  return path.join(getHooksDir(), HOOK_ID);
}

const HOOK_HANDLER_JS = `const fs = require('node:fs');
const path = require('node:path');

const handler = (event) => {
  if (event.type !== 'command' || event.action !== 'stop') return;

  // sessionKey is a top-level field on InternalHookEvent (not in context)
  const sessionKey = event.sessionKey;
  // workspaceDir lives in event.context
  const workspaceDir = event.context?.workspaceDir;
  if (!sessionKey || !workspaceDir) return;

  const safe = sessionKey.replace(/[^a-zA-Z0-9_.\\-]/g, '_');
  const flagPath = path.join(workspaceDir, 'watchdog', safe + '.running');
  try { fs.unlinkSync(flagPath); } catch { /* already gone */ }
};

module.exports = handler;
`;

const HOOK_MD = `---
name: ${HOOK_ID}
description: "Clear loop-watchdog flag file when /stop is issued"
metadata:
  {
    "openclaw": { "emoji": "🛑", "events": ["command:stop"] },
  }
---

# ${HOOK_ID}

Clears the loop-watchdog flag file on /stop to prevent spurious wake messages.
`;

function installHook(hooksDir?: string): void {
  const dir = hooksDir ?? getHookDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "handler.js"), HOOK_HANDLER_JS, "utf8");
  fs.writeFileSync(path.join(dir, "HOOK.md"), HOOK_MD, "utf8");
}

function uninstallHook(hooksDir?: string): void {
  const dir = hooksDir ?? getHookDir();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── Plugin entry ─────────────────────────────────────────────────────────────

export default definePluginEntry({
  id: "openclaw-loop-watchdog",
  name: "Loop Watchdog",
  description: "Detects unintentional agent loop interruptions and prompts the agent to resume.",

  register(api) {
    const pluginCfg = (api.pluginConfig ?? {}) as Record<string, unknown>;

    // ── Locale loading ───────────────────────────────────────────────────────
    // locale.json in the plugin directory — translate it to your preferred language via LLM.md
    const pluginDir = path.dirname(new URL(import.meta.url).pathname);
    const locale = loadLocale(pluginDir);

    const stopMarker: string =
      typeof pluginCfg.stopMarker === "string" ? pluginCfg.stopMarker : locale.stopMarker;

    // ── CLI: loop-watchdog setup / uninstall ─────────────────────────────────
    api.registerCli(
      ({ program }) => {
        const cmd = program.command("loop-watchdog").description("Manage the loop-watchdog plugin");

        cmd
          .command("setup")
          .description("Install the stop-watchdog-clear gateway hook")
          .action(() => {
            try {
              installHook();
              console.log(`✓ Installed gateway hook to ${getHookDir()}`);
              console.log("  Run 'openclaw gateway restart' to activate.");
            } catch (err) {
              console.error(`✗ Failed to install hook: ${err}`);
              process.exit(1);
            }
          });

        cmd
          .command("uninstall")
          .description("Remove the stop-watchdog-clear gateway hook")
          .action(() => {
            try {
              uninstallHook();
              console.log(`✓ Removed gateway hook from ${getHookDir()}`);
              console.log("  Run 'openclaw gateway restart' to deactivate.");
            } catch (err) {
              console.error(`✗ Failed to remove hook: ${err}`);
              process.exit(1);
            }
          });
      },
      { commands: ["loop-watchdog"] },
    );

    // ── before_agent_start: plant the flag ──────────────────────────────────
    api.on("before_agent_start", async (_event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;
      // Skip true subagent sessions; allow user, system, and watchdog-injected wakes.
      if (ctx.trigger === "subagent") return;
      const watchdogDir = getWatchdogDir(ctx.workspaceDir, pluginCfg.watchdogDir as string | undefined);

      // Check if last assistant reply already contained a stop/yield marker.
      // This handles channels (e.g. cron-event) where agent_end/message_sent
      // hooks are not reliably called.
      const existingFlag = readFlag(watchdogDir, sessionKey);
      if (existingFlag) {
        try {
          const { messages } = await api.runtime.subagent.getSessionMessages({
            sessionKey,
            limit: 5,
          });
          const lastText = extractLastAssistantText(messages);
          const yieldMarker = (pluginCfg.yieldMarker as string | undefined) ?? DEFAULT_YIELD_MARKER;
          if (hasMarkerAtTail(lastText, stopMarker) || hasMarkerAtTail(lastText, yieldMarker)) {
            deleteFlag(watchdogDir, sessionKey);
            // If it was a stop marker, don't plant a new flag — the previous run completed.
            if (hasMarkerAtTail(lastText, stopMarker)) return;
          }
        } catch {
          // getSessionMessages failed — proceed normally, plant flag.
        }
      }

      writeFlag(watchdogDir, sessionKey, {
        sessionKey,
        startedAt: new Date().toISOString(),
        trigger: ctx.trigger ?? "unknown",
      });
    });

    // ── message_sent: check the flag on every outbound message ─────────────
    // This fires more reliably than agent_end for cron-event and other lightweight
    // channel sessions where agent_end may not be called.
    api.on("message_sent", (_event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;
      const watchdogDir = getWatchdogDir(ctx.workspaceDir, pluginCfg.watchdogDir as string | undefined);
      const flag = readFlag(watchdogDir, sessionKey);
      if (!flag) return;

      const text = (typeof (_event as Record<string, unknown>).text === "string")
        ? (_event as Record<string, unknown>).text as string
        : (typeof (_event as Record<string, unknown>).content === "string")
          ? (_event as Record<string, unknown>).content as string
          : "";

      if (hasMarkerAtTail(text, stopMarker)) {
        deleteFlag(watchdogDir, sessionKey);
      }

      const yieldMarker = (pluginCfg.yieldMarker as string | undefined) ?? DEFAULT_YIELD_MARKER;
      if (hasMarkerAtTail(text, yieldMarker)) {
        // Leave flag for gateway_start recovery, but don't wake.
        // (No action needed here — wake suppression is handled in agent_end)
      }
    });

    // ── agent_end: check the flag ────────────────────────────────────────────
    api.on("agent_end", async (event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;
      const watchdogDir = getWatchdogDir(ctx.workspaceDir, pluginCfg.watchdogDir as string | undefined);
      const flag = readFlag(watchdogDir, sessionKey);
      if (!flag) return;

      const lastText = extractLastAssistantText(event.messages);

      // Intentional completion — clean up and stop.
      api.logger.info(`[loop-watchdog] lastText tail: ${JSON.stringify(lastText.slice(-150))}`);
      if (hasMarkerAtTail(lastText, stopMarker)) {
        api.logger.info(`[loop-watchdog] stop marker detected, cleaning up`);
        deleteFlag(watchdogDir, sessionKey);
        return;
      }

      // Heartbeat ACK — treat as implicit stop (no loop needed).
      if (lastText.trimEnd().endsWith("HEARTBEAT_OK")) {
        api.logger.info(`[loop-watchdog] heartbeat ACK detected, cleaning up`);
        deleteFlag(watchdogDir, sessionKey);
        return;
      }

      // Intentional yield (waiting for subagent results) — leave the flag so
      // gateway_start can still recover after a crash, but do NOT send a wake
      // message. The subagent push-notification will re-enter the session.
      const yieldMarker = (pluginCfg.yieldMarker as string | undefined) ?? locale.yieldMarker;
      if (hasMarkerAtTail(lastText, yieldMarker)) {
        return;
      }

      try {
        await api.runtime.subagent.run({
          sessionKey,
          idempotencyKey: `loop-watchdog-wake-${sessionKey}-${Date.now()}`,
          message: buildWakeMessageAgentEnd(locale),
        });
      } catch (err) {
        api.logger.error(`[loop-watchdog] Failed to send wake message: ${err}`);
      }
    });

    // ── before_reset: clear flag on /new or /reset ──────────────────────────
    api.on("before_reset", (_event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;
      const watchdogDir = getWatchdogDir(ctx.workspaceDir, pluginCfg.watchdogDir as string | undefined);
      deleteFlag(watchdogDir, sessionKey);
    });

    // ── gateway_start: scan orphaned flags after restart ────────────────────
    api.on("gateway_start", async (_event, _ctx) => {
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(api.config);
      const watchdogDir = getWatchdogDir(workspaceDir, pluginCfg.watchdogDir as string | undefined);

      let files: string[];
      try {
        files = fs.readdirSync(watchdogDir).filter((f) => f.endsWith(".running"));
      } catch {
        return;
      }

      for (const file of files) {
        const filePath = path.join(watchdogDir, file);
        let flagData: FlagData | null = null;
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
          if (typeof raw?.sessionKey === "string" && typeof raw?.startedAt === "string") {
            flagData = raw as FlagData;
          }
        } catch { /* malformed flag — skip */ }

        if (!flagData) {
          api.logger.warn(`[loop-watchdog] gateway_start: could not read sessionKey from ${file}, skipping`);
          continue;
        }

        const sessionKey = flagData.sessionKey;
        // Use startedAt for a stable idempotency key across rapid restarts.
        const idempKey = `loop-watchdog-restart-${sessionKey}-${flagData.startedAt}`;
        try {
          await api.runtime.subagent.run({
            sessionKey,
            idempotencyKey: idempKey,
            message: locale.wakeMessageGatewayStart,
          });
        } catch (err) {
          api.logger.error(`[loop-watchdog] gateway_start: failed to wake ${sessionKey}: ${err}`);
        }
      }
    });
  },
});


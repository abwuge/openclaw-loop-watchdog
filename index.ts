import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_STOP_MARKER = "[我确认工作循环需要结束";

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

function writeFlag(watchdogDir: string, sessionKey: string, data: object): void {
  fs.mkdirSync(watchdogDir, { recursive: true });
  fs.writeFileSync(flagPath(watchdogDir, sessionKey), JSON.stringify(data, null, 2), "utf8");
}

function readFlag(watchdogDir: string, sessionKey: string): object | null {
  try {
    return JSON.parse(fs.readFileSync(flagPath(watchdogDir, sessionKey), "utf8"));
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
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") return b.text;
      }
    }
  }
  return "";
}

function hasStopMarkerAtTail(text: string, marker: string): boolean {
  const trimmed = text.trimEnd();
  const idx = trimmed.lastIndexOf(marker);
  if (idx === -1) return false;
  // No blank line (new paragraph) after the marker — it must be at the tail
  const after = trimmed.slice(idx + marker.length);
  return !after.includes("\n\n");
}

// ── Wake message templates ───────────────────────────────────────────────────

const WAKE_MARKER_FORMAT =
  "结束标记格式（仅在任务真正完成时使用）：\n" +
  "[我确认工作循环需要结束，而不是无意义的结束]\n" +
  "本次工作内容：<一句话说明你完成了什么>\n" +
  "结束理由：<一句话说明为什么结束>";

const WAKE_MSG_AGENT_END =
  "[系统提示] 你上一个工作循环已结束，但没有留下有效的结束标记。\n\n" +
  "可能的情况：\n" +
  "1. 意外中断（超时、错误）→ 直接继续执行下一步。\n" +
  "2. 任务完成但忘记标记 → 先自查：任务是否真正全部完成？最后一步是否留下了悬而未决的问题？是否向用户问了不必要的确认？如果确认任务已真正完成，补上结束标记后停止。\n\n" +
  WAKE_MARKER_FORMAT;

const WAKE_MSG_GATEWAY_START =
  "[系统提示] 你的工作循环已被网关重启打断，请直接继续下一步。";

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
  const sessionKey = event.context?.sessionKey;
  const workspaceDir = event.context?.workspaceDir;
  if (!sessionKey || !workspaceDir) return;
  const safe = sessionKey.replace(/[^a-zA-Z0-9_.\\-]/g, '_');
  const flagPath = path.join(workspaceDir, 'watchdog', safe + '.running');
  try { fs.unlinkSync(flagPath); } catch { /* gone */ }
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
  id: "loop-watchdog",
  name: "Loop Watchdog",
  description: "Detects unintentional agent loop interruptions and prompts the agent to resume.",

  register(api) {
    const pluginCfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const stopMarker: string =
      typeof pluginCfg.stopMarker === "string" ? pluginCfg.stopMarker : DEFAULT_STOP_MARKER;

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
    api.on("before_agent_start", (_event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;
      if (ctx.trigger && ctx.trigger !== "user") return;
      const watchdogDir = getWatchdogDir(ctx.workspaceDir, pluginCfg.watchdogDir as string | undefined);
      writeFlag(watchdogDir, sessionKey, {
        sessionKey,
        startedAt: new Date().toISOString(),
        trigger: ctx.trigger ?? "unknown",
      });
    });

    // ── agent_end: check the flag ────────────────────────────────────────────
    api.on("agent_end", async (event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;
      const watchdogDir = getWatchdogDir(ctx.workspaceDir, pluginCfg.watchdogDir as string | undefined);
      const flag = readFlag(watchdogDir, sessionKey);
      if (!flag) return;

      const lastText = extractLastAssistantText(event.messages);
      if (hasStopMarkerAtTail(lastText, stopMarker)) {
        deleteFlag(watchdogDir, sessionKey);
        return;
      }

      try {
        await api.runtime.subagent.run({
          sessionKey,
          idempotencyKey: `loop-watchdog-wake-${sessionKey}-${Date.now()}`,
          message: WAKE_MSG_AGENT_END,
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
        const sessionKey = file.replace(/\.running$/, "").replace(/_/g, ":");
        try {
          await api.runtime.subagent.run({
            sessionKey,
            idempotencyKey: `loop-watchdog-restart-${sessionKey}-${Date.now()}`,
            message: WAKE_MSG_GATEWAY_START,
          });
        } catch (err) {
          api.logger.error(`[loop-watchdog] gateway_start: failed to wake ${sessionKey}: ${err}`);
        }
      }
    });
  },
});

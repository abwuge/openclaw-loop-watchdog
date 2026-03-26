import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_STOP_MARKER = "[我确认工作循环需要结束";

function getWatchdogDir(workspaceDir?: string, customDir?: string): string {
  if (customDir) return customDir;
  if (workspaceDir) return path.join(workspaceDir, "watchdog");
  return path.join(process.env.HOME ?? "~", ".openclaw", "workspace", "watchdog");
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
  const fp = flagPath(watchdogDir, sessionKey);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function deleteFlag(watchdogDir: string, sessionKey: string): void {
  try {
    fs.unlinkSync(flagPath(watchdogDir, sessionKey));
  } catch {
    // Already gone, no problem
  }
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
  // Marker must be at the tail: nothing after it except the remaining lines of the stop block
  // (no blank line = no new paragraph after the marker)
  const after = trimmed.slice(idx + marker.length);
  return !after.includes("\n\n");
}

const WAKE_MARKER_FORMAT =
  "结束标记格式（仅在任务真正完成时使用）：\n" +
  "[我确认工作循环需要结束，而不是无意义的结束]\n" +
  "本次工作内容：<一句话说明你完成了什么>\n" +
  "结束理由：<一句话说明为什么结束>";

export default definePluginEntry({
  id: "loop-watchdog",
  name: "Loop Watchdog",
  description: "Detects unintentional agent loop interruptions and prompts the agent to resume.",

  register(api) {
    const pluginCfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const stopMarker: string =
      typeof pluginCfg.stopMarker === "string" ? pluginCfg.stopMarker : DEFAULT_STOP_MARKER;

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
          message:
            "[系统提示] 你上一个工作循环已结束，但没有留下有效的结束标记。\n\n" +
            "可能的情况：\n" +
            "1. 意外中断（超时、错误）→ 直接继续执行下一步。\n" +
            "2. 任务完成但忘记标记 → 先自查：任务是否真正全部完成？最后一步是否留下了悬而未决的问题？是否向用户问了不必要的确认？如果确认任务已真正完成，补上结束标记后停止。\n\n" +
            WAKE_MARKER_FORMAT,
        });
      } catch (err) {
        api.logger.error(`[loop-watchdog] Failed to send wake message: ${err}`);
      }
    });

    // ── before_reset: clear flag on explicit /new or /reset ─────────────────
    api.on("before_reset", (_event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;
      const watchdogDir = getWatchdogDir(ctx.workspaceDir, pluginCfg.watchdogDir as string | undefined);
      deleteFlag(watchdogDir, sessionKey);
    });

    // ── gateway_start: scan for orphaned flags from before restart ───────────
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
            message: "[系统提示] 你的工作循环已被网关重启打断，请直接继续下一步。",
          });
        } catch (err) {
          api.logger.error(`[loop-watchdog] gateway_start: failed to wake ${sessionKey}: ${err}`);
        }
      }
    });
  },
});

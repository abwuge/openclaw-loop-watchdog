const fs = require('node:fs');
const path = require('node:path');

const handler = (event) => {
  if (event.type !== 'command' || event.action !== 'stop') return;

  const workspaceDir = event.context?.workspaceDir;
  if (!workspaceDir) return;

  const watchdogDir = path.join(workspaceDir, 'watchdog');

  // Clear ALL running flags, not just the current session's flag.
  // /stop may be issued from a different channel (e.g. Telegram) than the
  // session whose flag was planted (e.g. webchat main session). Clearing all
  // flags is safe: /stop means "stop the agent", so no session should be
  // woken by the watchdog afterward.
  let files;
  try {
    files = fs.readdirSync(watchdogDir).filter((f) => f.endsWith('.running'));
  } catch {
    // Directory doesn't exist — nothing to do
    return;
  }

  for (const file of files) {
    try {
      fs.unlinkSync(path.join(watchdogDir, file));
    } catch {
      // Already gone — ignore
    }
  }
};

module.exports = handler;

const fs = require('node:fs');
const path = require('node:path');

const handler = (event) => {
  if (event.type !== 'command' || event.action !== 'stop') return;

  // sessionKey is a top-level field on InternalHookEvent (not in context)
  const sessionKey = event.sessionKey;
  // workspaceDir lives in event.context
  const workspaceDir = event.context?.workspaceDir;
  if (!sessionKey || !workspaceDir) return;

  const safe = sessionKey.replace(/[^a-zA-Z0-9_.\-]/g, '_');
  const flagPath = path.join(workspaceDir, 'watchdog', safe + '.running');
  try { fs.unlinkSync(flagPath); } catch { /* already gone */ }
};

module.exports = handler;

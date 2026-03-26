const fs = require('node:fs');
const path = require('node:path');

const handler = (event) => {
  if (event.type !== 'command' || event.action !== 'stop') return;

  const sessionKey = event.context?.sessionKey;
  const workspaceDir = event.context?.workspaceDir;
  if (!sessionKey || !workspaceDir) return;

  const safe = sessionKey.replace(/[^a-zA-Z0-9_.\-]/g, '_');
  const flagPath = path.join(workspaceDir, 'watchdog', `${safe}.running`);

  try {
    fs.unlinkSync(flagPath);
  } catch {
    // File doesn't exist — nothing to do
  }
};

module.exports = handler;

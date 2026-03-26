/**
 * @deprecated This file has been superseded by index.test.ts which uses the
 * correct hasMarkerAtTail semantics (paragraph-boundary \n\n rule) from index.ts.
 * This file inlines a different implementation (500-char proximity rule) that
 * does NOT match the real implementation and will produce false positives.
 *
 * Use instead: npx tsx --test index.test.ts
 *
 * Basic unit tests for loop-watchdog core logic.
 * Run: node test.mjs
 * No test framework required — pure Node.js assertions.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Inline the pure functions under test ─────────────────────────────────────

function hasMarkerAtTail(text, marker) {
  const trimmed = text.trimEnd();
  const idx = trimmed.lastIndexOf(marker);
  if (idx === -1) return false;
  return idx >= trimmed.length - 500;
}

function extractLastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') return block.text;
      }
    }
  }
  return '';
}

function flagPath(watchdogDir, sessionKey) {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_\-.]/g, '_');
  return path.join(watchdogDir, `${safe}.running`);
}

function writeFlag(watchdogDir, sessionKey, data) {
  fs.mkdirSync(watchdogDir, { recursive: true });
  fs.writeFileSync(flagPath(watchdogDir, sessionKey), JSON.stringify(data, null, 2), 'utf8');
}

function readFlag(watchdogDir, sessionKey) {
  try {
    const raw = JSON.parse(fs.readFileSync(flagPath(watchdogDir, sessionKey), 'utf8'));
    if (typeof raw?.sessionKey === 'string' && typeof raw?.startedAt === 'string') return raw;
    return null;
  } catch { return null; }
}

function deleteFlag(watchdogDir, sessionKey) {
  try { fs.unlinkSync(flagPath(watchdogDir, sessionKey)); } catch { /* gone */ }
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── hasMarkerAtTail ───────────────────────────────────────────────────────────

const STOP = '[我确认工作循环需要结束';
const YIELD = '[我正在等待子代理完成';

console.log('\nhasMarkerAtTail');

test('detects stop marker at end', () => {
  const text = 'some work\n[我确认工作循环需要结束，而不是无意义的结束]\n本次工作内容：xxx\n结束理由：yyy';
  assert.equal(hasMarkerAtTail(text, STOP), true);
});

test('detects yield marker at end', () => {
  const text = 'spawning\n[我正在等待子代理完成，将在结果返回后继续]\n子代理标签：my-agent';
  assert.equal(hasMarkerAtTail(text, YIELD), true);
});

test('returns false when marker is absent', () => {
  assert.equal(hasMarkerAtTail('just some text', STOP), false);
});

test('returns false when marker is >500 chars from end', () => {
  const text = STOP + ' '.repeat(600) + 'trailing';
  assert.equal(hasMarkerAtTail(text, STOP), false);
});

test('handles trailing whitespace', () => {
  const text = 'done\n[我确认工作循环需要结束]   \n\n';
  assert.equal(hasMarkerAtTail(text, STOP), true);
});

test('returns false for empty string', () => {
  assert.equal(hasMarkerAtTail('', STOP), false);
});

// ── extractLastAssistantText ──────────────────────────────────────────────────

console.log('\nextractLastAssistantText');

test('extracts string content from last assistant message', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'world' },
  ];
  assert.equal(extractLastAssistantText(messages), 'world');
});

test('extracts text block from array content', () => {
  const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'block text' }] }];
  assert.equal(extractLastAssistantText(messages), 'block text');
});

test('returns last assistant message not first', () => {
  const messages = [
    { role: 'assistant', content: 'first' },
    { role: 'user', content: 'ok' },
    { role: 'assistant', content: 'second' },
  ];
  assert.equal(extractLastAssistantText(messages), 'second');
});

test('returns empty string when no assistant messages', () => {
  assert.equal(extractLastAssistantText([{ role: 'user', content: 'hi' }]), '');
});

test('returns empty string for empty array', () => {
  assert.equal(extractLastAssistantText([]), '');
});

test('skips non-text blocks in array content', () => {
  const messages = [{
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'x' }, { type: 'text', text: 'actual' }],
  }];
  assert.equal(extractLastAssistantText(messages), 'actual');
});

// ── Flag file I/O ─────────────────────────────────────────────────────────────

console.log('\nFlag file I/O');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-test-'));

test('writeFlag + readFlag round-trip', () => {
  const data = { sessionKey: 'sess-1', startedAt: '2026-03-27T00:00:00.000Z', trigger: 'user' };
  writeFlag(tmpDir, 'sess-1', data);
  assert.deepEqual(readFlag(tmpDir, 'sess-1'), data);
});

test('readFlag returns null for missing file', () => {
  assert.equal(readFlag(tmpDir, 'nonexistent'), null);
});

test('deleteFlag removes the file', () => {
  writeFlag(tmpDir, 'sess-del', { sessionKey: 'sess-del', startedAt: '2026-01-01T00:00:00.000Z', trigger: 'user' });
  deleteFlag(tmpDir, 'sess-del');
  assert.equal(readFlag(tmpDir, 'sess-del'), null);
});

test('deleteFlag is idempotent', () => {
  deleteFlag(tmpDir, 'already-gone');
});

test('sessionKey with special chars is sanitized', () => {
  const key = 'session/with:special*chars';
  const data = { sessionKey: key, startedAt: '2026-03-27T00:00:00.000Z', trigger: 'system' };
  writeFlag(tmpDir, key, data);
  assert.deepEqual(readFlag(tmpDir, key), data);
  deleteFlag(tmpDir, key);
});

test('readFlag returns null for malformed JSON', () => {
  fs.writeFileSync(flagPath(tmpDir, 'bad-json'), '{not valid json', 'utf8');
  assert.equal(readFlag(tmpDir, 'bad-json'), null);
});

test('readFlag returns null when sessionKey field missing', () => {
  fs.writeFileSync(flagPath(tmpDir, 'no-key'), JSON.stringify({ startedAt: '2026-03-27T00:00:00.000Z' }), 'utf8');
  assert.equal(readFlag(tmpDir, 'no-key'), null);
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

fs.rmSync(tmpDir, { recursive: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

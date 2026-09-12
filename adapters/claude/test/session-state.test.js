import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, statePath, writeState } from '../src/session-state.js';

test('statePath sanitizes the session id and isolates by session', () => {
  const dir = '/tmp/nmnm-claude';
  assert.equal(statePath('abc-123', dir), join(dir, 'session-abc-123.json'));
  assert.equal(statePath('../evil/../id', dir), join(dir, 'session-default.json'));
  assert.equal(statePath(undefined, dir), join(dir, 'session-default.json'));
});

test('state round-trips and defaults to empty for a missing or corrupt file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-claude-state-'));
  try {
    const path = statePath('s1', dir);
    assert.deepEqual(readState(path), {});
    writeState(path, { prompt_count: 3 });
    assert.deepEqual(readState(path), { prompt_count: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

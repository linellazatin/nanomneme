import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryLogger } from '@openlines/nmnm-core/logging';
import pkg from '../package.json' with { type: 'json' };

test('public logging entry defaults to core identity, inherits config, and ignores private injection', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-core-logging-'));
  try {
    const base = join(home, '.local/share/nanomneme');
    const disabled = createMemoryLogger({ home }, { resolveEnabled: () => true });
    assert.equal(disabled.run({ operation: 'retain' }, () => 7), 7);
    assert.equal(existsSync(base), false);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
    const logger = createMemoryLogger({ home });
    logger.run({ operation: 'retrieve' }, () => ({ total: 0 }));
    const record = JSON.parse(readFileSync(join(base, 'logs/nmnm-core.jsonl'), 'utf8'));
    assert.equal(record.service.component, 'nmnm-core');
    assert.equal(record.service.version, pkg.version);
    assert.equal(record.status, 'empty');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleTool } from '../src/operations.js';
import { open } from '@openlines/nmnm-core';
import { runCli } from '../src/cli.js';

test('shared diagnostics cover tools and management, inherit and override without payloads', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-claude-logging-'));
  const base = join(home, '.local/share/nanomneme');
  const globalDir = join(home, 'agent');
  const ctx = { cwd: home, home, globalDir };
  try {
    mkdirSync(base, { recursive: true }); mkdirSync(globalDir);
    writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
    assert.throws(() => handleTool('toString', {}, ctx), /unknown nanomneme tool/);
    const retained = handleTool('retain_memory', { content: 'PRIVATE sentinel' }, ctx);
    const id = retained.details.id;
    handleTool('retrieve_memory', {}, ctx);
    handleTool('recall_memory', { id, store: 'global' }, ctx);
    assert.throws(() => handleTool('retain_memory', {}, ctx));
    runCli({ ...ctx, argv: ['pin', id] });
    runCli({ ...ctx, argv: ['show', id] });
    const globalStore = open(join(base, 'memory.db'));
    globalStore.import([{ ...retained.details, scope: 'global' }]); globalStore.close();
    runCli({ ...ctx, argv: ['pin', id] });
    runCli({ ...ctx, argv: ['remove', 'project', id] });
    const log = join(base, 'logs/nmnm-claude.jsonl');
    const records = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(r => [r.operation,r.status]), [['retain','ok'],['retrieve','ok'],['recall','not_found'],['retain','failed'],['command_pin','ok'],['command_pin','blocked'],['command_remove','ok']]);
    assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(records).includes(id), false);
    writeFileSync(join(globalDir, 'nmnm.jsonc'), '{"logging":{"enabled":false}}');
    handleTool('retrieve_memory', {}, ctx);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, records.length);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

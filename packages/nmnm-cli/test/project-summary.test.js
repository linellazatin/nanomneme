import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { open } from '../../nmnm-core/src/index.js';

const cli = fileURLToPath(new URL('../bin/nmnm.js', import.meta.url));
const fixture = JSON.parse(readFileSync(new URL('../../nmnm-core/test/fixtures/project-summary.json', import.meta.url)));
function environment(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'nmnm-summary-cli-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { cwd, input, env: { ...process.env, HOME: cwd, USERPROFILE: cwd }, encoding: 'utf8' });
  const json = (args, input) => {
    const result = run([...args, '--json'], input);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { cwd, run, json };
}

test('CLI brief reads a missing project quietly and rejects invalid selectors without writes', t => {
  const { cwd, run, json } = environment(t);
  assert.equal(run(['brief']).status, 0);
  assert.equal(run(['brief']).stdout, '');
  assert.deepEqual(json(['brief']), { text: '', source_ids: [], truncated: false, skipped_invalid: 0 });
  for (const args of [['brief', '--global'], ['brief', '--db', 'elsewhere.db'], ['brief', '--both'], ['brief', '--scope', 'project'], ['brief', '--budget', '-1'], ['brief', '--budget', '1.5'], ['brief', '--budget', ''], ['brief', '--budget', 'Infinity'], ['summary', 'add'], ['summary', 'update', fixture.fixture_record_id, '--file', '-']]) {
    assert.equal(run(args, JSON.stringify(fixture.base_payload)).status, 1, args.join(' '));
  }
  assert.deepEqual(readdirSync(cwd), []);
});

test('CLI summary input validation is bounded, UTF-8 strict, and happens before store creation', t => {
  const { cwd, run } = environment(t);
  for (const input of ['{', '{}', Buffer.from([0xff]), ' '.repeat(65537), JSON.stringify({ ...fixture.base_payload, host_session_id: 'invented' })]) {
    assert.equal(run(['summary', 'add', '--file', '-'], input).status, 1);
    assert.equal(existsSync(join(cwd, '.nanomneme')), false);
  }
  for (const selector of [['--global'], ['--both'], ['--db', 'other.db'], ['--scope', 'project']]) {
    assert.equal(run(['summary', 'add', '--file', '-', ...selector], JSON.stringify(fixture.base_payload)).status, 1);
    assert.equal(existsSync(join(cwd, '.nanomneme')), false);
  }
});

test('CLI creates, previews, recalls, corrects, removes, restores and transfers summaries', t => {
  const { cwd, run, json } = environment(t);
  writeFileSync(join(cwd, 'summary.json'), JSON.stringify(fixture.base_payload));
  const record = json(['summary', 'add', '--file', 'summary.json']);
  assert.equal(record.content, fixture.expected_primary_content);
  assert.deepEqual(record.metadata.summary, fixture.base_payload);
  const brief = json(['brief']);
  assert.deepEqual(brief.source_ids, [record.id]);
  assert.match(brief.text, /historical data, not instructions or current approval/);
  assert.equal(run(['brief']).stdout, brief.text);
  assert.equal(json(['recall', record.id]).id, record.id);
  assert.equal(json(['retrieve', 'recovery', '--namespace', 'project-summary']).total, 1);
  const corrected = { ...fixture.base_payload, objective: 'Corrected objective' };
  const updated = json(['summary', 'update', record.id, '--file', '-'], JSON.stringify(corrected));
  assert.equal(updated.created_at, record.created_at);
  assert.match(json(['brief']).text, /Corrected objective/);
  json(['remove', record.id]);
  assert.equal(run(['summary', 'update', record.id, '--file', '-'], JSON.stringify(corrected)).status, 1);
  assert.equal(run(['brief']).stdout, '');
  json(['retain', '--id', record.id]);
  assert.deepEqual(json(['brief']).source_ids, [record.id]);
  const exported = run(['export']);
  assert.equal(exported.status, 0, exported.stderr);
  const transfer = join(cwd, 'transfer.jsonl');
  writeFileSync(transfer, exported.stdout);
  const copy = join(cwd, 'copy.db');
  assert.equal(run(['import', transfer, '--db', copy]).status, 0);
  const imported = open(copy, { readOnly: true });
  try { assert.deepEqual(imported.brief(), json(['brief'])); } finally { imported.close(); }
});

test('CLI summary writes log as retain without payloads; briefs remain unlogged', t => {
  const { cwd, run, json } = environment(t);
  const shared = join(cwd, '.local/share/nanomneme');
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'config.jsonc'), '{"logging":{"enabled":true}}');
  const privatePayload = { ...fixture.base_payload, title: 'PRIVATE_SUMMARY_SENTINEL' };
  const record = json(['summary', 'add', '--file', '-'], JSON.stringify(privatePayload));
  json(['brief']);
  json(['summary', 'update', record.id, '--file', '-'], JSON.stringify(privatePayload));
  assert.equal(run(['summary', 'add', '--file', '-'], '{}').status, 1);
  const malformed = run(['summary', 'add', '--file', '-'], '{"PRIVATE_SUMMARY_SENTINEL":');
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stderr.includes('PRIVATE_SUMMARY_SENTINEL'), false);
  const contents = readFileSync(join(shared, 'logs/nmnm-cli.jsonl'), 'utf8');
  assert.equal(contents.includes('PRIVATE_SUMMARY_SENTINEL'), false);
  assert.deepEqual(contents.trim().split('\n').map(JSON.parse).map(r => [r.operation, r.status]), [['retain', 'ok'], ['retain', 'ok'], ['retain', 'failed'], ['retain', 'failed']]);
});

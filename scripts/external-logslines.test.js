import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkExternalLogslines, updateExternalLogslines } from './external-logslines.js';

const repository = 'https://github.com/linellazatin/logslines';
const tag = 'v0.1.0';
const releaseUrl = `${repository}/releases/tag/${tag}`;
const files = {
  LICENSE: 'MIT License\n',
  'src/logger.js': "export function createLogger() {}\n",
  'src/sinks/stderr.js': "export function createStderrSink() {}\n",
};
const sha256 = {
  LICENSE: '267f7a2e19dfa9df99af774520985a0e521925293ea5b7e767ab06969d06bf91',
  'src/logger.js': '619e39da3ee72ab983cb9ba080c2e42125635788d162b1502674bb4f894ed59b',
  'src/sinks/stderr.js': '7104cf6f8779531f61192c5978d3e2b7afe27692d69adfb79e21ab3108087831',
};

function response({ status = 200, body = '', contentType = 'text/plain' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

function validFetch({ missingPath, releaseBody = JSON.stringify({ html_url: releaseUrl, tag_name: tag }), emptyPath } = {}) {
  return async (url) => {
    if (url.endsWith(`/releases/tags/${tag}`)) return response({ body: releaseBody, contentType: 'application/json' });
    const path = Object.keys(files).find((candidate) => url.endsWith(`/${tag}/${candidate}`));
    if (!path || path === missingPath) return response({ status: 404 });
    return response({ body: path === emptyPath ? '' : files[path] });
  };
}

function temporaryDestination() {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-external-logslines-'));
  const destination = join(root, 'logslines');
  writeFileSync(destination, 'sentinel');
  return { root, destination };
}

function writeSnapshot(destination, sourceFiles = files) {
  mkdirSync(destination, { recursive: true });
  for (const [path, source] of Object.entries(sourceFiles)) {
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source, 'utf8');
  }
  writeFileSync(join(destination, 'PROVENANCE.json'), `${JSON.stringify({
    repository,
    tag,
    release_url: releaseUrl,
    files: Object.keys(files),
    sha256,
  }, null, 2)}\n`, 'utf8');
}

function assertUnchanged(destination) {
  assert.equal(readFileSync(destination, 'utf8'), 'sentinel');
}

test('checks an existing tagged release and atomically writes the required external source snapshot', async () => {
  const { root, destination } = temporaryDestination();
  try {
    const checkedInSnapshot = join(root, 'snapshot');
    writeSnapshot(checkedInSnapshot);
    const checked = await checkExternalLogslines({ tag, destination: checkedInSnapshot, fetchImpl: validFetch() });
    assert.deepEqual(checked, { tag, releaseUrl, files });
    await updateExternalLogslines({ tag, destination, fetchImpl: validFetch() });
    assert.equal(readFileSync(join(destination, 'LICENSE'), 'utf8'), files.LICENSE);
    assert.equal(readFileSync(join(destination, 'src/logger.js'), 'utf8'), files['src/logger.js']);
    assert.equal(readFileSync(join(destination, 'src/sinks/stderr.js'), 'utf8'), files['src/sinks/stderr.js']);
    assert.deepEqual(JSON.parse(readFileSync(join(destination, 'PROVENANCE.json'), 'utf8')), {
      repository, tag, release_url: releaseUrl, files: Object.keys(files), sha256,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a checked-in source file that differs from the requested upstream tag', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-external-logslines-drift-'));
  const destination = join(root, 'snapshot');
  try {
    writeSnapshot(destination);
    writeFileSync(join(destination, 'src/logger.js'), 'drifted source\\n');
    await assert.rejects(
      checkExternalLogslines({ tag, destination, fetchImpl: validFetch() }),
      /checked-in Logslines source differs/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an unavailable release tag without altering the external snapshot', async () => {
  const { root, destination } = temporaryDestination();
  try {
    await assert.rejects(checkExternalLogslines({ tag, fetchImpl: async () => response({ status: 404 }) }), /release tag v0\.1\.0 is unavailable/);
    await assert.rejects(updateExternalLogslines({ tag, destination, fetchImpl: async () => response({ status: 404 }) }), /release tag v0\.1\.0 is unavailable/);
    assertUnchanged(destination);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a release missing a required source file without altering the external snapshot', async () => {
  const { root, destination } = temporaryDestination();
  try {
    await assert.rejects(updateExternalLogslines({ tag, destination, fetchImpl: validFetch({ missingPath: 'src/logger.js' }) }), /required external source is unavailable: src\/logger\.js/);
    assertUnchanged(destination);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects release metadata for a different tag without altering the external snapshot', async () => {
  const { root, destination } = temporaryDestination();
  try {
    await assert.rejects(updateExternalLogslines({ tag, destination, fetchImpl: validFetch({ releaseBody: JSON.stringify({ html_url: releaseUrl, tag_name: 'v9.9.9' }) }) }), /does not identify v0\.1\.0/);
    assertUnchanged(destination);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an empty required source without altering the external snapshot', async () => {
  const { root, destination } = temporaryDestination();
  try {
    await assert.rejects(updateExternalLogslines({ tag, destination, fetchImpl: validFetch({ emptyPath: 'src/logger.js' }) }), /required external source is empty: src\/logger\.js/);
    assertUnchanged(destination);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects network and malformed release failures without altering the external snapshot', async () => {
  const { root, destination } = temporaryDestination();
  try {
    await assert.rejects(updateExternalLogslines({ tag, destination, fetchImpl: async () => { throw new Error('offline'); } }), /could not fetch Logslines release tag v0\.1\.0/);
    assertUnchanged(destination);
    await assert.rejects(updateExternalLogslines({ tag, destination, fetchImpl: validFetch({ releaseBody: 'not json' }) }), /invalid release metadata/);
    assertUnchanged(destination);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects non-text source responses without altering the external snapshot', async () => {
  const { root, destination } = temporaryDestination();
  try {
    const fetchImpl = async (url) => {
      if (url.endsWith(`/releases/tags/${tag}`)) return response({ body: JSON.stringify({ html_url: releaseUrl, tag_name: tag }), contentType: 'application/json' });
      return response({ body: 'binary', contentType: 'application/octet-stream' });
    };
    await assert.rejects(updateExternalLogslines({ tag, destination, fetchImpl }), /required external source is not text: LICENSE/);
    assertUnchanged(destination);
    assert.equal(existsSync(join(root, 'logslines.new')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

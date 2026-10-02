#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'https://github.com/linellazatin/logslines';
const apiRepository = 'https://api.github.com/repos/linellazatin/logslines';
const rawRepository = 'https://raw.githubusercontent.com/linellazatin/logslines';
const requiredPaths = ['LICENSE', 'src/logger.js', 'src/sinks/stderr.js', 'spec/v1/schema.json'];

function responseIsText(response) {
  const contentType = response.headers?.get?.('content-type') ?? '';
  return contentType.startsWith('text/') || contentType.includes('javascript');
}

async function fetchResponse(fetchImpl, url, unavailableMessage, unavailableNetworkMessage = unavailableMessage) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new Error(unavailableNetworkMessage);
  }
  if (!response?.ok) throw new Error(unavailableMessage);
  return response;
}

function hashesFor(files) {
  return Object.fromEntries(requiredPaths.map((path) => [
    path,
    createHash('sha256').update(files[path], 'utf8').digest('hex'),
  ]));
}

async function fetchExternalLogslines({ tag, fetchImpl = fetch } = {}) {
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('tag must be an exact v<major>.<minor>.<patch> release tag');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation must be a function');

  const releaseResponse = await fetchResponse(fetchImpl, `${apiRepository}/releases/tags/${encodeURIComponent(tag)}`, `release tag ${tag} is unavailable`, `could not fetch Logslines release tag ${tag}`);
  let release;
  try {
    release = await releaseResponse.json();
  } catch {
    throw new Error(`release tag ${tag} has invalid release metadata`);
  }
  const releaseUrl = release?.html_url;
  if (typeof releaseUrl !== 'string' || releaseUrl.length === 0) throw new Error(`release tag ${tag} has invalid release metadata`);
  if (release.tag_name !== tag) throw new Error(`release metadata does not identify ${tag}`);

  const files = {};
  for (const path of requiredPaths) {
    const response = await fetchResponse(fetchImpl, `${rawRepository}/${encodeURIComponent(tag)}/${path}`, `required external source is unavailable: ${path}`);
    if (!responseIsText(response) && !(path.endsWith('.json') && response.headers?.get?.('content-type')?.includes('json'))) throw new Error(`required external source is not text: ${path}`);
    let source;
    try {
      source = await response.text();
    } catch {
      throw new Error(`required external source is unavailable: ${path}`);
    }
    if (typeof source !== 'string') throw new Error(`required external source is not text: ${path}`);
    if (source.length === 0) throw new Error(`required external source is empty: ${path}`);
    if (path.endsWith('.json')) {
      try {
        const schema = JSON.parse(source);
        if (schema?.$id !== 'logslines/v1' || schema.type !== 'object') throw new Error();
      } catch { throw new Error(`required external schema is invalid: ${path}`); }
    }
    files[path] = source;
  }
  return { tag, releaseUrl, files };
}

export async function checkExternalLogslines({ tag, destination = fileURLToPath(new URL('../external/logslines', import.meta.url)), fetchImpl = fetch } = {}) {
  const result = await fetchExternalLogslines({ tag, fetchImpl });
  const expectedHashes = hashesFor(result.files);
  let provenance;
  try {
    provenance = JSON.parse(readFileSync(join(destination, 'PROVENANCE.json'), 'utf8'));
  } catch {
    throw new Error('checked-in Logslines provenance is unavailable or invalid');
  }
  const provenanceKeys = ['repository', 'tag', 'release_url', 'files', 'sha256'];
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)
    || Object.keys(provenance).length !== provenanceKeys.length
    || provenanceKeys.some((key) => !Object.hasOwn(provenance, key))
    || provenance.repository !== repository
    || provenance.tag !== result.tag
    || provenance.release_url !== result.releaseUrl
    || JSON.stringify(provenance.files) !== JSON.stringify(requiredPaths)
    || !provenance.sha256 || typeof provenance.sha256 !== 'object' || Array.isArray(provenance.sha256)
    || Object.keys(provenance.sha256).length !== requiredPaths.length
    || requiredPaths.some((path) => provenance.sha256[path] !== expectedHashes[path])) {
    throw new Error(`checked-in Logslines provenance does not match release ${result.tag}`);
  }
  for (const path of requiredPaths) {
    let source;
    try {
      source = readFileSync(join(destination, path), 'utf8');
    } catch {
      throw new Error(`checked-in Logslines source is unavailable: ${path}`);
    }
    if (source !== result.files[path]) throw new Error(`checked-in Logslines source differs: ${path}`);
  }
  return result;
}

export async function updateExternalLogslines({ tag, destination = fileURLToPath(new URL('../external/logslines', import.meta.url)), fetchImpl = fetch } = {}) {
  const result = await fetchExternalLogslines({ tag, fetchImpl });
  const parent = dirname(destination);
  const name = basename(destination);
  const temporary = join(parent, `.${name}.tmp-${process.pid}-${Date.now()}`);
  const backup = join(parent, `.${name}.backup-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(temporary, { recursive: true });
    for (const [path, source] of Object.entries(result.files)) {
      const target = join(temporary, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source, 'utf8');
    }
    writeFileSync(join(temporary, 'PROVENANCE.json'), `${JSON.stringify({
      repository,
      tag: result.tag,
      release_url: result.releaseUrl,
      files: requiredPaths,
      sha256: hashesFor(result.files),
    }, null, 2)}\n`, 'utf8');

    if (existsSync(destination)) renameSync(destination, backup);
    try {
      renameSync(temporary, destination);
    } catch (error) {
      if (existsSync(backup)) renameSync(backup, destination);
      throw error;
    }
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
    return result;
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  }
}

async function main(args) {
  const [action, tag] = args;
  if (!['check', 'update'].includes(action) || tag === undefined) {
    throw new Error('usage: node scripts/external-logslines.js <check|update> <tag>');
  }
  const result = action === 'check'
    ? await checkExternalLogslines({ tag })
    : await updateExternalLogslines({ tag });
  console.log(`${action === 'check' ? 'checked' : 'updated'} Logslines ${result.tag}: ${result.releaseUrl}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

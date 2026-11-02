import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { codexConfigPath } from './logslines.js';

const ruleNames = ['always_persist', 'never_persist', 'always_ask'];
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Nanomneme ${name} must be an object`);
}
function boolean(value, name) {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`Nanomneme ${name} must be a boolean`);
}
function integer(value, minimum, name) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) throw new TypeError(`Nanomneme ${name} must be a safe integer >= ${minimum}`);
}

function readSettings(path) {
  let fd;
  try { fd = openSync(path, 'r'); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  let bytes;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 262144) throw new TypeError('Nanomneme settings must be a file of at most 262144 bytes');
    // Bounded read also handles a file growing after the size check.
    const buffer = Buffer.alloc(262145);
    const length = readFileSyncBounded(fd, buffer);
    if (length > 262144) throw new TypeError('Nanomneme settings exceed 262144 bytes');
    bytes = buffer.subarray(0, length).toString('utf8');
  } finally { closeSync(fd); }
  const errors = [];
  const value = parse(bytes, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) throw new TypeError('Nanomneme settings contain invalid JSONC');
  object(value, 'settings');
  integer(value.injection_budget, 0, 'injection_budget');
  if (value.reinjection !== undefined) {
    object(value.reinjection, 'reinjection');
    boolean(value.reinjection.enabled, 'reinjection.enabled');
    integer(value.reinjection.every_n_prompts, 1, 'reinjection.every_n_prompts');
  }
  if (value.autoretention !== undefined) {
    object(value.autoretention, 'autoretention');
    boolean(value.autoretention.enabled, 'autoretention.enabled');
    for (const name of ruleNames) {
      const rules = value.autoretention[name];
      if (rules !== undefined && (!Array.isArray(rules) || rules.some(rule => typeof rule !== 'string' || !rule.trim()))) throw new TypeError(`Nanomneme autoretention.${name} must contain non-empty strings`);
    }
  }
  return value;
}

function readFileSyncBounded(fd, buffer) {
  let total = 0, count;
  while (total < buffer.length && (count = readSync(fd, buffer, total, buffer.length - total, null))) total += count;
  return total;
}

export function resolveSettings({ cwd, home = homedir(), env = process.env }) {
  const user = readSettings(codexConfigPath({ home, env }));
  const project = readSettings(join(cwd, '.nanomneme/nmnm.jsonc'));
  return {
    injection_budget: project.injection_budget ?? user.injection_budget ?? 2000,
    reinjection: {
      enabled: project.reinjection?.enabled ?? user.reinjection?.enabled ?? false,
      every_n_prompts: project.reinjection?.every_n_prompts ?? user.reinjection?.every_n_prompts ?? 5,
    },
    autoretention: {
      enabled: project.autoretention?.enabled ?? user.autoretention?.enabled ?? false,
      ...Object.fromEntries(ruleNames.map(name => [name, [...new Set([...(user.autoretention?.[name] ?? []), ...(project.autoretention?.[name] ?? [])])]])),
    },
  };
}

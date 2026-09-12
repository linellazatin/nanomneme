import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { databasePath, runMemory } from './store.js';

export const DEFAULT_INJECTION_BUDGET = 2000;
export const DEFAULT_REINJECTION_PROMPTS = 5;
const SETTINGS_FILE = 'nmnm.jsonc';
const PINS_FILE = 'nmnm-claude.json';
const PREVIEW_LENGTH = 240;

function normalizedRuleArray(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((rule) => typeof rule !== 'string' || !rule.trim())) {
    throw new TypeError(`Nanomneme memory autoretention ${name} must be an array of non-empty strings`);
  }
  return [...new Set(value)];
}

function normalizedAutoretention(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Nanomneme memory autoretention must be an object');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new TypeError('Nanomneme memory autoretention enabled must be a boolean');
  return {
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
    always_persist: normalizedRuleArray(value.always_persist, 'always_persist'),
    never_persist: normalizedRuleArray(value.never_persist, 'never_persist'),
    always_ask: normalizedRuleArray(value.always_ask, 'always_ask'),
  };
}

function normalizedReinjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Nanomneme memory reinjection must be an object');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new TypeError('Nanomneme memory reinjection enabled must be a boolean');
  if (value.every_n_prompts !== undefined && (!Number.isSafeInteger(value.every_n_prompts) || value.every_n_prompts < 1)) throw new TypeError('Nanomneme memory reinjection every_n_prompts must be a positive safe integer');
  return {
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
    ...(value.every_n_prompts === undefined ? {} : { every_n_prompts: value.every_n_prompts }),
  };
}

function normalizedSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Nanomneme memory settings must be an object');
  const budget = value.injection_budget;
  if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 0)) throw new TypeError('Nanomneme memory injection_budget must be a non-negative integer');
  const autoretention = value.autoretention;
  const reinjection = value.reinjection;
  return {
    ...(budget === undefined ? {} : { injection_budget: budget }),
    ...(reinjection === undefined ? {} : { reinjection: normalizedReinjection(reinjection) }),
    ...(autoretention === undefined ? {} : { autoretention: normalizedAutoretention(autoretention) }),
  };
}

function normalizedPins(value) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) throw new TypeError('Nanomneme memory pins must be non-empty strings');
  return [...new Set(value)];
}

function expandedPath(path, home) {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return resolve(path);
}

export function claudeGlobalDir({ home = homedir(), env = process.env } = {}) {
  return env.CLAUDE_PLUGIN_DATA ? expandedPath(env.CLAUDE_PLUGIN_DATA, home) : join(home, '.claude');
}

export function settingsPath({ cwd, home = homedir(), globalDir = claudeGlobalDir({ home }), store }) {
  if (store === 'project') return join(cwd, '.nanomneme', SETTINGS_FILE);
  if (store === 'global') return join(globalDir, SETTINGS_FILE);
  throw new TypeError('store must be project or global');
}

export function pinsPath({ cwd, home = homedir(), store }) {
  if (store === 'project') return join(cwd, '.nanomneme', PINS_FILE);
  if (store === 'global') return join(home, '.local', 'share', 'nanomneme', PINS_FILE);
  throw new TypeError('store must be project or global');
}

export function readSettings(path) {
  if (!existsSync(path)) return {};
  const errors = [];
  const value = parse(readFileSync(path, 'utf8'), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) throw new TypeError('Nanomneme memory settings contain invalid JSONC');
  return normalizedSettings(value);
}

export function readPins(path) {
  if (!existsSync(path)) return [];
  return normalizedPins(JSON.parse(readFileSync(path, 'utf8')));
}

export function writePins(path, pins) {
  const next = normalizedPins(pins);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function pin(pins, id) {
  if (typeof id !== 'string' || !id) throw new TypeError('memory id is required');
  return normalizedPins([...normalizedPins(pins), id]);
}

export function unpin(pins, id) {
  if (typeof id !== 'string' || !id) throw new TypeError('memory id is required');
  return normalizedPins(pins).filter((candidate) => candidate !== id);
}

function preview(content) {
  return content.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}

function line(store, memory) {
  return `- [${store}] ${memory.id} ${preview(memory.content)}`;
}

function autoretentionContent(project, global) {
  const enabled = project.autoretention?.enabled ?? global.autoretention?.enabled ?? false;
  if (!enabled) return undefined;
  const rules = (name) => [...new Set([
    ...(global.autoretention?.[name] ?? []),
    ...(project.autoretention?.[name] ?? []),
  ])];
  const sections = [
    ['Never automatically retain:', rules('never_persist')],
    ['Ask the user before retaining:', rules('always_ask')],
    ['Automatically retain when applicable:', rules('always_persist')],
  ].filter(([, values]) => values.length);
  if (!sections.length) return undefined;
  return [
    '## Nanomneme autoretention',
    'Autoretention is enabled. Use retain_memory only when retaining a memory. Never automatically retain rules take precedence over all other rules.',
    ...sections.flatMap(([heading, values]) => [heading, ...values.map((value) => `- ${value}`)]),
  ].join('\n');
}

function readStore({ cwd, home, platform, store, operation, input }) {
  if (!existsSync(databasePath({ cwd, home, platform, store }))) return null;
  return runMemory({ cwd, home, platform, store, operation, input, create: false, readOnly: true });
}

export function buildMemoryIndex({ cwd, home, globalDir, platform, budget } = {}) {
  const projectSettings = readSettings(settingsPath({ cwd, home, globalDir, store: 'project' }));
  const globalSettings = readSettings(settingsPath({ cwd, home, globalDir, store: 'global' }));
  const projectPins = readPins(pinsPath({ cwd, home, store: 'project' }));
  const globalPins = readPins(pinsPath({ cwd, home, store: 'global' }));
  const limit = budget ?? projectSettings.injection_budget ?? globalSettings.injection_budget ?? DEFAULT_INJECTION_BUDGET;
  const reinjection = {
    enabled: projectSettings.reinjection?.enabled ?? globalSettings.reinjection?.enabled ?? false,
    every_n_prompts: projectSettings.reinjection?.every_n_prompts ?? globalSettings.reinjection?.every_n_prompts ?? DEFAULT_REINJECTION_PROMPTS,
  };
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('Nanomneme memory injection budget must be a non-negative integer');

  const records = [];
  const seen = new Set();
  let unresolved = 0;
  for (const [store, pins] of [['project', projectPins], ['global', globalPins]]) {
    for (const id of pins) {
      try {
        const memory = readStore({ cwd, home, platform, store, operation: 'recall', input: { id } });
        if (!memory) throw new RangeError('memory store does not exist');
        seen.add(`${store}:${memory.id}`);
        records.push({ store, memory });
      } catch {
        unresolved += 1;
      }
    }
  }
  for (const store of ['project', 'global']) {
    const recent = readStore({ cwd, home, platform, store, operation: 'retrieve', input: { limit: 20, order_by: 'updated_at' } });
    if (!recent) continue;
    for (const memory of recent.items) {
      const key = `${store}:${memory.id}`;
      if (!seen.has(key)) records.push({ store, memory });
    }
  }

  const autoretention = autoretentionContent(projectSettings, globalSettings);
  if (autoretention && autoretention.length > limit) {
    throw new TypeError('Nanomneme memory autoretention guidance exceeds the injection budget');
  }
  const indexBudget = Math.max(0, limit - (autoretention ? autoretention.length + 2 : 0));
  let content = 'Nanomneme memory index:\n';
  let total = 0;
  for (const record of records) {
    const next = `${line(record.store, record.memory)}\n`;
    if (content.length + next.length > indexBudget) break;
    content += next;
    total += 1;
  }
  return {
    content: content.slice(0, indexBudget),
    autoretention,
    unresolved,
    total,
    budget: limit,
    reinjection,
  };
}

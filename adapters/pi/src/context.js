import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { databasePath, runMemory } from './store.js';

export const DEFAULT_INJECTION_BUDGET = 2000;
const SETTINGS_FILE = 'nmnm.jsonc';
const PINS_FILE = 'nmnm-pi.json';
const PREVIEW_LENGTH = 240;

function normalizedSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Pi memory settings must be an object');
  const budget = value.injection_budget;
  if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 0)) throw new TypeError('Pi memory injection_budget must be a non-negative integer');
  return budget === undefined ? {} : { injection_budget: budget };
}

function normalizedPins(value) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) throw new TypeError('Pi memory pins must be non-empty strings');
  return [...new Set(value)];
}

function expandedPath(path, home) {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return resolve(path);
}

export function piAgentDir({ home = homedir(), env = process.env } = {}) {
  return env.PI_CODING_AGENT_DIR ? expandedPath(env.PI_CODING_AGENT_DIR, home) : join(home, '.pi', 'agent');
}

export function settingsPath({ cwd, home = homedir(), agentDir = piAgentDir({ home }), store }) {
  if (store === 'project') return join(cwd, '.nanomneme', SETTINGS_FILE);
  if (store === 'global') return join(agentDir, SETTINGS_FILE);
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
  if (errors.length) throw new TypeError('Pi memory settings contain invalid JSONC');
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

function readStore({ cwd, home, platform, store, operation, input }) {
  if (!existsSync(databasePath({ cwd, home, platform, store }))) return null;
  return runMemory({ cwd, home, platform, store, operation, input, create: false, readOnly: true });
}

export function buildMemoryIndex({ cwd, home, agentDir, platform, budget } = {}) {
  const projectSettings = readSettings(settingsPath({ cwd, home, agentDir, store: 'project' }));
  const globalSettings = readSettings(settingsPath({ cwd, home, agentDir, store: 'global' }));
  const projectPins = readPins(pinsPath({ cwd, home, store: 'project' }));
  const globalPins = readPins(pinsPath({ cwd, home, store: 'global' }));
  const limit = budget ?? projectSettings.injection_budget ?? globalSettings.injection_budget ?? DEFAULT_INJECTION_BUDGET;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('Pi memory injection budget must be a non-negative integer');

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

  let content = 'Nanomneme memory index:\n';
  let total = 0;
  for (const record of records) {
    const next = `${line(record.store, record.memory)}\n`;
    if (content.length + next.length > limit) break;
    content += next;
    total += 1;
  }
  return { content: content.slice(0, limit), unresolved, total, budget: limit };
}

#!/usr/bin/env node
import { open } from 'nmnm-core';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HELP = `Usage: nmnm <command> [arguments] [options]

Commands:
  retain [content]     Create a memory, or patch one with --id.
  recall <id>          Return one active memory.
  retrieve [query]     Search or list active memories.
  remove <id>          Soft-delete one memory; add --purge to delete permanently.
  verify               Diagnose database integrity without modifying records.
  export               Write all canonical records as JSONL.
  import <file>        Import canonical nanomneme JSONL records.
  repair               Rebuild derived data with --rebuild-fts.

Common options: --db <path> --global --json --version, -v
Retain options: --id --kind note|decision|preference|fact|instruction --scope project|global --namespace <lowercase-slug> --tags <lowercase-slug,...> --importance 0..1 --confidence 0..1 --expires-at <UTC ISO> --metadata <JSON>
Retrieve options: --both --kind note|decision|preference|fact|instruction --scope project|global --namespace <lowercase-slug> --tags <lowercase-slug,...> --expires active|expired|any --importance-gte <n> --importance-lte <n> --confidence-gte <n> --confidence-lte <n> --order-by <field> --limit 1..1000 --offset 0..1000
Remove options: --purge
Export options: --out <file>
Repair options: --rebuild-fts`;

const COMMON_OPTIONS = ['db', 'global', 'json', 'help'];
const COMMAND_OPTIONS = {
  retain: [...COMMON_OPTIONS, 'id', 'kind', 'scope', 'namespace', 'tags', 'importance', 'confidence', 'expires-at', 'metadata'],
  recall: COMMON_OPTIONS,
  retrieve: [...COMMON_OPTIONS, 'both', 'kind', 'scope', 'namespace', 'tags', 'importance-gte', 'importance-lte', 'confidence-gte', 'confidence-lte', 'order-by', 'limit', 'offset', 'expires'],
  remove: [...COMMON_OPTIONS, 'purge'],
  verify: COMMON_OPTIONS,
  export: [...COMMON_OPTIONS, 'out'],
  import: COMMON_OPTIONS,
  repair: [...COMMON_OPTIONS, 'rebuild-fts'],
};
const OPTION_NAMES = new Set(Object.values(COMMAND_OPTIONS).flat());

function parse(args) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (!OPTION_NAMES.has(name)) throw new TypeError(`unknown option: ${argument}`);
    if (name === 'json' || name === 'global' || name === 'both' || name === 'purge' || name === 'rebuild-fts' || name === 'help') {
      options[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (value == null || value.startsWith('--')) throw new TypeError(`${argument} requires a value`);
    options[name] = value;
    index += 1;
  }
  return { options, positionals };
}

function validateCommand(command, positionals, options) {
  if (!COMMAND_OPTIONS[command]) throw new TypeError(`unknown command: ${command}`);
  if (options.purge && command !== 'remove') throw new TypeError('--purge is only valid with remove');
  if (options['rebuild-fts'] && command !== 'repair') throw new TypeError('--rebuild-fts is only valid with repair');
  if (options.out && command !== 'export') throw new TypeError('--out is only valid with export');
  if (command === 'export' && options.json) throw new TypeError('--json is not valid with export');
  if (options.both && command !== 'retrieve') throw new TypeError('--both is only valid with retrieve');
  if (options.both && (options.global || options.db)) throw new TypeError('--both cannot be combined with --global or --db');
  for (const name of Object.keys(options)) {
    if (!COMMAND_OPTIONS[command].includes(name)) throw new TypeError(`--${name} is not valid with ${command}`);
  }
  if (command === 'retain' && positionals.length > 1) throw new TypeError('retain accepts one content argument');
  if (command === 'retain' && !positionals.length && options.id === undefined) throw new TypeError('retain requires content unless --id is supplied');
  if (command === 'retrieve' && positionals.length > 1) throw new TypeError('retrieve accepts one query argument');
  if (command === 'recall' && positionals.length !== 1) throw new TypeError('recall requires an id');
  if (command === 'remove' && positionals.length !== 1) throw new TypeError('remove requires an id');
  if (command === 'import' && positionals.length !== 1) throw new TypeError('import requires one file');
  if (['verify', 'export', 'repair'].includes(command) && positionals.length) throw new TypeError(`${command} does not accept arguments`);
  if (command === 'repair' && !options['rebuild-fts']) throw new TypeError('--rebuild-fts is required for repair');
}

function number(value) {
  return value === undefined ? undefined : value.trim() ? Number(value) : NaN;
}

function json(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(value); } catch { throw new TypeError('metadata must be valid JSON'); }
}

function commaList(value) {
  return value === undefined ? undefined : value.split(',').filter(Boolean);
}

function assign(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function retainInput(positionals, options) {
  const input = {};
  assign(input, 'id', options.id);
  assign(input, 'content', positionals[0]);
  for (const field of ['kind', 'scope', 'namespace']) assign(input, field, options[field]);
  assign(input, 'tags', commaList(options.tags));
  assign(input, 'importance', number(options.importance));
  assign(input, 'confidence', number(options.confidence));
  assign(input, 'expires_at', options['expires-at']);
  assign(input, 'metadata', json(options.metadata));
  if (options.global && options.id === undefined && options.scope === undefined) input.scope = 'global';
  return input;
}

function retrieveInput(positionals, options) {
  const input = {};
  assign(input, 'query', positionals[0]);
  for (const field of ['kind', 'scope', 'namespace']) assign(input, field, options[field]);
  assign(input, 'tags', commaList(options.tags));
  assign(input, 'order_by', options['order-by']);
  assign(input, 'expires', options.expires);
  assign(input, 'limit', number(options.limit));
  assign(input, 'offset', number(options.offset));
  for (const field of ['importance', 'confidence']) {
    const range = {};
    assign(range, 'gte', number(options[`${field}-gte`]));
    assign(range, 'lte', number(options[`${field}-lte`]));
    if (Object.keys(range).length) input[field] = range;
  }
  return input;
}

function readable(value) {
  if (value == null) return 'Not found\n';
  if (value.imported != null) return `Imported: ${value.imported}\n`;
  if (value.exported != null) return `Exported: ${value.exported}\n`;
  if (value.mode === 'rebuild-fts') {
    const status = value.verification.ok ? 'OK' : `Issues: ${value.verification.issues.length}`;
    return `Rebuilt FTS rows: ${value.rebuilt}\nVerification: ${status}\n`;
  }
  if (typeof value.ok === 'boolean' && Array.isArray(value.issues)) {
    if (value.ok) return `OK\nSchema version: ${value.schema_version}\n`;
    const issues = value.issues.map((issue) => `- ${issue.code}: ${issue.count}${issue.ids.length ? ` (${issue.ids.join(', ')})` : ''}`).join('\n');
    return `Issues: ${value.issues.length}\nSchema version: ${value.schema_version}\n${issues}\n`;
  }
  if (Array.isArray(value.items)) {
    const rows = value.items.map((memory) => `${memory.store}  ${memory.id}  ${memory.kind}  ${memory.content}`).join('\n');
    return `Total: ${value.total}${rows ? `\n${rows}` : ''}\n`;
  }
  if (value.purged_at) return `Purged: ${value.id}\nMode: ${value.mode}\nPurged at: ${value.purged_at}\n`;
  if (value.removed_at) return `Removed: ${value.id}\nMode: ${value.mode}\nRemoved at: ${value.removed_at}\n`;
  return [
    `ID: ${value.id}`,
    `Content: ${value.content}`,
    `Kind: ${value.kind}`,
    `Scope: ${value.scope}`,
    `Namespace: ${value.namespace}`,
    `Importance: ${value.importance}`,
    `Confidence: ${value.confidence}`,
    `Tags: ${value.tags.join(', ') || 'none'}`,
    `Expires: ${value.expires_at ?? 'never'}`,
    `Created: ${value.created_at}`,
    `Updated: ${value.updated_at}`,
    `Metadata: ${JSON.stringify(value.metadata)}`,
  ].join('\n') + '\n';
}

function databasePath(options, { create = true } = {}) {
  if (options.global && options.db) throw new TypeError('--global cannot be combined with --db');
  if (!options.global) return options.db ?? resolve('.nanomneme', 'memory.db');
  if (!['darwin', 'linux'].includes(platform())) throw new TypeError('--global is supported only on Linux and macOS; use --db');
  const path = join(homedir(), '.local', 'share', 'nanomneme', 'memory.db');
  if (create) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return path;
}

function databaseStore(options) {
  return options.db ? 'custom' : options.global ? 'global' : 'project';
}

function sameFile(left, right) {
  const leftPath = resolve(left);
  const rightPath = resolve(right);
  if (leftPath === rightPath) return true;
  if (!existsSync(leftPath) || !existsSync(rightPath)) return false;
  const leftStat = statSync(leftPath);
  const rightStat = statSync(rightPath);
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

function writeFileAtomic(path, contents) {
  const output = resolve(path);
  const temporary = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, output);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function exportJsonl(records) {
  return [JSON.stringify({ _format: 'nanomneme', _version: 1 }), ...records.map((record) => JSON.stringify(record))].join('\n') + '\n';
}

function importJsonl(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length) throw new TypeError('import file is empty');
  let header;
  try { header = JSON.parse(lines[0]); } catch { throw new TypeError('import header is invalid JSON'); }
  if (header?._format !== 'nanomneme' || header?._version !== 1) throw new TypeError('import header must identify nanomneme format version 1');
  return lines.slice(1).map((line, index) => {
    if (!line.trim()) throw new TypeError(`import line ${index + 2} is empty`);
    try { return JSON.parse(line); } catch { throw new TypeError(`import line ${index + 2} is invalid JSON`); }
  });
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) return { version: VERSION };
  const { options, positionals } = parse(args);
  const command = positionals.shift();
  if (options.help) return { help: true };
  if (!command && Object.keys(options).length) throw new TypeError('command is required');
  if (!command) return { help: true };
  validateCommand(command, positionals, options);
  const verification = command === 'verify' || command === 'repair';
  const readOnly = command === 'verify' || command === 'export';
  const requiresExisting = verification || readOnly;
  const records = command === 'import' ? importJsonl(positionals[0]) : null;
  if (records) {
    const validationStore = open(':memory:');
    try { validationStore.import(records); } finally { validationStore.close(); }
  }
  if (command === 'retrieve' && options.both) {
    const result = { items: [], total: 0 };
    const input = retrieveInput(positionals, options);
    const validationStore = open(':memory:');
    try { validationStore.retrieve(input); } finally { validationStore.close(); }
    let offset = input.offset ?? 0;
    let remaining = input.limit ?? 20;
    for (const [storeName, path] of [
      ['project', databasePath({}, { create: false })],
      ['global', databasePath({ global: true }, { create: false })],
    ]) {
      if (!existsSync(path)) continue;
      const store = open(path, { create: false });
      try {
        const retrieved = store.retrieve({ ...input, limit: Math.max(remaining, 1), offset });
        result.total += retrieved.total;
        if (remaining) {
          result.items.push(...retrieved.items.map((memory) => ({ store: storeName, ...memory })));
          remaining -= retrieved.items.length;
        }
        offset = Math.max(0, offset - retrieved.total);
      } finally {
        store.close();
      }
    }
    return { result, json: options.json, failed: false };
  }
  const db = databasePath(options, { create: !requiresExisting });
  if (command === 'export' && options.out && sameFile(db, options.out)) throw new TypeError('--out cannot reference the source database');
  const store = open(db, { create: !requiresExisting, readOnly });
  try {
    let result;
    if (command === 'retain') result = store.retain(retainInput(positionals, options));
    else if (command === 'recall') result = store.recall({ id: positionals[0] });
    else if (command === 'retrieve') {
      const retrieved = store.retrieve(retrieveInput(positionals, options));
      result = { ...retrieved, items: retrieved.items.map((memory) => ({ store: databaseStore(options), ...memory })) };
    }
    else if (command === 'remove') result = store.remove({ id: positionals[0], mode: options.purge ? 'purge' : 'soft' });
    else if (command === 'verify') result = store.verify();
    else if (command === 'export') {
      const recordsToExport = store.export();
      const text = exportJsonl(recordsToExport);
      if (options.out) {
        writeFileAtomic(options.out, text);
        result = { exported: recordsToExport.length, path: options.out };
      } else {
        return { raw: text, json: false };
      }
    } else if (command === 'import') {
      result = store.import(records);
    } else if (command === 'repair') {
      result = { ...store.rebuildFts(), verification: store.verify() };
    }
    return { result, json: options.json, failed: verification && !(result.verification ?? result).ok };
  } finally {
    store.close();
  }
}

try {
  const output = main();
  if (output.version) process.stdout.write(`${output.version}\n`);
  else if (output.raw) process.stdout.write(output.raw);
  else process.stdout.write(output.help ? `${HELP}\n` : output.json ? `${JSON.stringify(output.result, null, 2)}\n` : readable(output.result));
  if (output.failed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`nmnm: ${error.message}\n`);
  process.exitCode = 1;
}

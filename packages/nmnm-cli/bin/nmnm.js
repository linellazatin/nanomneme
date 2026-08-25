#!/usr/bin/env node
import { open } from 'nmnm-core';
import { mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const HELP = `Usage: nmnm <command> [arguments] [options]

Commands:
  retain [content]     Create a memory, or patch one with --id.
  recall <id>          Return one active memory.
  retrieve [query]     Search or list active memories.
  remove <id>          Soft-delete one memory; add --purge to delete permanently.

Common options: --db <path> --global --json
Retain options: --id --kind note|decision|preference|fact|instruction --scope project|global --namespace <lowercase-slug> --tags <lowercase-slug,...> --importance 0..1 --confidence 0..1 --expires-at <UTC ISO> --metadata <JSON>
Retrieve options: --kind note|decision|preference|fact|instruction --scope project|global --namespace <lowercase-slug> --tags <lowercase-slug,...> --expires active|expired|any --importance-gte <n> --importance-lte <n> --confidence-gte <n> --confidence-lte <n> --order-by <field> --limit <n> --offset <n>`;

const OPTION_NAMES = new Set([
  'db', 'json', 'id', 'kind', 'scope', 'namespace', 'tags', 'importance', 'confidence',
  'expires-at', 'metadata', 'importance-gte', 'importance-lte', 'confidence-gte', 'confidence-lte',
  'order-by', 'limit', 'offset', 'expires', 'global', 'purge', 'help',
]);

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
    if (name === 'json' || name === 'global' || name === 'purge' || name === 'help') {
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

function number(value) {
  return value === undefined ? undefined : Number(value);
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
  if (positionals.length > 1) throw new TypeError('retain accepts one content argument');
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
  if (positionals.length > 1) throw new TypeError('retrieve accepts one query argument');
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
  if (Array.isArray(value.items)) {
    const rows = value.items.map((memory) => `${memory.id}  ${memory.kind}  ${memory.content}`).join('\n');
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

function databasePath(options) {
  if (options.global && options.db) throw new TypeError('--global cannot be combined with --db');
  if (!options.global) return options.db ?? resolve('.nanomneme', 'memory.db');
  if (!['darwin', 'linux'].includes(platform())) throw new TypeError('--global is supported only on Linux and macOS; use --db');
  const path = join(homedir(), '.local', 'share', 'nanomneme', 'memory.db');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return path;
}

export function main(args = process.argv.slice(2)) {
  const { options, positionals } = parse(args);
  const command = positionals.shift();
  if (options.help || !command) return { help: true };
  if (options.purge && command !== 'remove') throw new TypeError('--purge is only valid with remove');
  const db = databasePath(options);
  const store = open(db);
  try {
    let result;
    if (command === 'retain') result = store.retain(retainInput(positionals, options));
    else if (command === 'recall') {
      if (positionals.length !== 1) throw new TypeError('recall requires an id');
      result = store.recall({ id: positionals[0] });
    } else if (command === 'retrieve') result = store.retrieve(retrieveInput(positionals, options));
    else if (command === 'remove') {
      if (positionals.length !== 1) throw new TypeError('remove requires an id');
      result = store.remove({ id: positionals[0], mode: options.purge ? 'purge' : 'soft' });
    } else throw new TypeError(`unknown command: ${command}`);
    return { result, json: options.json };
  } finally {
    store.close();
  }
}

try {
  const output = main();
  process.stdout.write(output.help ? `${HELP}\n` : output.json ? `${JSON.stringify(output.result, null, 2)}\n` : readable(output.result));
} catch (error) {
  process.stderr.write(`nmnm: ${error.message}\n`);
  process.exitCode = 1;
}

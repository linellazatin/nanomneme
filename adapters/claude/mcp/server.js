#!/usr/bin/env node
// Local stdio MCP server: exposes the nanomneme 4Rs as native, observable tools that
// import nmnm-core directly (no daemon, no network, no CLI-stdout parsing). Claude Code
// spawns this as a child process and sets NMNM_PROJECT_DIR to the project root.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { handleTool } from '../src/operations.js';

const ctx = { cwd: process.env.NMNM_PROJECT_DIR || process.cwd() };
const storeParam = z.enum(['project', 'global']).optional();

const server = new McpServer({ name: 'nanomneme', version: '0.1.0' });

function register(name, description, shape) {
  server.registerTool(name, { description, inputSchema: shape }, async (args) => handleTool(name, args ?? {}, ctx));
}

register('retain_memory', 'Create or explicitly patch a nanomneme memory. Prefer project store unless the fact clearly applies to all projects (then store: global).', {
  content: z.string().optional(),
  id: z.string().optional(),
  store: storeParam,
  kind: z.string().optional(),
  scope: z.string().optional(),
  namespace: z.string().optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().optional(),
  confidence: z.number().optional(),
  expires_at: z.union([z.string(), z.null()]).optional(),
  metadata: z.any().optional(),
});

register('recall_memory', 'Read one active nanomneme memory by ID.', {
  id: z.string(),
  store: storeParam,
});

register('retrieve_memory', 'Search or list active nanomneme memories.', {
  query: z.string().optional(),
  store: storeParam,
  kind: z.string().optional(),
  scope: z.string().optional(),
  namespace: z.string().optional(),
  tags: z.array(z.string()).optional(),
  expires: z.string().optional(),
  importance: z.any().optional(),
  confidence: z.any().optional(),
  order_by: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

register('remove_memory', 'Soft-remove a nanomneme memory by ID (reversible; purge is CLI-only).', {
  id: z.string(),
  store: storeParam,
});

const transport = new StdioServerTransport();
await server.connect(transport);

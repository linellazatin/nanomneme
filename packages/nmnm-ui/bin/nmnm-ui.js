#!/usr/bin/env node
import { launchWorkbench } from '../src/launcher.js';

try { await launchWorkbench(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }

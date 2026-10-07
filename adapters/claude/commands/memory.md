---
description: Run deterministic nanomneme memory management (status, list, search, show, pin, unpin, remove), then relay the output verbatim.
argument-hint: [status|list|search|show|pin|unpin|remove] [args] [--source all|claude-code]
allowed-tools: Bash(node:*)
---

The following block is the verbatim output of the deterministic nanomneme memory script. The script uses no model; this command relays its output through the model:

!`node --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/memory.js" $ARGUMENTS`

Relay that output to the user exactly as printed. Do not summarize, reformat, or add commentary. If the block shows a usage message, present it unchanged.

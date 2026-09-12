---
description: Show or manage nanomneme memory deterministically (status, list, search, show, pin, unpin, remove) without model reasoning.
argument-hint: [status|list|search|show|pin|unpin|remove] [args]
allowed-tools: Bash(node:*)
---

The following block is the verbatim output of the deterministic nanomneme memory command
(no model reasoning produced it):

!`node --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/memory.js" $ARGUMENTS`

Relay that output to the user exactly as printed. Do not summarize, reformat, or add
commentary. If the block shows a usage message, present it unchanged.

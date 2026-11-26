// Bun-safe lifecycle routing. SQLite, validation and policy stay in the Node bridge.
import { realpathSync } from 'node:fs';
import { runBridge } from './bridge-client.js';

const sameDirectory = (a, b) => {
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
};
const bounded = text => typeof text === 'string' && Buffer.byteLength(text) <= 1048576;

export function createCaptureHooksV1(ctx) {
  const pending = new Map();
  return {
    dispose() { pending.clear(); },
    async 'experimental.session.compacting'({ sessionID }, output) {
      pending.delete(sessionID);
      const prepared = runBridge({ op: 'capture_prepare', ctx });
      if (!prepared.ok || prepared.status !== 'prepared') return;
      pending.set(sessionID, { capture: prepared.capture });
      output.context.push(prepared.instructions);
    },
    async 'experimental.text.complete'({ sessionID, messageID }, output) {
      const state = pending.get(sessionID);
      if (!state || state.messageID !== messageID) return;
      if (!bounded(output.text)) { pending.delete(sessionID); return; }
      state.text = output.text;
    },
    async event({ event }) {
      const info = event.properties?.info;
      const sessionID = info?.sessionID ?? event.properties?.sessionID;
      const state = pending.get(sessionID);
      if (!state) return;
      if (event.type === 'session.error' || event.type === 'session.deleted') { pending.delete(sessionID); return; }
      if (event.type === 'message.updated' && info?.summary === true && info.role === 'assistant') {
        if (!sameDirectory(info.path?.cwd, ctx.cwd) || info.error || (state.messageID && state.messageID !== info.id)) { pending.delete(sessionID); return; }
        state.messageID = info.id;
        state.completed = Boolean(info.time?.completed && info.finish === 'stop');
      }
      if (event.type !== 'session.compacted') return;
      pending.delete(sessionID);
      if (state.completed && bounded(state.text)) runBridge({ op: 'capture_complete', ctx, capture: state.capture, text: state.text });
    },
  };
}

export async function registerCaptureV2(api, contextForSession) {
  const pending = new Map(), controller = new AbortController();
  const availability = { supported: true, reason: 'Requires completed plain-text checkpoints' };
  let hook, task;
  try {
    if (typeof api.event?.subscribe !== 'function') return { supported: false, reason: 'Live compaction events unavailable', dispose() {} };
    hook = await api.session.hook('compaction', async event => {
      pending.delete(event.sessionID);
      if (!availability.supported) return;
      try {
        const ctx = await contextForSession(api, event.sessionID);
        const prepared = runBridge({ op: 'capture_prepare', ctx });
        if (!prepared.ok || prepared.status !== 'prepared') return;
        pending.set(event.sessionID, { ctx, capture: prepared.capture });
        event.system.push({ type: 'text', text: prepared.instructions });
      } catch { /* Capture must never block a model request. */ }
    });
    // Consume only live completion events, never session history or provider streams.
    const events = api.event.subscribe({ types: ['session.compaction.ended', 'session.compaction.failed'], signal: controller.signal });
    task = (async () => {
      try {
        for await (const event of events) {
          if (!['session.compaction.ended', 'session.compaction.failed'].includes(event.type)) continue;
          const state = pending.get(event.data?.sessionID);
          if (!state) continue;
          pending.delete(event.data.sessionID);
          if (event.type !== 'session.compaction.ended' || !bounded(event.data.text) || !sameDirectory(event.location?.directory, state.ctx.cwd)) continue;
          try {
            const current = await contextForSession(api, event.data.sessionID);
            if (!sameDirectory(current.cwd, state.ctx.cwd)) continue;
            runBridge({ op: 'capture_complete', ctx: state.ctx, capture: state.capture, text: event.data.text });
          } catch { /* An unavailable or moved session cannot redirect a capture. */ }
        }
      } catch { /* A disconnected event stream disables capture. */ }
      finally { pending.clear(); availability.supported = false; availability.reason = 'Live compaction event stream ended'; }
    })();
    return Object.assign(availability, { async dispose() { controller.abort(); pending.clear(); await hook.dispose(); await task; } });
  } catch {
    controller.abort(); pending.clear(); if (hook) await hook.dispose();
    return { supported: false, reason: 'Compaction hook unavailable', dispose() {} };
  }
}

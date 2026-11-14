import type { JsonObject } from '@alpha/adk/core';
import { maxArtifactBytes } from '@alpha/adk-artifact';
import type { CodingContext, CommandOutcome } from './contracts';
import { byteLength, clip, codeOf } from './internal';

export function captureCommandArtifacts(context: CodingContext, runId: string, assistantId: string, callId: string) {
  const options = context.artifacts;
  const max = options?.maxOutputBytes ?? maxArtifactBytes;
  const channels = {
    stdout: { text: '', bytes: 0, truncated: false },
    stderr: { text: '', bytes: 0, truncated: false },
  };
  return {
    capture(channel: 'stdout' | 'stderr', text: string) {
      if (!options) return;
      const state = channels[channel];
      if (state.truncated) return;
      const retained = clip(text, Math.max(0, max - state.bytes));
      state.truncated = retained.length < text.length;
      state.bytes += byteLength(retained); state.text += retained;
    },
    async save(outcome: CommandOutcome): Promise<JsonObject> {
      if (!options || outcome.status === 'not_started') return {};
      const artifacts: Record<string, JsonObject> = {};
      let error: string | undefined;
      for (const channel of ['stdout', 'stderr'] as const) {
        const state = channels[channel];
        try {
          const saved = await options.store.put(options.scope, { content: state.text,
            complete: !state.truncated && outcome.status === 'exited' && !outcome.outputIncomplete,
            source: { runId, assistantId, callId, channel } });
          artifacts[channel] = { reference: saved.reference, bytes: saved.bytes, complete: saved.complete };
        } catch (cause) { error = codeOf(cause, 'ARTIFACT_SAVE_FAILED'); }
        finally { state.text = ''; }
      }
      return { artifacts, artifactStorage: error
        ? { status: Object.keys(artifacts).length ? 'partial' : 'failed', code: error }
        : { status: 'saved' } };
    },
  };
}

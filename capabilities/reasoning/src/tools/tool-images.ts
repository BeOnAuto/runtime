import type { RunContext } from '@on.auto/definitions';
import type { KeepImage } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { KeepRunImage } from '../steps/kept-content.ts';

export function imagesKeptOn(keep: KeepRunImage, run: RunContext): KeepImage {
  const playbook = { org: run.org, playbook: run.playbook };
  const context = {
    by: run.caller.id,
    runId: run.id,
    definitionType: 'reasoning',
    definitionName: run.definition.name,
    definitionVersion: run.definition.version,
  };
  const lineage = { causationId: run.lineage.startId, correlationId: run.lineage.correlationId };
  return (bytes, call) => Effect.runPromise(keep({ playbook, bytes, call, context, lineage }));
}

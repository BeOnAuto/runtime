import { Context } from 'effect';

import { CallLineage } from '../caller/call-lineage.ts';
import { Caller } from '../caller/caller.ts';
import { PlaybookContext } from '../caller/playbook-context.ts';
import { PlaybookLifecycle } from '../caller/playbook-lifecycle.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import { playbookReaderOf, playbookWriterOf } from '../ledger/playbook-ledger.ts';
import { PlaybookReader } from '../ledger/playbook-reader.ts';
import { PlaybookWriter } from '../ledger/playbook-writer.ts';
import type { PlaybookRequest } from './request.ts';

export interface PlaybookBinding {
  readonly ledger: LedgerPorts;
  readonly lifecycle: PlaybookLifecycle['Service'];
}

export function playbookServicesOf(
  { caller, org, playbook, lineage, depth, callDepth, calledBy, trigger, attemptDied }: PlaybookRequest,
  { ledger, lifecycle }: PlaybookBinding,
) {
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(PlaybookContext, { org, playbook }),
    Context.add(PlaybookLifecycle, lifecycle),
    Context.add(PlaybookReader, playbookReaderOf(ledger, { org, playbook })),
  );
  const forCommands = forQueries.pipe(
    Context.add(PlaybookWriter, playbookWriterOf(ledger, { org, playbook })),
    Context.add(CallLineage, {
      lineage: lineage ?? null,
      depth: depth ?? 0,
      callDepth: callDepth ?? 0,
      calledBy: calledBy ?? null,
      trigger: trigger ?? null,
      attemptDied: attemptDied === true,
    }),
  );
  return { forQueries, forCommands };
}

import { Context } from 'effect';

import { CallLineage } from '../caller/call-lineage.ts';
import { Caller } from '../caller/caller.ts';
import { PlaybookContext } from '../caller/playbook-context.ts';
import { PlaybookLifecycle } from '../caller/playbook-lifecycle.ts';
import {
  playbookBoundProjectionReader,
  playbookBoundRecordedReader,
  playbookBoundRunOutcomesReader,
  prefixedAges,
  prefixedReader,
  prefixedWriter,
  streamPrefixOfPlaybook,
} from '../ledger/bound-ports.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
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
  const prefix = streamPrefixOfPlaybook({ org, playbook });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(PlaybookContext, { org, playbook }),
    Context.add(PlaybookLifecycle, lifecycle),
    Context.add(PlaybookReader, {
      ...prefixedReader(ledger, prefix),
      ...prefixedAges(ledger, prefix),
      ...playbookBoundRecordedReader(ledger, { org, playbook }),
      ...playbookBoundRunOutcomesReader(ledger, { org, playbook }),
      ...playbookBoundProjectionReader(ledger, { org, playbook }),
      readContent: (sha256) => ledger.content.get({ org, playbook }, sha256),
    }),
  );
  const forCommands = forQueries.pipe(
    Context.add(PlaybookWriter, prefixedWriter(ledger, prefix)),
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

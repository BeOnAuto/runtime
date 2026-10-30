import { Context, Effect } from 'effect';

import { Caller } from '../caller/caller.ts';
import { OrgContext } from '../caller/org-context.ts';
import type { Runnable } from '../definition/registration.ts';
import {
  orgBoundAppendedFactsReader,
  prefixedReader,
  prefixedWriter,
  streamPrefixOfOrg,
} from '../ledger/bound-ports.ts';
import { OrgReader } from '../ledger/org-reader.ts';
import { OrgWriter } from '../ledger/org-writer.ts';
import type { AppendedFactsReader, StreamReader, StreamWriter } from '../ledger/stream-ports.ts';
import type { Succeeded, Rejected } from '../outcome/outcome.ts';
import type { OrgRequest } from './request.ts';

export function runInOrg<A extends Succeeded>(
  registration: Runnable<'org', A>,
  { caller, org, input, encoding, body }: OrgRequest,
  ledger: StreamReader & StreamWriter & AppendedFactsReader,
): Effect.Effect<A, Rejected> {
  const prefix = streamPrefixOfOrg({ org });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(OrgContext, { org }),
    Context.add(OrgReader, { ...prefixedReader(ledger, prefix), ...orgBoundAppendedFactsReader(ledger, { org }) }),
  );
  return registration.kind === 'query'
    ? registration.run(input, encoding, body).pipe(Effect.provideContext(forQueries))
    : registration
        .run(input, encoding, body)
        .pipe(Effect.provideContext(forQueries.pipe(Context.add(OrgWriter, prefixedWriter(ledger, prefix)))));
}

import type { AppRuntime } from '@on.auto/api';
import type { SubjectPages } from '@on.auto/definitions/page';
import {
  Caller,
  Ledger,
  playbookLedgerOf,
  type DispatcherServices,
  type PlaybookAddress,
  type PlaybookReader,
  type PlaybookWriter,
} from '@on.auto/operations';
import type { PlaybookPage, PlaybookPages } from '@on.auto/playbooks';
import { Effect } from 'effect';

import { inRuntime } from '../workflows/in-runtime.ts';

function shownOf(page: { readonly source: string } | undefined): PlaybookPage | undefined {
  return page === undefined ? undefined : { source: page.source };
}

export function playbookPagesServedBy(runtime: AppRuntime<DispatcherServices>, pages: SubjectPages): PlaybookPages {
  const inThePlaybook = <A, E>(address: PlaybookAddress, work: Effect.Effect<A, E, PlaybookReader | PlaybookWriter>) =>
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (ledger) =>
        Effect.provideContext(work, playbookLedgerOf(ledger, address)),
      ),
    );
  return {
    pageOf: (address) => Effect.map(inThePlaybook(address, pages.playbookPageOf()), shownOf),
    save: (address, source) =>
      Effect.gen(function* () {
        const content = source === null ? null : yield* pages.check(source, 'playbook');
        const caller = yield* Caller;
        const saving = source === null || content === null || content === undefined ? null : { source, content };
        const saved = yield* inThePlaybook(
          address,
          Effect.provideService(pages.savePlaybookPage(saving), Caller, caller),
        );
        return shownOf(saved);
      }),
  };
}

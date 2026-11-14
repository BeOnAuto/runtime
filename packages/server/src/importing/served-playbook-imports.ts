import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import {
  importChecked,
  importCopied,
  playbookImportIn,
  playbookImportStepped,
  type ImportPlan,
  type ImportServers,
} from '@on.auto/definitions/importing';
import type { SubjectPages } from '@on.auto/definitions/page';
import { Caller, PlaybookContext, type DispatcherServices } from '@on.auto/operations';
import type { PlaybookImports } from '@on.auto/playbooks';
import { Effect } from 'effect';

import { inThePlaybookOf } from '../composition/served-playbook-pages.ts';

interface ImportedInto {
  readonly capabilities: readonly Capability[];
  readonly pages: SubjectPages;
  readonly servers: ImportServers;
  readonly offers: (model: string) => boolean;
}

export function playbookImportsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { capabilities, pages, servers, offers }: ImportedInto,
): PlaybookImports<ImportPlan> {
  const inThePlaybook = inThePlaybookOf(runtime);
  const checked = importChecked({ capabilities, pages, servers, offers });
  const copied = importCopied(capabilities, pages);
  return {
    check: (address, written) =>
      inThePlaybook(address, Effect.provideService(checked(written), PlaybookContext, address)),
    standing: (address) => inThePlaybook(address, playbookImportIn),
    start: (address, mark) =>
      Effect.gen(function* () {
        const caller = yield* Caller;
        yield* inThePlaybook(address, Effect.provideService(playbookImportStepped('start', mark), Caller, caller));
      }),
    copy: (address, { definitions }, mark) =>
      Effect.gen(function* () {
        const caller = yield* Caller;
        yield* inThePlaybook(
          address,
          copied(definitions, mark).pipe(
            Effect.catchTag('not_found', Effect.die),
            Effect.provideService(PlaybookContext, address),
            Effect.provideService(Caller, caller),
          ),
        );
      }),
  };
}

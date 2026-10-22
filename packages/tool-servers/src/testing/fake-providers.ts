import type { Issue } from '@on.auto/operations';
import { Result } from 'effect';

import type { ProviderNamed, ProviderResolver } from '../settings/provider-entries.ts';
import type { ServerEntryFields } from '../settings/server-entries.ts';
import type { DocumentsPlace } from '../settings/server-settings.ts';

export type FakeProvider = (named: ProviderNamed) => ServerEntryFields | { readonly refused: readonly Issue[] };

export interface FakeProviders {
  readonly resolver: ProviderResolver;
  readonly named: () => readonly ProviderNamed[];
}

const credentialHeader = '/headers/Authorization';

function placedValuesOf({ credential }: ProviderNamed): ReadonlyMap<string, string> {
  return new Map(credential.client_id === undefined ? [] : [['client_id', credential.client_id]]);
}

const inTheWorkingDirectory: DocumentsPlace = { kind: 'directory', path: process.cwd() };

export function fakeProviders(
  providers: ReadonlyMap<string, FakeProvider>,
  documents: DocumentsPlace = inTheWorkingDirectory,
): FakeProviders {
  const named: ProviderNamed[] = [];
  return {
    resolver: (asked) => {
      named.push(asked);
      const provider = providers.get(asked.provider);
      if (provider === undefined) {
        return Result.fail([{ pointer: '/provider', detail: `There is no fake provider named ${asked.provider}` }]);
      }
      const resolved = provider(asked);
      return 'refused' in resolved
        ? Result.fail(resolved.refused)
        : Result.succeed({
            written: resolved,
            placedValues: placedValuesOf(asked),
            documents,
            writtenAt: (pointer) => (pointer === credentialHeader ? '/credential/value' : '/provider'),
          });
    },
    named: () => [...named],
  };
}

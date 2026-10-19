import type { Issue } from '@on.auto/operations';
import { Result } from 'effect';

import type { ProviderNamed, ProviderResolver } from '../settings/provider-entries.ts';
import type { ServerEntryFields } from '../settings/server-entries.ts';

export type FakeProvider = (named: ProviderNamed) => ServerEntryFields | { readonly refused: readonly Issue[] };

export interface FakeProviders {
  readonly resolver: ProviderResolver;
  readonly named: () => readonly ProviderNamed[];
}

const credentialHeader = '/headers/Authorization';

function placedValuesOf({ credential }: ProviderNamed): ReadonlyMap<string, string> {
  return new Map(credential.client_id === undefined ? [] : [['client_id', credential.client_id]]);
}

export function fakeProviders(
  providers: ReadonlyMap<string, FakeProvider>,
  documentsDirectory: string = process.cwd(),
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
            documentsDirectory,
            writtenAt: (pointer) => (pointer === credentialHeader ? '/credential/value' : '/provider'),
          });
    },
    named: () => [...named],
  };
}

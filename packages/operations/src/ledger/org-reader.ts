import { Context, Effect } from 'effect';

import type { OrgAddress } from '../caller/org-context.ts';
import type { HeldName } from '../definition-names/name-judgement.ts';
import type { EntitiesRead, EntitiesReader } from '../entities/entity-kind.ts';
import type { OrgProjectionReader } from '../projections/keyed-projection.ts';
import {
  orgBoundAppendedFactsReader,
  orgBoundProjectionReader,
  prefixedReader,
  streamPrefixOfOrg,
  streamPrefixOfPlaybook,
} from './bound-ports.ts';
import type { LedgerPorts } from './ledger.ts';
import type { OrgAppendedFactsReader, StreamReader } from './stream-ports.ts';

export interface OrgDefinitionsReader {
  readonly namesHeldInPlaybook: (playbook: string, definitionType: string) => Effect.Effect<readonly HeldName[]>;
}

export class OrgReader extends Context.Service<
  OrgReader,
  StreamReader & OrgAppendedFactsReader & OrgProjectionReader & OrgDefinitionsReader & EntitiesReader
>()('@on.auto/operations/OrgReader') {}

export function orgReaderOver(ledger: LedgerPorts, { org }: OrgAddress): OrgReader['Service'] {
  const readHere: EntitiesRead = (kind, keys, asked) =>
    ledger.readTogether(kind.read(keys, asked).pipe(Effect.provideService(OrgReader, reader)));
  const readEntities: EntitiesRead = (kind, keys, asked) => {
    if (keys.length === 0) {
      return Effect.succeed([]);
    }
    const across = ledger.readEntitiesAcross;
    return across === undefined ? readHere(kind, keys, asked) : across(kind, { org }, keys, asked);
  };
  const reader: OrgReader['Service'] = {
    ...prefixedReader(ledger, streamPrefixOfOrg({ org })),
    ...orgBoundAppendedFactsReader(ledger, { org }),
    ...orgBoundProjectionReader(ledger, { org }),
    namesHeldInPlaybook: (playbook, definitionType) =>
      ledger.namesHeldIn({ playbookKey: streamPrefixOfPlaybook({ org, playbook }), definitionType }),
    readEntities,
  };
  return reader;
}

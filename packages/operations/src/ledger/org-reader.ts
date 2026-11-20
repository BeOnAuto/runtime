import { Context, type Effect } from 'effect';

import type { HeldName } from '../definition-names/name-judgement.ts';
import type { OrgProjectionReader } from '../projections/keyed-projection.ts';
import type { OrgAppendedFactsReader, StreamReader } from './stream-ports.ts';

export interface OrgDefinitionsReader {
  readonly namesHeldInPlaybook: (playbook: string, definitionType: string) => Effect.Effect<readonly HeldName[]>;
}

export class OrgReader extends Context.Service<
  OrgReader,
  StreamReader & OrgAppendedFactsReader & OrgProjectionReader & OrgDefinitionsReader
>()('@on.auto/operations/OrgReader') {}

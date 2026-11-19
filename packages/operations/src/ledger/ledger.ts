import type { RecordedContent } from '@on.auto/content';
import { Context, type Effect } from 'effect';

import type { HeldName, NameInAPlaybook, NamesOfAKind, StreamInAPlaybook } from '../definition-names/name-judgement.ts';
import type { UnheldContentRemover } from '../held-content/unheld-removal.ts';
import type { ProjectionAdvancer, ProjectionReader } from '../projections/keyed-projection.ts';
import type { RunIdInAnOrg } from '../run-ids/run-ids.ts';
import type { FactScrubber } from './fact-scrub.ts';
import type {
  AppendedFactsReader,
  MultiStreamWriter,
  RecordedReader,
  RunOutcomesReader,
  StreamAges,
  StreamReader,
  StreamWriter,
} from './stream-ports.ts';

interface DefinitionNamesReader {
  readonly holderOfName: (named: NameInAPlaybook) => Effect.Effect<HeldName | undefined>;
  readonly nameHeldBy: (definitionKey: string) => Effect.Effect<HeldName | undefined>;
  readonly namesHeldIn: (kind: NamesOfAKind) => Effect.Effect<readonly HeldName[]>;
  readonly holderOfStream: (named: StreamInAPlaybook) => Effect.Effect<string | undefined>;
}

interface RunIdsReader {
  readonly holderOfRunId: (claimed: RunIdInAnOrg) => Effect.Effect<string | undefined>;
}

export interface ContentKeeper {
  readonly content: RecordedContent;
}

export type LedgerPorts = StreamReader &
  StreamAges &
  StreamWriter &
  MultiStreamWriter &
  DefinitionNamesReader &
  RunIdsReader &
  FactScrubber &
  RecordedReader &
  AppendedFactsReader &
  RunOutcomesReader &
  ProjectionReader &
  ProjectionAdvancer &
  ContentKeeper &
  UnheldContentRemover;

export class Ledger extends Context.Service<Ledger, LedgerPorts>()('@on.auto/operations/Ledger') {}

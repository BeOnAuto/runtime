import { Context } from 'effect';

import type { RecordedContent } from '../content/recorded-content.ts';
import type { ProjectionAdvancer, ProjectionReader } from '../projections/keyed-projection.ts';
import type {
  AppendedFactsReader,
  RecordedReader,
  RunOutcomesReader,
  StreamAges,
  StreamReader,
  StreamWriter,
} from './stream-ports.ts';

export interface ContentKeeper {
  readonly content: RecordedContent;
}

export type LedgerPorts = StreamReader &
  StreamAges &
  StreamWriter &
  RecordedReader &
  AppendedFactsReader &
  RunOutcomesReader &
  ProjectionReader &
  ProjectionAdvancer &
  ContentKeeper;

export class Ledger extends Context.Service<Ledger, LedgerPorts>()('@on.auto/operations/Ledger') {}

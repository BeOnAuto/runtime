import type { RecordedContent } from '@on.auto/content';
import { Context } from 'effect';

import type { UnheldContentRemover } from '../held-content/unheld-removal.ts';
import type { ProjectionAdvancer, ProjectionReader } from '../projections/keyed-projection.ts';
import type { FactScrubber } from './fact-scrub.ts';
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
  FactScrubber &
  RecordedReader &
  AppendedFactsReader &
  RunOutcomesReader &
  ProjectionReader &
  ProjectionAdvancer &
  ContentKeeper &
  UnheldContentRemover;

export class Ledger extends Context.Service<Ledger, LedgerPorts>()('@on.auto/operations/Ledger') {}

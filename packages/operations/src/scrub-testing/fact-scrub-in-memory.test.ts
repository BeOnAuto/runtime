import { definitionsPlaced } from '../projections-testing/definition-rows-behaviour.ts';
import { memoryLedgerWith } from '../testing/memory-ledger.ts';
import { factScrubBehaviour } from './fact-scrub-behaviour.ts';

factScrubBehaviour({
  aLedger: (projections, runOutcomes) =>
    Promise.resolve(memoryLedgerWith({ runOutcomes, projections, definitionNames: definitionsPlaced }).service),
});

import { memoryLedger } from '../testing/memory-ledger.ts';
import { factScrubBehaviour } from './fact-scrub-behaviour.ts';

factScrubBehaviour({
  aLedger: (projections, runOutcomes) => Promise.resolve(memoryLedger(runOutcomes, projections).service),
});

import { appendedFactsBehaviour } from '../changes-testing/appended-facts-behaviour.ts';
import { memoryLedger } from './memory-ledger.ts';

appendedFactsBehaviour({ aLedger: () => Promise.resolve(memoryLedger().service) });

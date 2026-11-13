import { contentBehaviour } from '../content/content-behaviour.ts';
import { storedContextBehaviour } from '../context/stored-context-behaviour.ts';
import { recordedKeysBehaviour } from '../keys/recorded-keys-behaviour.ts';
import { layoutStepsBehaviour } from '../layout/steps-in-code-behaviour.ts';
import { projectionTableBehaviour } from '../projections/projection-table-behaviour.ts';
import { commandsBehaviour } from './commands-behaviour.ts';
import { eventsBehaviour } from './events-behaviour.ts';
import { aLedger, type LedgerEntry } from './ledger-entry.ts';
import { recordedBehaviour } from './recorded-behaviour.ts';
import { storeBehaviour } from './store-behaviour.ts';

export function ledgerBehaviour(entry: LedgerEntry): void {
  commandsBehaviour(entry);
  eventsBehaviour(entry);
  storeBehaviour(entry);
  layoutStepsBehaviour(entry);
  recordedBehaviour(() => aLedger(entry));
  recordedKeysBehaviour(entry);
  projectionTableBehaviour(entry);
  storedContextBehaviour(entry);
  contentBehaviour(entry);
}

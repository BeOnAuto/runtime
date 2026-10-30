import { contentBehaviour } from '../content/content-behaviour.ts';
import { storedContextBehaviour } from '../context/stored-context-behaviour.ts';
import { definitionStreamsBehaviour } from '../definitions/definition-streams-behaviour.ts';
import { ledgerLayoutBehaviour } from '../layout/ledger-layout-behaviour.ts';
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
  ledgerLayoutBehaviour(entry);
  definitionStreamsBehaviour(entry);
  recordedBehaviour(() => aLedger(entry));
  projectionTableBehaviour(entry);
  storedContextBehaviour(entry);
  contentBehaviour(entry);
}

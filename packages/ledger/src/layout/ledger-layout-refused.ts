import { Data } from 'effect';

interface RefusedLayout {
  readonly found: number | undefined;
  readonly kept: number;
  readonly floor: number;
}

export class LedgerLayoutRefused extends Data.TaggedError('ledger_layout_refused')<
  RefusedLayout & { readonly message: string }
> {}

function whatWasFound(found: number | undefined): string {
  return found === undefined
    ? "The ledger's database holds tables of the ledger but no layout number"
    : `The ledger's database is in layout ${found} of the ledger`;
}

function whatToDo(found: number | undefined, kept: number): string {
  return found !== undefined && found > kept
    ? 'Upgrades go forward only, and a newer database wants a newer release of the server'
    : 'A database older than that is not carried forward, so delete the local database and start the server again';
}

export function ledgerLayoutRefused({ found, kept, floor }: RefusedLayout): LedgerLayoutRefused {
  return new LedgerLayoutRefused({
    found,
    kept,
    floor,
    message: `${whatWasFound(found)}, where this server keeps layout ${kept} and carries forward no database older than layout ${floor}. ${whatToDo(found, kept)}`,
  });
}

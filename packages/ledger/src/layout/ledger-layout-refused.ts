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
    ? 'Upgrades go forward only. Open this database with the release that upgraded it, or a compatible later release'
    : 'This release cannot migrate this older database. Keep a backup; to start fresh, use a separate empty database';
}

export function ledgerLayoutRefused({ found, kept, floor }: RefusedLayout): LedgerLayoutRefused {
  return new LedgerLayoutRefused({
    found,
    kept,
    floor,
    message: `${whatWasFound(found)}, where this server keeps layout ${kept} and carries forward no database older than layout ${floor}. ${whatToDo(found, kept)}`,
  });
}

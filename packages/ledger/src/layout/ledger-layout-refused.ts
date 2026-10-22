import { Data } from 'effect';

interface RefusedLayout {
  readonly found: number | undefined;
  readonly kept: number;
}

export class LedgerLayoutRefused extends Data.TaggedError('ledger_layout_refused')<
  RefusedLayout & { readonly message: string }
> {}

const whatToDo =
  'Nothing stored before launch is carried over, so delete the local database and start the server again';

function whatWasFound(found: number | undefined): string {
  return found === undefined
    ? "The ledger's database holds tables but no layout number of the ledger"
    : `The ledger's database is in layout ${found} of the ledger`;
}

export function ledgerLayoutRefused({ found, kept }: RefusedLayout): LedgerLayoutRefused {
  return new LedgerLayoutRefused({
    found,
    kept,
    message: `${whatWasFound(found)}, where this server keeps layout ${kept}. ${whatToDo}`,
  });
}

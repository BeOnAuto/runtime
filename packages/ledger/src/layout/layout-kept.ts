import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { FoundLayout, LayoutDialect } from './layout-dialects.ts';
import { ledgerLayoutRefused } from './ledger-layout-refused.ts';
import { ledgerLayout } from './ledger-layout.ts';

function isNew({ layout, tables }: FoundLayout): boolean {
  return layout === undefined && tables === 0;
}

export async function requireTheLayoutKept(execute: StatementExecutor, dialect: LayoutDialect): Promise<void> {
  const found = await dialect.found(execute);
  if (found.layout === ledgerLayout) {
    return;
  }
  if (!isNew(found)) {
    throw ledgerLayoutRefused({ found: found.layout, kept: ledgerLayout });
  }
  await inTurn(dialect.written(ledgerLayout), (statement) => execute.command(statement));
}

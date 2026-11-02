import { statement } from '../connection/statement.ts';
import type { LayoutStep } from './layout-steps.ts';

export const ledgerLayoutSteps: readonly LayoutStep[] = [
  {
    layout: 7,
    statements: [
      statement`DROP TABLE IF EXISTS staged_content_chunks`,
      statement`DROP TABLE IF EXISTS staged_content`,
      statement`DROP TABLE IF EXISTS unstaged_runs`,
    ],
  },
  {
    layout: 8,
    statements: [statement`DROP TABLE IF EXISTS run_outcomes_4`],
  },
  {
    layout: 12,
    statements: [
      statement`ALTER TABLE recorded_content_heads ADD COLUMN kept_at BIGINT NOT NULL DEFAULT 0`,
      statement`ALTER TABLE recorded_content_heads ADD COLUMN kept_in TEXT NOT NULL DEFAULT 'ledger'`,
      statement`ALTER TABLE recorded_content_heads ADD COLUMN removing_since BIGINT`,
      {
        sqlite: statement`UPDATE recorded_content_heads
          SET kept_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`,
        postgresql: statement`UPDATE recorded_content_heads
          SET kept_at = CAST(extract(epoch FROM clock_timestamp()) * 1000 AS BIGINT)`,
      },
    ],
  },
];

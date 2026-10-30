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
];

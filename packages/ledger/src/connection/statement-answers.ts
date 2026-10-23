import type { Statement } from './statement.ts';

export interface StatementAnswer {
  readonly rows: readonly unknown[];
  readonly rowCount: number | null;
}

const nothingAnswered: StatementAnswer = { rows: [], rowCount: 0 };

export function lastAnswerOf(
  statements: readonly Statement[],
  answered: (statement: Statement) => Promise<StatementAnswer>,
): Promise<StatementAnswer> {
  return statements.reduce(async (before: Promise<StatementAnswer>, next: Statement) => {
    await before;
    return answered(next);
  }, Promise.resolve(nothingAnswered));
}

export function wroteARow({ rowCount }: StatementAnswer): boolean {
  return Number(rowCount) > 0;
}

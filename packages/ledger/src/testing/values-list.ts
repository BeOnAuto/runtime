import { statementOf, type Statement } from '../connection/statement.ts';

export function valuesListOf(count: number): Statement {
  const values = Array.from({ length: count }, (_, at) => at);
  const parts = values.map((_, at) => (at === 0 ? 'SELECT count(*) AS counted FROM (VALUES (' : '), ('));
  return statementOf([...parts, '))'], values);
}

import { contentTableNames, contentTables } from '../content/content-tables.ts';
import { keptSecretsShape } from './kept-secrets.ts';

export function columnsOrNames(
  statement: string,
  names: readonly string[] = contentTableNames,
): readonly { readonly name: string }[] {
  const table = [...contentTables, keptSecretsShape].find(({ name }) => statement.includes(`to_regclass("${name}")`));
  return (table === undefined ? names : table.columns).map((name) => ({ name }));
}

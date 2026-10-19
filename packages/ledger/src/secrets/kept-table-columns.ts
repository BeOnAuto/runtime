import { contentTableNames, contentTables } from '../content/content-tables.ts';
import { sealedSecretsShape } from './sealed-secrets.ts';

export function columnsOrNames(
  statement: string,
  names: readonly string[] = contentTableNames,
): readonly { readonly name: string }[] {
  const table = [...contentTables, sealedSecretsShape].find(({ name }) => statement.includes(`to_regclass("${name}")`));
  return (table === undefined ? names : table.columns).map((name) => ({ name }));
}

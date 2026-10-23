import { SQL } from '@event-driven-io/dumbo';

export type StatementValue = string | number | null;

export interface Statement {
  readonly strings: TemplateStringsArray;
  readonly values: readonly StatementValue[];
}

export function statement(strings: TemplateStringsArray, ...values: readonly StatementValue[]): Statement {
  return { strings, values };
}

export function onSQLite({ strings, values }: Statement): SQL {
  return SQL(strings, ...values);
}

export function textOnPostgreSQL({ strings }: Statement): string {
  return strings.reduce((text, part, index) => `${text}$${index}${part}`);
}

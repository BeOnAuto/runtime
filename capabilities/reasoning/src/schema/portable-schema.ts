import type { SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';

import { compileAnswerSchema, type AnswerSchema } from './answer-schema.ts';
import { budgetOf, overBudget, portableIssues, type Budget } from './portable-checks.ts';
import { loweredSchema } from './portable-lowering.ts';
import { roundTripIssues } from './schema-round-trip.ts';

export interface PortableForm {
  readonly portable: true;
  readonly sent: Schema.JsonObject;
  readonly budget: Budget;
}

interface NotPortable {
  readonly portable: false;
  readonly issues: readonly SchemaIssue[];
}

export type Portability = PortableForm | NotPortable;

const portabilityByDocument = new WeakMap<Schema.JsonObject, Portability>();

function distinct(issues: readonly SchemaIssue[]): readonly SchemaIssue[] {
  return [...new Map(issues.map((issue) => [`${issue.pointer}\u0000${issue.detail}`, issue])).values()];
}

function checkedLowering(author: AnswerSchema): Portability {
  const { sent, flagged } = loweredSchema(author.document);
  const budget = budgetOf(sent);
  const found = [...flagged, ...overBudget(budget)];
  const issues = found.length > 0 ? found : [...portableIssues(sent), ...roundTripIssues(author, sent)];
  return issues.length === 0 ? { portable: true, sent, budget } : { portable: false, issues: distinct(issues) };
}

function portabilityOf(document: Schema.JsonObject): Portability {
  return Result.match(compileAnswerSchema(document), {
    onFailure: (issues): Portability => ({ portable: false, issues }),
    onSuccess: (author) => checkedLowering(author),
  });
}

export function portableFormOf({ document }: AnswerSchema): Portability {
  const known = portabilityByDocument.get(document);
  if (known !== undefined) {
    return known;
  }
  const made = portabilityOf(document);
  portabilityByDocument.set(document, made);
  return made;
}

import { referencedVariablesOf } from '@on.auto/config';
import { listed } from '@on.auto/operations';
import { Schema } from 'effect';

export const referenceHoldingFields = ['client_secret', 'private_key'] as const;

export type ReferenceHoldingField = (typeof referenceHoldingFields)[number];

export const misplacedReference = `Holds a reference to an environment variable, which only ${listed(referenceHoldingFields.map((field) => `the ${field}`))} of a registered client may hold`;

const misplacedInThePolicy = `Holds a reference to an environment variable, which only ${listed(referenceHoldingFields.map((field) => `the ${field}`))} of a registered client, and a header or a query value of a provider, may hold`;

export function holdsAReference(text: string): boolean {
  return referencedVariablesOf(text).length > 0;
}

export function isReferenceHoldingField(field: string): boolean {
  return referenceHoldingFields.some((holding) => holding === field);
}

export const heldAsWritten = Schema.makeFilter(
  (text: string) => (holdsAReference(text) ? misplacedInThePolicy : undefined),
  undefined,
  true,
);

import { referencedVariablesOf } from '@on.auto/config';
import { listed } from '@on.auto/phrasing';
import { Schema } from 'effect';

const referenceHoldingFields = ['client_secret', 'private_key'] as const;

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

interface HoldingReferences {
  readonly client_secret?: string;
  readonly private_key?: string;
  readonly application?: { readonly private_key: string; readonly install_page: string };
}

export interface ReferenceHolding<Client> {
  readonly path: readonly string[];
  readonly text: string;
  readonly placed: (client: Client, value: string) => Client;
}

export function referenceHoldingsOf<Client extends HoldingReferences>(
  client: Client,
): readonly ReferenceHolding<Client>[] {
  const { application } = client;
  const atTheTop = referenceHoldingFields.flatMap((field): readonly ReferenceHolding<Client>[] => {
    const text = client[field];
    return text === undefined
      ? []
      : [{ path: [field], text, placed: (written, value) => ({ ...written, [field]: value }) }];
  });
  return application === undefined
    ? atTheTop
    : [
        ...atTheTop,
        {
          path: ['application', 'private_key'],
          text: application.private_key,
          placed: (written, value) => ({ ...written, application: { ...application, private_key: value } }),
        },
      ];
}

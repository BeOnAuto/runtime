import { Schema } from 'effect';

export const ServiceAccountChoiceSchema = Schema.Literal('managed');

export const serviceAccountField = Schema.optionalKey(
  ServiceAccountChoiceSchema.annotate({
    description:
      'For token_exchange, managed where the connection acts as a service account that Auto creates for it and removes with it',
  }),
);

export const fieldsOfAnExchange = {
  required: ['token_endpoint'],
  optional: ['scope', 'service_account'],
  recorded: ['parameters'],
} as const;

interface Exchanging {
  readonly kind: string;
  readonly service_account?: 'managed' | undefined;
}

export function actsAsAManagedServiceAccount({ kind, service_account: serviceAccount }: Exchanging): boolean {
  return kind === 'token_exchange' && serviceAccount === 'managed';
}

import { providerListOf, providerOf } from '@on.auto/providers/testing';
import { Schema } from 'effect';

import { ada, harness, operationNamed, type HarnessOptions } from './harness.ts';

const waysOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      providers: Schema.Array(
        Schema.Struct({ credentials: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
      ),
    }),
  }),
);

const providersOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ providers: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }) }),
);

export async function providersListedOf(entry: unknown) {
  const h = harness({ providers: providerListOf(providerOf(entry)) });
  return providersOf(await h.call(operationNamed(h.operations, 'list_providers'), ada)).output.providers;
}

export async function waysListedOf(entry: unknown, consenting: HarnessOptions['consenting'] = {}) {
  const h = harness({ providers: providerListOf(providerOf(entry)), consenting });
  const answer = await h.call(operationNamed(h.operations, 'list_providers'), ada);
  return waysOf(answer).output.providers.flatMap(({ credentials }) => credentials);
}

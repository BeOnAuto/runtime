import { definitionNamePattern } from '@on.auto/definitions';
import { Caller, defineHttpOperation, PlaybookReader, PlaybookWriter } from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { modelsStreamOf } from '../facts/model-facts.ts';
import { modelsDecider } from './model-decider.ts';
import { builtVersionOf } from './model-state.ts';

const ActivatedSchema = Schema.Struct({
  function: Schema.String.annotate({ description: 'The prediction function' }),
  version: Schema.Int.annotate({ description: 'The version now active' }),
  rule: Schema.Literal('requested').annotate({ description: 'Activated at the request of the caller' }),
  activated_at: Schema.String.annotate({ description: 'When it was activated, in ISO 8601 UTC' }),
});

export const activateVersion = defineHttpOperation('playbook', 'command', {
  name: 'activate_version',
  title: 'Activate version',
  description: [
    'Makes a built version of a prediction function its active one, which every question then asks, whatever its shadow or its approval decided.',
    'An earlier version activated again is a rollback, recorded the same way.',
    'The version must be built, and must not already be the active one.',
  ].join(' '),
  route: { method: 'POST', path: '/definitions/prediction/{name}/activate' },
  body: { kind: 'json' },
  inputSchema: Schema.Struct({
    name: Schema.String.check(Schema.isPattern(definitionNamePattern)).annotate({
      description: 'The prediction function',
    }),
    version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({ description: 'A version it has built' }),
  }),
  answer: { kind: 'json', outputSchema: ActivatedSchema },
  reasons: ['not_found', 'conflict'],
  handle: ({ name, version }) =>
    Effect.gen(function* () {
      const stream = modelsStreamOf(name);
      const { state } = yield* (yield* PlaybookReader).load(stream, modelsDecider);
      const built = builtVersionOf(state, version);
      const { id: by } = yield* Caller;
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* (yield* PlaybookWriter).execute(stream, modelsDecider, {
        type: 'activate',
        name,
        at,
        by,
        definitionVersion: built?.definitionVersion ?? 0,
        data: { version, rule: 'requested' },
      });
      return { function: name, version, rule: 'requested' as const, activated_at: at };
    }),
});

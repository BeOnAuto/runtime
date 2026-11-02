import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

const GetVoiceOutputSchema = Schema.Struct({
  model: Schema.NullOr(Schema.String).annotate({
    description: 'The voice model as the runtime’s settings name it, provider/model, or null where none is set',
  }),
});

export function defineGetVoice(model: string | null) {
  return defineHttpOperation('org', 'query', {
    name: 'get_voice',
    title: 'Get the voice model',
    description:
      'Answers the voice model the runtime writes out a recording with, or null where it has none, so a client offers voice only where there is one.',
    route: { method: 'GET', path: '/voice' },
    permittedBy: ['playbook:read'],
    body: { kind: 'none' },
    inputSchema: Schema.Record(Schema.String, Schema.Never),
    outputSchema: GetVoiceOutputSchema,
    reasons: [],
    handle: () => Effect.succeed({ model }),
  });
}

import { NotFound, defineQuery, noticesFields, withNotices, type Notice } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

export interface Asking {
  readonly name?: string;
  readonly description?: string;
  readonly argument?: string;
  readonly outcome?: string;
  readonly relayed?: string;
  readonly told?: string;
  readonly attempt?: string;
  readonly notices?: readonly Notice[];
}

export function asking({
  name = 'ask_definition',
  description = 'Asks. Use it to ask. It answers.',
  argument = 'What to ask',
  outcome = 'Asked.',
  relayed,
  told,
  attempt = 'ask',
  notices,
}: Asking) {
  return defineQuery('playbook', {
    name,
    title: 'Ask',
    description,
    route: { method: 'GET', path: `/${name.replaceAll('_', '-')}` },
    inputSchema: Schema.Struct({ question: Schema.optionalKey(Schema.String.annotate({ description: argument })) }),
    outputSchema: Schema.Struct({
      ...noticesFields(),
      answered: Schema.Boolean,
      told: Schema.optionalKey(Schema.String),
    }),
    reasons: ['not_found'],
    handle: ({ question }) =>
      question === 'nothing'
        ? Effect.fail(new NotFound({ detail: 'There is nothing' }))
        : Effect.succeed(withNotices({ answered: true, ...(told === undefined ? {} : { told }) }, notices ?? [])),
    plainLanguage: {
      task: 'ask',
      attempt: () => attempt,
      outcome: () => outcome,
      relayed: () => relayed,
    },
  });
}

export function sentencesOf(length: number): string {
  return `${'A'.padEnd(length - 1, 'a')}.`;
}

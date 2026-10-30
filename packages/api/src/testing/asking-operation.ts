import { NotFound, defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

export interface Asking {
  readonly name?: string;
  readonly description?: string;
  readonly argument?: string;
  readonly outcome?: string;
  readonly attempt?: string;
}

export function asking({
  name = 'ask_definition',
  description = 'Asks. Use it to ask. It answers.',
  argument = 'What to ask',
  outcome = 'Asked.',
  attempt = 'ask',
}: Asking) {
  return defineQuery('playbook', {
    name,
    title: 'Ask',
    description,
    route: { method: 'GET', path: `/${name.replaceAll('_', '-')}` },
    inputSchema: Schema.Struct({ question: Schema.optionalKey(Schema.String.annotate({ description: argument })) }),
    outputSchema: Schema.Struct({ answered: Schema.Boolean }),
    reasons: ['not_found'],
    handle: ({ question }) =>
      question === 'nothing'
        ? Effect.fail(new NotFound({ detail: 'There is nothing' }))
        : Effect.succeed({ answered: true }),
    plainLanguage: { task: 'ask', attempt: () => attempt, outcome: () => outcome },
  });
}

export function sentencesOf(length: number): string {
  return `${'A'.padEnd(length - 1, 'a')}.`;
}

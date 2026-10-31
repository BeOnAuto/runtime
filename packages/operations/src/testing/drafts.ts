import { Effect, Schema } from 'effect';

import { InvalidInput, defineCommand, type Issue, type Options } from '../index.ts';

function issuesOf(lines: readonly string[]): readonly Issue[] {
  return lines.flatMap((line, index) =>
    /^[A-Z]/u.test(line)
      ? []
      : [{ detail: `Line ${index + 1} must start with a capital letter`, pointer: `/lines/${index}` }],
  );
}

const openings: Options = {
  question: 'What should the draft open with?',
  choices: [
    { value: 'greeting', title: 'A greeting', issues: [{ detail: 'Open the draft with Hello', pointer: '/lines' }] },
    { value: 'title', title: 'A title', issues: [{ detail: 'Open the draft with its title', pointer: '/lines' }] },
  ],
};

const unopened = new InvalidInput({
  detail: 'The draft has no lines',
  issues: [{ detail: 'Open the draft with a greeting or a title', pointer: '/lines' }],
  options: openings,
});

export const publishDraft = defineCommand('playbook', {
  name: 'publish_draft',
  title: 'Publish draft',
  description: 'Publishes a draft whose lines all start with a capital letter, and rejects every other line.',
  route: { method: 'POST', path: '/drafts' },
  inputSchema: Schema.Struct({ lines: Schema.Array(Schema.String) }),
  outputSchema: Schema.Struct({ published: Schema.Int }),
  reasons: ['invalid_input'],
  handle: ({ lines }) => {
    if (lines.length === 0) {
      return Effect.fail(unopened);
    }
    const issues = issuesOf(lines);
    return issues.length === 0
      ? Effect.succeed({ published: lines.length })
      : Effect.fail(new InvalidInput({ detail: 'The draft has lines to fix', issues }));
  },
});

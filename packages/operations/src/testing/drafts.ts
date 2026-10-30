import { Effect, Schema } from 'effect';

import { InvalidInput, defineCommand, type Issue } from '../index.ts';

function issuesOf(lines: readonly string[]): readonly Issue[] {
  return lines.flatMap((line, index) =>
    /^[A-Z]/u.test(line)
      ? []
      : [{ detail: `Line ${index + 1} must start with a capital letter`, pointer: `/lines/${index}` }],
  );
}

export const publishDraft = defineCommand('playbook', {
  name: 'publish_draft',
  title: 'Publish draft',
  description: 'Publishes a draft whose lines all start with a capital letter, and rejects every other line.',
  route: { method: 'POST', path: '/drafts' },
  inputSchema: Schema.Struct({ lines: Schema.Array(Schema.String) }),
  outputSchema: Schema.Struct({ published: Schema.Int }),
  reasons: ['invalid_input'],
  handle: ({ lines }) => {
    const issues = issuesOf(lines);
    return issues.length === 0
      ? Effect.succeed({ published: lines.length })
      : Effect.fail(new InvalidInput({ detail: 'The draft has lines to fix', issues }));
  },
});

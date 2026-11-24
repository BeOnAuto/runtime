import { describe, expect, it } from 'vitest';

import { redrawingConversations } from '../testing/chat-conversations.ts';
import { askedRunId, fakeTools, interactionHarness } from '../testing/index.ts';
import { renderedDocument } from '../testing/rendered-documents.ts';

const review = { owner: 'ada', review: 'The headline is clear and the offer is on page one.' };

async function askedWith(source: string, input: unknown) {
  const playbook = interactionHarness({ tools: fakeTools(), conversations: redrawingConversations });
  await playbook.define('review-brief', source);
  const asked = await playbook.ask('review-brief', input, askedRunId);
  return { playbook, asked };
}

describe('a request with render slack and buttons that answer', () => {
  const answering = renderedDocument({
    front: [
      "to: '{{ input.owner }}'",
      'expires: P2D',
      'render: slack',
      'output:',
      '  schema: { type: object, required: [choice], properties: { choice: { type: string } } }',
    ],
    card: [
      'root: card',
      'elements:',
      '  card: { type: Card, props: { title: Review }, children: [review, row] }',
      '  review: { type: Text, props: { content: { $state: /input/review } } }',
      '  row: { type: Actions, children: [yes] }',
      '  yes: { type: Button, props: { label: Yes, sets: [{ at: /choice, value: yes }] } }',
    ],
  });

  it('keeps what each button sets, by its id, and the card with the input it reads to draw it again', async () => {
    const { playbook } = await askedWith(answering, review);

    const run = await playbook.runOf(askedRunId);

    expect(run).toMatchObject({ output: { record: { redraw: { target: 'slack', input: review } } } });
    expect(JSON.stringify(run)).toMatch(/"buttons":\{"auto-answer:\w+":\[\{"at":"\/choice","value":"yes"\}\]\}/u);
  });

  it('is refused at the run where the card and the input it reads are too large to keep', async () => {
    const { asked } = await askedWith(answering, { ...review, padding: 'x'.repeat(40_000) });

    expect(asked).toMatchObject({ status: 'rejected' });
  });
});

import { describe, expect, it } from 'vitest';

import { markdownOf } from '../index.ts';
import { replyDiagram } from './reply-diagram-words.ts';
import { partyNamedUnderDetails } from './request-words.ts';

const approval = {
  type: 'object',
  required: ['approver', 'label', 'draft'],
  properties: {
    approver: { type: 'string', description: 'Chat user id of the approver' },
    label: { type: 'string', description: 'The month, such as April 2026' },
    draft: { type: 'string', description: 'The draft report' },
  },
};

const sevenDays = 7 * 24 * 3_600_000;

function writtenOf(diagram: ReturnType<typeof replyDiagram>): string {
  return markdownOf({ title: 'approve-report', opening: ['Asks'], body: [diagram], sections: [], appendix: [] })
    .split('\n\n')
    .slice(2)
    .join('\n\n');
}

describe('the diagram of a reply to a request', () => {
  it('draws the fields given, the message, the wait, the first word deciding each value, another word and no reply', () => {
    expect(
      writtenOf(
        replyDiagram({
          input: approval,
          party: ['the approver'],
          server: 'gas',
          expiresMs: sevenDays,
          verdicts: { approve: ['approved', 'yes'], reject: [] },
          told: true,
        }),
      ),
    ).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  n1["The approver, the month and the draft report"]',
        '  n2["A message to the approver through gas"]',
        '  n3["Waits up to 7 days for a reply"]',
        '  n4{"The first word of the reply"}',
        '  n5(["approve"])',
        '  n6(["reject"])',
        '  n7(["unanswered"])',
        '  n1 --> n2',
        '  n2 --> n3',
        '  n3 --> n4',
        '  n4 -->|"approve, approved or yes"| n5',
        '  n4 -->|"reject"| n6',
        '  n4 -.->|"any other word, told how to answer"| n3',
        '  n3 -.->|"no reply"| n7',
        '```\n',
      ].join('\n'),
    );
  });
});

describe('the diagram of a reply to a request whose party is not told how to answer', () => {
  it('says only another word, and cuts a long label', () => {
    const drawn = replyDiagram({
      party: [partyNamedUnderDetails],
      server: 'a-server-whose-name-runs-on-and-on',
      expiresMs: 3_600_000,
      verdicts: { yes: [] },
      told: false,
    });

    expect(drawn.nodes.slice(0, 2).map(({ label }) => label)).toEqual([
      'Any input',
      'A message to the party named under Details through a-server…',
    ]);
    expect(drawn.edges.at(-2)?.label).toBe('any other word');
  });
});

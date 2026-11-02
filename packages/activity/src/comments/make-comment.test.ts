import type { CommentedPlace } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { commentOf, commenting, minute, reader, run, step } from '../testing/commenting.ts';
import { ada, outputOf, priya, studioPageOf } from '../testing/harness.ts';
import { makeComment } from './make-comment.ts';

const text = 'Flag any entry over $10,000 for Priya before the week closes.';

const event = `${run}_2`;

describe('make_comment', () => {
  it('is a command of the playbook at POST /comments, over HTTP alone, answering 201, for a reader of the playbook', () => {
    expect(makeComment.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      name: 'make_comment',
      route: { method: 'POST', path: '/comments' },
      successStatus: 201,
      servedOverHttpAlone: { kind: 'json' },
      permissions: ['playbook:read'],
    });
  });

  it('records what a reader says, kept without the white space around it, and answers the comment open, with its place in Studio', async () => {
    const { make } = await commenting();
    const outcome = await make(reader, { address: step, text: `\n  ${text}\n\n` }, minute(14));
    const { id } = commentOf(outcome);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(outputOf(outcome)).toEqual({
      id,
      address: step,
      text,
      by: reader.id,
      by_name: reader.name,
      at: minute(14),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      studio: studioPageOf({
        kind: 'comment',
        playbook: 'finance',
        comment: id,
        on: { kind: 'definition', type: 'workflow', name: 'close-the-week', version: 4, step: 'do/1/review' },
      }),
    });
  });
});

describe('the place in Studio of a comment', () => {
  it('opens each form of address a comment takes', async () => {
    const { make } = await commenting();
    const places: readonly (readonly [string, CommentedPlace])[] = [
      ['playbooks/finance', { kind: 'playbook' }],
      [
        'finance/definitions/reasoning/categorize-invoice/7',
        { kind: 'definition', type: 'reasoning', name: 'categorize-invoice', version: 7 },
      ],
      [`finance/runs/${run}`, { kind: 'run', run }],
      [`finance/runs/${run}/events/${event}`, { kind: 'run', run, event }],
      [`finance/runs/${run}/result/2`, { kind: 'run', run, block: 2 }],
      [`finance/${run}`, { kind: 'run', run }],
    ];
    const outcomes = await Promise.all(places.map(([address]) => make(priya, { address, text })));
    const ids = outcomes.map((outcome) => commentOf(outcome).id);

    expect(outcomes.map((outcome) => outputOf(outcome))).toMatchObject(
      places.map(([address, on], index) => ({
        address,
        studio: studioPageOf({ kind: 'comment', playbook: 'finance', comment: String(ids[index]), on }),
      })),
    );
  });
});

describe('make_comment, given what it cannot take', () => {
  it('refuses an address it cannot read, one of another playbook, and one over 512 characters, at /address', async () => {
    const { make } = await commenting();
    const refused = await Promise.all(
      ['finance/somewhere', 'playbooks/sales', `sales/runs/${run}`, `finance/runs/${'a'.repeat(510)}`].map((address) =>
        make(priya, { address, text }),
      ),
    );

    expect(refused).toMatchObject(
      Array.from({ length: 4 }, () => ({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/address' }],
      })),
    );
  });

  it('refuses text that is empty, all white space, over 4,000 characters or holding a control character, at /text', async () => {
    const { make } = await commenting();
    const refused = await Promise.all(
      ['', ' \n\t ', 'a'.repeat(4001), 'a\u0007b'].map((said) => make(priya, { address: step, text: said })),
    );
    const longest = await make(priya, { address: step, text: `# Heading\n\n\t${'a'.repeat(3988)}` });

    expect(refused).toMatchObject(
      Array.from({ length: 4 }, () => ({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/text' }],
      })),
    );
    expect(longest).toMatchObject({ status: 'succeeded' });
  });

  it('refuses a comment in a retired playbook, as every change to it is', async () => {
    const { make, retired } = await commenting();
    await retired(ada, 'sales', minute(1));

    expect(await make(ada, { address: 'playbooks/sales', text }, minute(2), 'sales')).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'retired',
    });
  });
});

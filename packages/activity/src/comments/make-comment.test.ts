import type { CommentedPlace } from '@on.auto/operations';
import type { Schema } from 'effect';
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
      anchor: null,
      by: reader.id,
      by_name: reader.name,
      at: minute(14),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      reopened_at: null,
      reopened_by: null,
      studio: studioPageOf({
        kind: 'comment',
        playbook: 'finance',
        comment: id,
        on: { kind: 'definition', type: 'workflow', name: 'close-the-week', version: 4, step: 'do/1/review' },
      }),
    });
  });
});

describe('make_comment with an anchor', () => {
  it('keeps where on the thing the person dropped it, and answers it as given', async () => {
    const { make, comments } = await commenting();
    const anchor = { x: 0.6125, y: 0.4 };
    const made = await make(reader, { address: step, text, anchor }, minute(14));

    expect(outputOf(made)).toMatchObject({ address: step, anchor });
    expect(outputOf(await comments())).toMatchObject({ comments: [{ address: step, anchor }] });
  });
});

const outOfItsBox: readonly Schema.JsonObject[] = [
  { x: 1.5, y: 0 },
  { x: 0.12345, y: 0 },
  { x: 0, y: -0.5 },
];

const notXAndY: readonly (readonly [Schema.JsonObject, string, string])[] = [
  [{ x: 0.5 }, '/anchor/y', 'Missing key'],
  [{ x: 0.5, y: 0.5, z: 0 }, '/anchor/z', 'Expected no excess property'],
  [{ x: '0.5', y: 0.5 }, '/anchor/x', 'Expected number'],
];

describe('make_comment, given an anchor it cannot take', () => {
  it('refuses an anchor out of its box or with over 4 decimals at /anchor', async () => {
    const { make } = await commenting();
    const refused = await Promise.all(outOfItsBox.map((anchor) => make(priya, { address: step, text, anchor })));

    expect(refused).toEqual(
      Array.from({ length: 3 }, () => ({
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The input does not match the input schema',
        issues: [{ pointer: '/anchor', detail: 'Expected x and y, each a number from 0 to 1 with at most 4 decimals' }],
      })),
    );
  });

  it('refuses an anchor of another shape at the field within it, and one that is no object at /anchor', async () => {
    const { make } = await commenting();
    const malformed = await Promise.all(notXAndY.map(([anchor]) => make(priya, { address: step, text, anchor })));
    const notAnObject = await make(priya, { address: step, text, anchor: [] });

    expect(malformed).toMatchObject(
      notXAndY.map(([, pointer, detail]) => ({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer, detail }],
      })),
    );
    expect(notAnObject).toMatchObject({ issues: [{ pointer: '/anchor', detail: 'Expected object | null' }] });
  });

  it('checks the input as a whole before the form of the address, so a bad anchor is refused before a bad address', async () => {
    const { make } = await commenting();

    expect(await make(priya, { address: 'finance/somewhere', text, anchor: { x: 2, y: 0 } })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/anchor' }],
    });
  });

  it('takes an anchor of null as one left out', async () => {
    const { make } = await commenting();

    expect(outputOf(await make(priya, { address: step, text, anchor: null }))).toMatchObject({ anchor: null });
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
      ['playbooks/finance/parts/ledger', { kind: 'playbook' }],
      [`finance/runs/${run}/parts/output`, { kind: 'run', run }],
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
  it("refuses an address it cannot read, one of another playbook or of the organization's, and one over 512 characters, at /address", async () => {
    const { make } = await commenting();
    const refused = await Promise.all(
      [
        'finance/somewhere',
        'playbooks/sales',
        `sales/runs/${run}`,
        `finance/runs/${'a'.repeat(510)}`,
        'org',
        'org/settings/billing',
      ].map((address) => make(priya, { address, text })),
    );

    expect(refused).toMatchObject(
      Array.from({ length: 6 }, () => ({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/address' }],
      })),
    );
  });
});

describe('make_comment, given text it cannot take or a retired playbook', () => {
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

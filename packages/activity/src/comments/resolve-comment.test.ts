import { unsuccessfulWords } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { commentDecider } from '../facts/comment-facts.ts';
import { commentOf, commenting, minute, reader, run, step } from '../testing/commenting.ts';
import { ada, outputOf, priya } from '../testing/harness.ts';
import { resolveComment } from './resolve-comment.ts';

const inStudio: unknown = expect.stringContaining('studio.example');

describe('resolve_comment', () => {
  it('is a repeatable command of the playbook at POST /comments/{id}/resolve, for a reader of the playbook, served as a tool too', () => {
    expect(resolveComment.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      name: 'resolve_comment',
      route: { method: 'POST', path: '/comments/{id}/resolve' },
      permissions: ['playbook:read'],
      repeatable: true,
    });
    expect(resolveComment.registration).not.toHaveProperty('servedOverHttpAlone');
  });

  it("closes anyone's comment, saying when, by whom and how, and answers it whole", async () => {
    const { made, resolve } = await commenting();
    const id = await made(step, minute(1), priya);

    expect(outputOf(await resolve(id.toUpperCase(), 'acted', reader, minute(31)))).toMatchObject({
      id,
      address: step,
      by: priya.id,
      open: false,
      resolved_at: minute(31),
      resolved_by: reader.id,
      resolved_how: 'acted',
      studio: inStudio,
    });
  });

  it('records nothing for a comment resolved already, and answers it as it stands, with the how it was first resolved with', async () => {
    const { made, resolve, ledger } = await commenting();
    const id = await made(step, minute(1));
    await resolve(id, 'dismissed', ada, minute(31));
    const again = await resolve(id, 'acted', reader, minute(32));

    expect(outputOf(again)).toMatchObject({ resolved_how: 'dismissed', resolved_by: ada.id, resolved_at: minute(31) });
    expect(
      (await Effect.runPromise(ledger.service.load(`playbook/acme/finance/comments/${id}`, commentDecider))).version,
    ).toBe(2);
  });
});

describe('resolve_comment, given what it cannot take', () => {
  it('refuses an id that is no UUID and a how that is not acted or dismissed, and finds no comment the playbook does not hold', async () => {
    const { made, resolve } = await commenting();
    const id = await made(step, minute(1));

    expect(
      await Promise.all([resolve('not-an-id', 'acted'), resolve(id, 'done'), resolve(run, 'acted')]),
    ).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/id' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/how' }] },
      { status: 'rejected', reason: 'not_found' },
    ]);
    expect(commentOf(await resolve(id, 'acted'))).toMatchObject({ open: false });
  });
});

describe('the plain words of resolve_comment, refused', () => {
  it('say that the playbook of a comment has been retired, so its comments can only be read', () => {
    const { plainLanguage } = resolveComment.registration;

    expect(
      unsuccessfulWords(
        String(plainLanguage?.attempt({ id: run, how: 'acted' })),
        'command',
        { status: 'rejected', reason: 'conflict', kind: 'retired', detail: 'The playbook finance is retired' },
        { explanations: plainLanguage?.explanations },
      ),
    ).toBe(
      'Could not resolve the comment: its playbook has been retired, so its comments can only be read. Nothing was changed. list_comments still reads them, open and resolved.',
    );
  });
});

describe('the plain words of resolve_comment', () => {
  it('say how the comment was resolved', () => {
    const comment = {
      id: run,
      address: step,
      text: 'Here.',
      by: priya.id,
      by_name: priya.name,
      at: minute(1),
      open: false,
      resolved_at: minute(2),
      resolved_by: priya.id,
    };
    const { plainLanguage } = resolveComment.registration;

    expect([
      plainLanguage?.attempt({ id: run, how: 'acted' }),
      plainLanguage?.outcome({ ...comment, resolved_how: 'acted' }, { id: run, how: 'acted' }),
      plainLanguage?.outcome({ ...comment, resolved_how: 'dismissed' }, { id: run, how: 'dismissed' }),
    ]).toEqual([
      'resolve the comment',
      'The comment is resolved as acted on: it leaves the open comments and the activity.',
      'The comment is dismissed: it leaves the open comments and the activity.',
    ]);
  });
});

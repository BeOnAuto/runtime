import { describe, expect, it } from 'vitest';

import { financePrefix, projected } from '../testing/projected.ts';
import {
  attemptResumed,
  messageOf,
  requestAnswered,
  runDeferred,
  runFailed,
  runRejected,
  runStarted,
  runSucceeded,
  type RunOf,
} from '../testing/recorded-facts.ts';
import { mostAnswerSchemaBytes, requestRows, waitsOnOf } from './request-rows.ts';

const approve: RunOf = {
  runId: '019a400e-1f2b-7a44-8c5d-6b7e9f0a1b2c',
  type: 'interaction',
  name: 'approve-payment',
  version: 2,
};

const step: RunOf = {
  ...approve,
  runId: '019a400e-1f2b-7a44-8c5d-000000000002',
  calledBy: { runId: '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e', reference: 'approve', run: 1 },
};

const yesOrNo = { type: 'boolean' };

const at = (minute: number) => `2026-11-01T16:5${minute}:00.000Z`;

const asked = {
  to: 'Priya@Acme.example',
  message: 'Approve the payment of $4,200 to Northwind Supplies?\nThe invoice is attached.',
  expiresAt: '2026-11-03T16:58:12.204Z',
  answerSchema: yesOrNo,
};

const streamOf = ({ runId }: RunOf) => `${financePrefix}runs/${runId}`;

describe('the requests of the activity', () => {
  it('opens a row when a run asks a person for an answer, with who started the run and whom it waits on', async () => {
    const { record, rows } = projected(requestRows);
    await record(
      streamOf(approve),
      runStarted(approve, at(0), 'person:user_7kLm2'),
      runDeferred(approve, at(1), asked),
    );

    expect(await rows()).toEqual({
      [approve.runId]: {
        open: true,
        at: Date.parse(at(1)),
        by: 'person:user_7kLm2',
        definition_type: 'interaction',
        definition_name: 'approve-payment',
        definition_version: 2,
        trigger: null,
        message: 'Approve the payment of $4,200 to Northwind Supplies?',
        answer_schema: JSON.stringify(yesOrNo),
        waits_on: 'priya@acme.example',
        expires_at: Date.parse(asked.expiresAt),
        sign_in: null,
        approval: null,
      },
    });
  });

  it('opens a row that waits on the person a sign-in request asks, by id, keeping its site and link', async () => {
    const { record, rows } = projected(requestRows);
    const signIn = { server: 'browser', site: 'portal.supplier.example', link: 'https://studio.example/sign-in' };
    await record(
      streamOf(approve),
      runStarted(approve, at(0), 'playbook:finance'),
      runDeferred(approve, at(1), { ...asked, to: 'person:user_7kLm2', signIn }),
    );

    expect((await rows())[approve.runId]).toMatchObject({
      open: true,
      waits_on: 'person:user_7kLm2',
      sign_in: JSON.stringify(signIn),
    });
  });
});

describe('the requests of the activity that ask a person to approve an action', () => {
  it('opens a row that waits on the person an approval request asks, by id, keeping the action it asks them to approve', async () => {
    const { record, rows } = projected(requestRows);
    const approval = { server: 'shop', tool: 'pay', action: 'Pay for order A-17', site: 'shop.example', kind: 'pay' };
    await record(
      streamOf(approve),
      runStarted(approve, at(0), 'person:user_7kLm2'),
      runDeferred(approve, at(1), { ...asked, to: 'person:user_7kLm2', approval }),
    );

    expect((await rows())[approve.runId]).toMatchObject({
      open: true,
      waits_on: 'person:user_7kLm2',
      sign_in: null,
      approval: JSON.stringify(approval),
    });
  });
});

describe('a request a workflow step made', () => {
  it('opens a row, the step being the run that asked', async () => {
    const { record, rows } = projected(requestRows);
    await record(streamOf(step), runStarted(step, at(0), 'person:user_7kLm2'), runDeferred(step, at(1), asked));

    expect((await rows())[step.runId]).toMatchObject({ open: true });
  });
});

const endings = [
  requestAnswered(approve, at(2), 'person:user_7kLm2'),
  attemptResumed(approve, at(2)),
  runSucceeded(approve, at(2)),
  runRejected(approve, at(2), 'unanswered', 'Nobody answered'),
  runFailed(approve, at(2)),
];

describe('a request answered or ended', () => {
  it.each(endings)('closes the row on $type, and changes nothing of a closed row', async (ending) => {
    const { record, rows } = projected(requestRows);
    await record(streamOf(approve), runStarted(approve, at(0), 'x'), runDeferred(approve, at(1), asked), ending);

    expect((await rows())[approve.runId]).toMatchObject({ open: false, message: asked.message.split('\n')[0] });
    expect(requestRows.rowAfter({ open: false }, messageOf(ending))).toBeUndefined();
  });
});

describe('what opens no request', () => {
  it('opens no row for a request that takes no answer or a record that is no request, and keeps one only for its start', async () => {
    const { record, rows } = projected(requestRows);
    const told = { to: asked.to, message: asked.message, expiresAt: asked.expiresAt };
    await record(streamOf(approve), runStarted(approve, at(0), 'x'), runDeferred(approve, at(1), told));
    const notARequest = { ...messageOf(runDeferred(approve, at(1), asked)), data: { record: { waiting: true } } };

    expect(await rows()).toMatchObject({ [approve.runId]: { open: false, at: null, by: 'x' } });
    expect(requestRows.rowAfter(undefined, notARequest)).toBeUndefined();
  });

  it('opens a row for a request whose start it never folded, as by whoever recorded it', () => {
    expect(requestRows.rowAfter(undefined, messageOf(runDeferred(approve, at(1), asked)))).toMatchObject({
      open: true,
      by: 'playbook:finance',
    });
  });

  it('keeps no answer schema larger than its bound, and folds nothing it cannot read', () => {
    const large = { ...asked, answerSchema: { type: 'string', description: 'x'.repeat(mostAnswerSchemaBytes) } };
    const unread = { ...messageOf(runStarted(approve, at(0), 'x')), data: {} };
    const other = {
      ...messageOf(runStarted(approve, at(0), 'x')),
      type: 'run_cancel_requested',
      data: { kind: 'requested', reason: 'Stopped by its caller' },
    };

    expect(requestRows.rowAfter(undefined, messageOf(runDeferred(approve, at(1), large)))).toMatchObject({
      answer_schema: null,
    });
    expect(requestRows.rowAfter(undefined, unread)).toBeUndefined();
    expect(requestRows.rowAfter(undefined, other)).toBeUndefined();
  });
});

describe('whom a request waits on', () => {
  it('is the person its party names by id, the address it names, in lower case, or any member where it names none', () => {
    expect(waitsOnOf('person:user_7kLm2')).toBe('person:user_7kLm2');
    expect(waitsOnOf(' Dana@Example.com ')).toBe('dana@example.com');
    expect(waitsOnOf('#approvals')).toBe('any_member');
    expect(waitsOnOf('agent')).toBe('any_member');
  });
});

import type { RecordedWork } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { clickIdentity, isClickIdentity } from '../replies/reply-taking.ts';
import { answeredSoFar, answerSoFar, settingsOf, type Setting } from './answer-parts.ts';

function setting(at: string, value: Setting['value'], by = 'ada', time = '2026-10-07T09:00:00.000Z'): Setting {
  return { at, value, by, time };
}

describe('the answer so far', () => {
  it('is empty before a click, and holds each part at its place, a later click replacing an earlier', () => {
    expect(answerSoFar([])).toEqual({});
    expect(
      answerSoFar([
        setting('/choice', 'reject'),
        setting('/decisions/a', 'approve'),
        setting('/decisions/b', 'approve'),
        setting('/choice', 'approve'),
      ]),
    ).toEqual({ choice: 'approve', decisions: { a: 'approve', b: 'approve' } });
  });

  it('names a place with escaped slashes and tildes, and puts a part under a list by its index', () => {
    expect(answerSoFar([setting('/a~1b', 1), setting('/c~0d', 2)])).toEqual({ 'a/b': 1, 'c~d': 2 });
    expect(answerSoFar([setting('/list', ['x']), setting('/list/1', 'y'), setting('/list/0', 'z')])).toEqual({
      list: ['z', 'y'],
    });
    expect(answerSoFar([setting('/list', ['x']), setting('/list/0/deeper', 'y'), setting('/list/5', 'z')])).toEqual({
      list: { '5': 'z' },
    });
  });

  it('puts a part inside a list that a value gave, and under an object a scalar stood in place of', () => {
    expect(answerSoFar([setting('', [1, 2]), setting('/1', 9)])).toEqual([1, 9]);
    expect(answerSoFar([setting('/a', 1), setting('/a/b', 2)])).toEqual({ a: { b: 2 } });
    expect(answerSoFar([setting('/a', [1]), setting('/a/x', 2)])).toEqual({ a: { x: 2 } });
    expect(answerSoFar([setting('/a', [1]), setting('/a/0', 2), setting('/a/-1', 3)])).toEqual({ a: { '-1': 3 } });
  });
});

describe('who set each part, and when', () => {
  it('mirrors the answer, each part holding who set it and when its click was recorded', () => {
    expect(
      answeredSoFar([
        setting('/decisions/a', 'approve', 'ada', 't1'),
        setting('/decisions/b', 'approve', 'bo', 't2'),
        setting('/decisions/a', 'reject', 'bo', 't3'),
      ]),
    ).toEqual({ decisions: { a: { by: 'bo', at: 't3' }, b: { by: 'bo', at: 't2' } } });
  });
});

describe('the identity of a click', () => {
  it('is told from the identity of a message, which a reply is named by', () => {
    expect([clickIdentity('1699.5'), isClickIdentity('click:1699.5'), isClickIdentity('1699.5')]).toEqual([
      'click:1699.5',
      true,
      false,
    ]);
  });
});

const context = {
  at: '2026-10-07T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'interaction',
  definitionName: 'confirm-order',
  definitionVersion: 2,
};

describe('the settings of a run', () => {
  it('are each part a click set, in the order the run recorded them, and nothing of any other work', () => {
    const work: readonly RecordedWork[] = [
      {
        type: 'answer_set',
        data: {
          click: { id: '1', sender: 'ada' },
          action: 'auto-answer:1',
          parts: [
            { at: '/a', value: 1 },
            { at: '/b', value: 2 },
          ],
        },
        context,
      },
      { type: 'delivery_refused', data: { number: 1, because: 'too_large', duration_ms: 1 }, context },
      { type: 'nudge_sent', data: { number: 1 }, context },
    ];

    expect(settingsOf(work)).toEqual([
      { at: '/a', value: 1, by: 'ada', time: context.at },
      { at: '/b', value: 2, by: 'ada', time: context.at },
    ]);
  });
});

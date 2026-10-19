import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { composedFactsOf, declaredFactsOf, makeDefinitionPresenters } from '../index.ts';
import { RunEventSchema } from '../runs/run-events.ts';
import { askedRunId, askingFacts } from '../testing/asked-runs.ts';
import { asking, nudgesPresenter } from '../testing/asking.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { playbookStreamKinds } from './declared-facts.ts';

const context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: askedRunId,
  definitionType: 'asking',
  definitionName: 'approve',
  definitionVersion: 1,
};

describe('the facts a ledger reads on a run', () => {
  it('are the playbook’s own and those the capabilities composed declare, each in the shape it declares', () => {
    const decode = Schema.decodeUnknownResult(Schema.toCodecJson(askingFacts.decider.eventSchema));

    expect([
      Result.isSuccess(decode({ type: 'nudge_sent', data: { number: 1 }, context })),
      Result.isSuccess(decode({ type: 'nudge_sent', data: { number: 'one' }, context })),
      Result.isSuccess(decode({ type: 'delivery_started', data: { number: 1 }, context })),
    ]).toEqual([true, false, false]);
  });

  it('are any fact of a capability to the playbook that knows none, though never one of the playbook’s own in another shape', () => {
    const decode = Schema.decodeUnknownResult(Schema.toCodecJson(RunEventSchema));

    expect([
      decode({ type: 'delivery_started', data: { number: 1 }, context }),
      Result.isSuccess(decode({ type: 'run_failed', data: { incident: 1 }, context })),
    ]).toMatchObject([
      Result.succeed({ type: 'work', data: { fact: { type: 'delivery_started', data: { number: 1 } } } }),
      false,
    ]);
  });

  it('are declared once each across the capabilities composed, and never under a name the playbook records itself', () => {
    const prodding = { ...asking, type: 'prodding' };
    const claimingAFailure = {
      type: 'claiming',
      facts: { ...asking.facts, onRuns: asking.facts.onRuns.map((fact) => ({ ...fact, type: 'run_failed' })) },
    };

    expect(() => declaredFactsOf([asking, echo, prodding])).toThrow(
      'The fact nudge_sent is declared by the capabilities asking and prodding, and one capability alone may declare it',
    );
    expect(() => declaredFactsOf([echo, claimingAFailure])).toThrow(
      'The fact run_failed that the capability claiming declares is one the playbook records itself',
    );
    expect(declaredFactsOf([echo, asking]).map(({ type }) => type)).toEqual(['nudge_sent']);
  });
});

describe('the stream kinds the capabilities composed own', () => {
  it('are declared by one capability each, and composed beside the facts on runs', () => {
    const presenting = { type: 'presenting', facts: { onRuns: [], streams: [nudgesPresenter] } };

    expect(() => composedFactsOf([asking, echo, presenting])).toThrow(
      'The stream kind nudges is declared by the capabilities asking and presenting, and one capability alone may declare it',
    );
    expect(composedFactsOf([echo, asking])).toEqual({ onRuns: asking.facts.onRuns, streams: [nudgesPresenter] });
  });
});

function claiming(streamKind: string) {
  return { type: 'claiming', facts: { onRuns: [], streams: [{ ...nudgesPresenter, streamKind }] } };
}

describe('the stream kinds the playbook records on itself', () => {
  it('are the kinds of its own presenters', () => {
    expect(makeDefinitionPresenters([echo]).map(({ streamKind }) => streamKind)).toEqual(playbookStreamKinds);
  });

  it.each(playbookStreamKinds)('refuse a capability that declares %s, naming the kind and the capability', (kind) => {
    expect(() => composedFactsOf([echo, claiming(kind)])).toThrow(
      `The stream kind ${kind} that the capability claiming declares is one the playbook records on itself`,
    );
  });
});

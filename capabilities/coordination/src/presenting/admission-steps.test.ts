import { PublicEventSchema, mostPublicEventDataBytes, presentationOf, type RecordedEvent } from '@on.auto/operations';
import { internalTermsIn, nothingKept } from '@on.auto/operations/testing';
import { RunLogEventSchema, stateFormat, type RunLogEvent, type Step } from '@on.auto/workflow-engine';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runPresenter } from './run-presenter.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const encodeEvent = Schema.encodeSync(Schema.toCodecJson(RunLogEventSchema));

const decodePublicEvent = Schema.decodeUnknownResult(PublicEventSchema);

const presentation = presentationOf([runPresenter]);

const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' } as const;

const utf8 = new TextEncoder();

const at = '2026-10-05T09:00:00.000Z';

function recordOf(steps: readonly Step[]): RecordedEvent {
  const event: RunLogEvent = {
    type: 'input_applied',
    format: stateFormat,
    receipt: { kind: 'call_answered', key: 'k', at: Date.parse(at), status: 'rejected' },
    steps,
    resumed: null,
    patch: [],
    outputs: [],
  };
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: null,
    correlationId: runId,
    stream: `run-logs/${runId}`,
    version: 1,
    globalPosition: 1,
    type: event.type,
    data: encodeEvent(event),
    context: {
      at,
      by: 'acme-admin',
      runId,
      definitionType: 'workflow',
      definitionName: 'triage',
      definitionVersion: 1,
    },
    recordedAt: at,
  };
}

const ask = { reference: '/do/0/ask', run: 1, name: 'ask', times: 1 };

const dataOfAsk = { name: 'ask', reference: '/do/0/ask', run: 1, times: 1 };

function present(record: RecordedEvent) {
  return presentation.present(record, showing);
}

const retryAt = Date.parse('2026-10-05T09:01:00.000Z');

const until = Date.parse('2026-10-06T09:00:00.000Z');

const outOfCredits = {
  kind: 'credits_exhausted',
  because: 'none_left',
  detail: 'The account has no credits left for this run',
  resolve_at: 'https://studio.example.com/billing',
  retry_at: retryAt,
  until,
};

function admittedLater(refusal: NonNullable<Step['refusal']>) {
  const [, step] = present(
    recordOf([{ ...ask, times: 2, outcome: 'waiting', waits_for: 'admission', refusal, caused_by: 'input' }]),
  );
  return step;
}

const tries = 'It tries again at 2026-10-05T09:01:00.000Z, and stops waiting at 2026-10-06T09:00:00.000Z.';

describe('a step that waits for credits or a license', () => {
  it('says in plain words what it waits for and why, where to put it right, when it tries again and until when', () => {
    expect(admittedLater(outOfCredits)).toMatchObject({
      type: 'step_waiting',
      summary: `The step “ask” waits for credits, since the account it runs under has no credits left; it can be put right at https://studio.example.com/billing. ${tries}`,
      data: {
        ...dataOfAsk,
        times: 2,
        waits_for: 'admission',
        detail: 'The account has no credits left for this run',
        kind: 'credits_exhausted',
        because: 'none_left',
        resolve_at: 'https://studio.example.com/billing',
        retry_at: '2026-10-05T09:01:00.000Z',
        until: '2026-10-06T09:00:00.000Z',
      },
    });
  });
});

describe('a step that waits for a refusal of each kind', () => {
  it.each([
    [
      'license_required',
      'The step “ask” waits for a license, since this runtime has no license key and has used its free runs for now.',
    ],
    [
      'license_invalid',
      'The step “ask” waits for its license to be put right, since the license this runtime holds no longer stands.',
    ],
    [
      'meter_unavailable',
      'The step “ask” waits until its account at Auto can be asked for credits, since the account it runs under could not be asked for its credits.',
    ],
    ['busy_elsewhere', 'The step “ask” waits for credits or a license.'],
  ])('says what a refusal of the kind %s waits for', (kind, said) => {
    const { resolve_at: link, because, ...refused } = outOfCredits;
    const step = admittedLater({ ...refused, kind });

    expect(step?.summary).toBe(`${said} ${tries}`);
    expect(internalTermsIn(String(step?.summary))).toEqual([]);
    expect([link, because]).toEqual(['https://studio.example.com/billing', 'none_left']);
  });
});

describe('a step that waits out the free rate', () => {
  it.each([
    [
      'credits_exhausted',
      'free_daily_limit',
      'waits for credits, since the account it runs under has used its free runs for the day',
    ],
    [
      'license_required',
      'free_month_used',
      'waits for a license, since this runtime has no license key and has used its free runs for the month',
    ],
  ])('says which limit a refusal of the kind %s reached, %s', (kind, because, said) => {
    const { resolve_at: link, ...refused } = outOfCredits;

    expect(admittedLater({ ...refused, kind, because })?.summary).toBe(`The step “ask” ${said}. ${tries}`);
    expect(link).toBe('https://studio.example.com/billing');
  });
});

describe('a step that waits with less said, or the most', () => {
  it('names only what the refusal gave', () => {
    const { kind, because, resolve_at: link, ...bare } = outOfCredits;

    expect(admittedLater(bare)?.data).toEqual({
      ...dataOfAsk,
      times: 2,
      waits_for: 'admission',
      detail: bare.detail,
      retry_at: '2026-10-05T09:01:00.000Z',
      until: '2026-10-06T09:00:00.000Z',
    });
    expect([kind, because, link]).toEqual(['credits_exhausted', 'none_left', 'https://studio.example.com/billing']);
  });

  it('presents within the bound of public data at the largest refusal a step records', () => {
    const step = admittedLater({
      kind: '😀'.repeat(64),
      because: '😀'.repeat(64),
      detail: '\\u0000'.repeat(170),
      resolve_at: `https://example.com/${'\\u0000'.repeat(166)}`,
      retry_at: retryAt,
      until,
    });

    expect(utf8.encode(JSON.stringify(step?.data)).byteLength).toBeLessThanOrEqual(mostPublicEventDataBytes);
    expect(Result.isSuccess(decodePublicEvent(step))).toBe(true);
  });
});

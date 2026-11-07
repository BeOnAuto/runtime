import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  answeredWith,
  enforcingGateway,
  gatewayModel,
  refusedByTheGateway,
  respondedInTurn,
} from '../provider-testing/answers-in-turn.ts';
import { jsonResponse, type Responder } from '../provider-testing/recording-fetch.ts';
import { failed, jsonRequest, succeeded } from '../testing/adapter-harness.ts';

const verdictIssue = { pointer: '/verdict', detail: 'Expected string' };

const approve = answeredWith('{"verdict":"approve"}');

const missed = answeredWith('{"verdict":42}');

const serverError: Responder = () => jsonResponse({ error: { message: 'down' } }, 500);

const refused = refusedByTheGateway(400);

describe('a JSON answer whose schema the provider refuses, which then misses its schema', () => {
  it('is asked for once more with the issues, and answers the correction, in three requests in all', async () => {
    const { access, requests } = await respondedInTurn(enforcingGateway, refused, missed, approve);

    const result = await succeeded(access, jsonRequest(gatewayModel));

    const correction = JSON.stringify(requests()[2]?.body);
    expect(requests()).toHaveLength(3);
    expect(correction).not.toContain('response_format');
    expect(correction).toContain('/verdict: Expected string');
    expect(result).toMatchObject({
      json: { verdict: 'approve' },
      cost_usd: 0.5,
      output_mode: 'described',
      repair: { outcome: 'repaired', issues: [verdictIssue] },
      schema_refusal: { outcome: 'described', status: 400 },
    });
  });

  it('makes no fourth request when the correction misses the schema too', async () => {
    const { access, requests } = await respondedInTurn(enforcingGateway, refused, missed, missed, approve);

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(3);
    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      issues: [verdictIssue],
      output_mode: 'described',
      repair: { outcome: 'invalid', issues: [verdictIssue] },
      schema_refusal: { outcome: 'described', status: 400 },
    });
  });

  it('fails with the answer and its issues when the request for the correction fails', async () => {
    const { access, requests } = await respondedInTurn(enforcingGateway, refused, missed, serverError);

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(3);
    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      cost_usd: 0.25,
      output_mode: 'described',
      repair: { outcome: 'failed', because: 'provider_unavailable' },
      schema_refusal: { outcome: 'described', status: 400 },
    });
  });
});

const began = Date.parse('2026-11-06T09:00:00.000Z');

function at(ms: number, reply: Responder): Responder {
  return (request, attempt) => {
    vi.setSystemTime(began + ms);
    return reply(request, attempt);
  };
}

function timed(...replies: readonly Responder[]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(began);
  return respondedInTurn(enforcingGateway, ...replies);
}

describe('a JSON answer whose schema the provider refuses when little time is left', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["the call's deadline", { timeout_ms: 60_000 }],
    ["the run's bound", { room: { input_tokens: 1_000_000, ends_at: began + 50_000 } }],
  ] as const)('is not asked for again when less of %s is left than the refusal took', async (_what, more) => {
    const { access, requests } = await timed(at(40_000, refused), approve);

    const failure = await failed(access, jsonRequest(gatewayModel, more));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      detail: 'internal refused the request (HTTP 400): the request was rejected as invalid',
      schema_refusal: { outcome: 'skipped', because: 'time', status: 400, duration_ms: 40_000 },
    });
    expect(failure).not.toHaveProperty('output_mode');
  });

  it('is asked for again when at least as much time is left as the refusal took', async () => {
    const { access, requests } = await timed(at(20_000, refused), at(25_000, approve));

    const result = await succeeded(access, jsonRequest(gatewayModel, { timeout_ms: 60_000 }));

    expect(requests()).toHaveLength(2);
    expect(result).toMatchObject({ schema_refusal: { outcome: 'described', status: 400, duration_ms: 20_000 } });
  });

  it('counts the time left for a correction from the start of the call, the refusal included', async () => {
    const { access, requests } = await timed(at(30_000, refused), at(50_000, missed), at(55_000, approve));

    const failure = await failed(access, jsonRequest(gatewayModel, { timeout_ms: 60_000 }));

    expect(requests()).toHaveLength(2);
    expect(failure).toMatchObject({ _tag: 'output_invalid', repair: { outcome: 'skipped', because: 'time' } });
  });
});

import { describe, expect, it } from 'vitest';

import {
  answeredWith,
  describingGateway,
  enforcingGateway,
  gatewayModel,
  refusedByTheGateway,
  respondedInTurn,
  usageOfOneAnswer,
} from '../provider-testing/answers-in-turn.ts';
import { failed, jsonRequest, succeeded, textRequest } from '../testing/adapter-harness.ts';

const howToAnswer = 'Answer with only a JSON value that matches this JSON Schema';

const approve = answeredWith('{"verdict":"approve"}');

describe('a JSON answer whose schema the provider refuses', () => {
  it.each([400, 422])(
    'is asked for once more with the schema in the instructions when the provider answers HTTP %i, and answers',
    async (status) => {
      const { access, requests } = await respondedInTurn(enforcingGateway, refusedByTheGateway(status), approve);

      const result = await succeeded(access, jsonRequest(gatewayModel));

      const [enforced, described] = requests().map(({ body }) => body);
      expect(enforced).toMatchObject({ response_format: { type: 'json_schema' } });
      expect(described).not.toHaveProperty('response_format');
      expect(JSON.stringify(described)).toContain(howToAnswer);
      expect(result).toMatchObject({
        json: { verdict: 'approve' },
        usage: usageOfOneAnswer,
        cost_usd: 0.25,
        output_mode: 'described',
        schema_refusal: { outcome: 'described', status },
      });
      expect(result).toHaveProperty(['schema_refusal', 'duration_ms'], expect.any(Number));
    },
  );
});

describe('a JSON answer whose request the provider refuses for something other than its schema', () => {
  it.each([
    [401, 'credentials_rejected'],
    [403, 'credentials_rejected'],
    [404, 'definition_invalid'],
    [429, 'rate_limited'],
    [500, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('is not asked for again when the provider answers HTTP %i, failing as %s', async (status, because) => {
    const { access, requests } = await respondedInTurn(enforcingGateway, refusedByTheGateway(status), approve);

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({ _tag: because });
    expect(failure).not.toHaveProperty('schema_refusal');
  });

  it.each([
    ['too long', 'context_length_exceeded', 'request_too_long'],
    ['against its content policy', 'content_filter', 'content_refused'],
  ])('is not asked for again when the provider refuses the request as %s', async (_what, code, because) => {
    const refused = refusedByTheGateway(400, code);
    const { access, requests } = await respondedInTurn(enforcingGateway, refused, approve);

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({ _tag: because });
  });

  it.each([
    ['a text answer', enforcingGateway, textRequest(gatewayModel)],
    ['a JSON answer whose schema was in the instructions already', describingGateway, jsonRequest(gatewayModel)],
  ])('is not asked for again for %s, and keeps the words of a refused request', async (_what, environment, request) => {
    const { access, requests } = await respondedInTurn(environment, refusedByTheGateway(400), approve);

    const failure = await failed(access, request);

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      detail: 'internal answered HTTP 400: the request was rejected as invalid, with the error code 400',
    });
    expect(failure).not.toHaveProperty('schema_refusal');
  });
});

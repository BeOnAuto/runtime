import { recordingJournal } from '@on.auto/definitions/testing';
import { Conflict, InvalidInput, Unavailable } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  ContentRefused,
  CredentialsRejected,
  DefinitionInvalid,
  LanguageModel,
  type ModelFailure,
  ModelNotAllowed,
  OutputInvalid,
  ProviderNotConfigured,
  ProviderUnavailable,
  RateLimited,
  RequestTooLong,
  TimedOut,
} from '../index.ts';
import {
  gatewayError,
  gatewayErrorText,
  gatewayInternals,
  recordingReporter,
} from '../provider-testing/provider-errors.ts';
import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import type { ModelAccessOptions } from '../providers/model-access-options.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { exposedText } from '../testing/exposure.ts';
import { jsonResult, type ScriptedCall, toolCallsResult } from '../testing/model-results.ts';
import {
  reasoningAdapter,
  reasoningOf,
  reasoningWith,
  type Run,
  runContext,
  runContextWith,
} from '../testing/reasoning-runs.ts';
import {
  aGraph,
  attemptOf,
  graphAccessTo,
  graphKey,
  stopping,
  upToTheFirst,
  withGraphTools,
} from '../testing/resumed-attempts.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';

const jsonDefinition = documentOf(
  'model: openai/gpt-5\nconfig: {max_output_tokens: 200}\noutput:\n  format: json\n  schema: {type: object}',
);

function failingWith(failure: () => ModelFailure): Promise<Run> {
  return reasoningWith(() => Effect.fail(failure())).running(jsonDefinition, { text: 'x' });
}

const unknownTokens = { total: null, uncached: null, cache_read: null, cache_write: null };

const spentOnTheCall = {
  record: {
    usage: { input: unknownTokens, output: { total: null, text: null, reasoning: null }, total: null },
    duration_ms: 0,
  },
};

const cannotServe: readonly (readonly [string, () => ModelFailure, string])[] = [
  [
    'provider_not_configured',
    () =>
      new ProviderNotConfigured({
        detail: 'openai is not configured; it needs OPENAI_API_KEY',
        provider: 'openai',
        configured: [],
        missing: ['OPENAI_API_KEY'],
      }),
    'openai is not configured; it needs OPENAI_API_KEY',
  ],
  [
    'provider_not_configured, for a provider it has, such as one whose certificate it does not trust',
    () =>
      new ProviderNotConfigured({
        detail:
          'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
        provider: 'openai',
        configured: ['openai', 'anthropic'],
        missing: ['NODE_EXTRA_CA_CERTS'],
      }),
    'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
  ],
  [
    'credentials_rejected',
    () =>
      new CredentialsRejected({
        detail: 'openai rejected the credentials (HTTP 401)',
        provider: 'openai',
        status: 401,
      }),
    'openai rejected the credentials (HTTP 401)',
  ],
  [
    'rate_limited for 1.5 seconds',
    () =>
      new RateLimited({
        detail: 'openai is limiting the rate of requests',
        provider: 'openai',
        retry_after_ms: 1500,
      }),
    'openai is limiting the rate of requests; try again in 2 seconds',
  ],
  [
    'rate_limited for 20 milliseconds',
    () =>
      new RateLimited({ detail: 'openai is limiting the rate of requests', provider: 'openai', retry_after_ms: 20 }),
    'openai is limiting the rate of requests; try again in 1 second',
  ],
  [
    'rate_limited without a hint',
    () =>
      new RateLimited({
        detail: 'openai is limiting the rate of requests',
        provider: 'openai',
        retry_after_ms: null,
      }),
    'openai is limiting the rate of requests; try again later',
  ],
  [
    'provider_unavailable',
    () =>
      new ProviderUnavailable({
        detail: 'openai could not serve the request (HTTP 503)',
        provider: 'openai',
        status: 503,
      }),
    'openai could not serve the request (HTTP 503); try again later',
  ],
  [
    'timed_out',
    () => new TimedOut({ detail: 'openai did not answer within 65000 ms', provider: 'openai', timeout_ms: 65_000 }),
    'openai did not answer within 65000 ms; try again later',
  ],
];

const gateway = { name: 'internal', base_url: 'https://llm.internal.example/v1', allowed_provider_options: ['user'] };

async function executedWith(providerOptions: string) {
  const recording = recordingFetch(() => jsonResponse(chatCompletion('Hello')));
  const access = await accessFor({ MODEL_GATEWAYS: JSON.stringify([gateway]) }, { fetch: recording.fetch });
  const capability = reasoningAdapter(access);
  const document = documentOf(`model: internal/llama-3.3-70b\nprovider_options:\n  internal: ${providerOptions}`, 'Hi');
  const prepared = Effect.runSync(capability.prepare(document));
  const exit = await Effect.runPromiseExit(prepared.run({}, runContext()));
  return { exit, requests: recording.requests() };
}

function admittingOnly(admit: LanguageModel['Service']['admit']): Promise<Run> {
  const capability = reasoningAdapter({ languageModel: LanguageModel.of({ admit, generate: () => Effect.never }) });
  return Effect.runPromiseExit(Effect.runSync(capability.prepare(jsonDefinition)).run({ text: 'x' }, runContext()));
}

const anyWords: unknown = expect.any(String);

interface ThroughGateway {
  readonly environment: Readonly<Record<string, string>>;
  readonly answer: () => Response;
  readonly scrubbing?: Pick<ModelAccessOptions, 'scrubProviderText'>;
}

async function executed({ environment, answer, scrubbing = {} }: ThroughGateway) {
  const reporter = recordingReporter();
  const access = await accessFor(environment, {
    fetch: recordingFetch(answer).fetch,
    reportProviderMessage: reporter.report,
    ...scrubbing,
  });
  const capability = reasoningAdapter(access);
  const prepared = Effect.runSync(capability.prepare(documentOf('model: gateway/no-such-model-xyz', 'Say hello.')));
  const journal = recordingJournal();
  const exit = await Effect.runPromiseExit(prepared.run({}, runContextWith(journal)));
  return { exit, reports: reporter.reports(), facts: journal.recorded() };
}

function executedThroughGateway(gatewayInProviderMessages: object) {
  return executed({
    environment: { MODEL_GATEWAYS: JSON.stringify([gatewayInProviderMessages]) },
    answer: () => jsonResponse(gatewayError, 404),
  });
}

const gatewayProviderMessages = { name: 'gateway', base_url: 'https://llm.internal.example/v1' };

const keyOfTheSettings = 'fake-key-of-the-settings-0001';

const secretOfTheComposer = 'fake-secret-of-the-composer-0002';

const echoingBothSecrets = {
  error: {
    message: `The key ${keyOfTheSettings} and the token ${secretOfTheComposer} may not call this model`,
    type: null,
    param: null,
    code: `refused_${secretOfTheComposer}`,
  },
};

function scrubProviderText(text: string): string {
  return text.replaceAll(secretOfTheComposer, '[scrubbed]');
}

const usage = {
  input: { total: 900, uncached: 100, cache_read: 800, cache_write: 0 },
  output: { total: 120, text: 100, reasoning: 20 },
  total: 1020,
};

function answeredAfter(milliseconds: number, failureOf: () => ModelFailure): ScriptedReply {
  return () => TestClock.adjust(`${milliseconds} millis`).pipe(Effect.andThen(Effect.fail(failureOf())));
}

function invalidAnswer(finishReason: 'stop' | 'length'): () => ModelFailure {
  return () =>
    new OutputInvalid({
      detail: 'The answer is not JSON',
      provider: 'openai',
      finish_reason: finishReason,
      raw_finish_reason: null,
      usage,
      issues: [],
    });
}

const refused = (): ModelFailure =>
  new ContentRefused({
    detail: 'openai stopped the answer under its content policy',
    provider: 'openai',
    status: null,
    raw_finish_reason: 'content_filter',
    usage,
  });

const stillCalling = answers(
  toolCallsResult([['graph__search', { query: 'acme' }]], {
    usage,
    duration_ms: 1500,
    model: { requested: 'openai/gpt-5', resolved: 'openai/gpt-5', answered: 'gpt-5' },
  }),
);

const record = { usage, duration_ms: 1500 };

function asking(calls: readonly ScriptedCall[]): ScriptedReply {
  return answers(toolCallsResult(calls, { usage, duration_ms: 1500 }));
}

const broken = [1, 2, 3, 4, 5].map((attempt): ScriptedCall => ['graph__broken', { attempt }]);

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

const noLongerAllowed: ScriptedReply = () =>
  Effect.fail(
    new ModelNotAllowed({
      detail: 'anthropic/claude-sonnet-4-5 is not one of the models this server offers',
      provider: 'anthropic',
    }),
  );

async function resumedAtTheStartOf(call: ScriptedCall, entry: Readonly<Record<string, unknown>> = {}) {
  const tools = graphAccessTo((await aGraph()).url, entry);
  const first = reasoningOf({ tools }, asking([call]), stopping);
  await first.running(withGraphTools);
  const attempt = attemptOf(upToTheFirst(first.journal.calls(), 'tool_call_started'));
  return reasoningOf({ tools, attempt, content: first.content }).running(withGraphTools);
}

const keyedWithTools = documentOf(
  [
    'model: anthropic/claude-sonnet-4-5',
    'tools: [graph/search]',
    'output:',
    '  format: json',
    '  schema: {type: object, properties: {key: {type: string, minLength: 20}}, required: [key]}',
  ].join('\n'),
  'Which key?',
);

describe('a provider that signals the request of a run without tools too long', () => {
  it('is unworkable, saying the request was too long by its signal, and advising a shorter prompt', async () => {
    const failure = new RequestTooLong({
      detail: 'openai refused the request as longer than the model takes, by the error code context_length_exceeded',
      provider: 'openai',
      status: 400,
      signal: 'the error code context_length_exceeded',
      provider_message: null,
      last_input_tokens: null,
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'openai refused the request as longer than the model takes, by the error code context_length_exceeded; shorten the prompt or the input of the reasoning function',
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('a provider that rejects the definition', () => {
  it('is a conflict that carries the bounded message of the provider', async () => {
    const failure = new DefinitionInvalid({
      detail: 'openai answered HTTP 404: the model was not found',
      provider: 'openai',
      status: 404,
      provider_message: 'The model gpt-6 does not exist',
      issues: [],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'openai answered HTTP 404: the model was not found; update the reasoning function definition. The provider said: The model gpt-6 does not exist',
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
  });

  it('lists what the request checks found, without a message the provider did not give', async () => {
    const failure = new DefinitionInvalid({
      detail: 'The request is not valid',
      provider: null,
      status: null,
      provider_message: null,
      issues: [{ pointer: '/settings/temperature', detail: 'Expected a finite number' }],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'The request is not valid (/settings/temperature: Expected a finite number); update the reasoning function definition',
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('a JSON answer that is not usable', () => {
  it('is a conflict when it was cut off at the token limit', async () => {
    const failure = new OutputInvalid({
      detail: 'openai stopped the answer at max_output_tokens',
      provider: 'openai',
      finish_reason: 'length',
      raw_finish_reason: 'max_output_tokens',
      usage: null,
      issues: [],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'openai stopped the answer at max_output_tokens (200) before the JSON was complete; raise config.max_output_tokens in the reasoning function definition, or, where one answer holds several pieces of work, give each piece a function of its own',
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
  });

  it('is unavailable when it did not match the schema', async () => {
    const failure = new OutputInvalid({
      detail: 'The answer of openai does not match the output schema',
      provider: 'openai',
      finish_reason: 'stop',
      raw_finish_reason: 'stop',
      usage: null,
      issues: [{ pointer: '/summary', detail: 'Expected string' }],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'The answer of openai does not match the output schema (/summary: Expected string); try again',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('a provider that cannot serve now', () => {
  it.each(cannotServe)('is unavailable, saying which and when to try again: %s', async (_name, failure, detail) => {
    expect(await failingWith(failure)).toEqual(Exit.fail(new Unavailable({ detail, ...spentOnTheCall })));
  });
});

describe('a model outside those its operator allows', () => {
  it('is unavailable of the kind model_not_offered, because it is not allowed', async () => {
    const failure = new ModelNotAllowed({
      detail: 'openai/gpt-5 is not one of the models this server offers',
      provider: 'openai',
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'openai/gpt-5 is not one of the models this server offers',
          kind: 'model_not_offered',
          because: 'model_not_allowed',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('an input the model refuses', () => {
  it('is invalid input', async () => {
    const failure = new ContentRefused({
      detail: 'openai refused the request under its content policy',
      provider: 'openai',
      status: 400,
      raw_finish_reason: null,
      usage: null,
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'openai refused the request under its content policy',
          issues: [{ pointer: '', detail: 'The model refused this input under its content policy' }],
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('a run with provider options for a gateway', () => {
  it('sends the fields its operator allows', async () => {
    const { exit, requests } = await executedWith('{user: tenant-7}');

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests[0]?.body).toMatchObject({ user: 'tenant-7' });
  });

  it('is a conflict naming a field its operator does not allow, and never reaches the gateway', async () => {
    const { exit, requests } = await executedWith('{user: tenant-7, metadata: {budget: unlimited}}');

    expect(exit).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'The gateway internal does not allow the provider option metadata (/provider_options/internal/metadata: The gateway internal does not allow this option); update the reasoning function definition',
          kind: 'unworkable',
        }),
      ),
    );
    expect(requests).toEqual([]);
  });
});

describe('a model of a provider the server does not have', () => {
  it('is unavailable as such when the server has no other provider either', async () => {
    const failure = new ProviderNotConfigured({
      detail: 'openai is not configured; it needs OPENAI_API_KEY',
      provider: 'openai',
      configured: [],
      missing: ['OPENAI_API_KEY'],
    });

    expect(await admittingOnly(() => Effect.fail(failure))).toEqual(
      Exit.fail(new Unavailable({ detail: 'openai is not configured; it needs OPENAI_API_KEY' })),
    );
  });
});

describe('a model of a provider the server does not have, while it has others', () => {
  it('is unavailable of the kind model_not_offered, because its provider is not set up, so that the definition can be switched', async () => {
    const failure = new ProviderNotConfigured({
      detail: 'openai is not configured. Configured providers: anthropic, gateway',
      provider: 'openai',
      configured: ['anthropic', 'gateway'],
      missing: ['OPENAI_API_KEY'],
    });

    expect(await admittingOnly(() => Effect.fail(failure))).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'openai is not configured. Configured providers: anthropic, gateway',
          kind: 'model_not_offered',
          because: 'provider_not_configured',
        }),
      ),
    );
  });
});

describe('a model outside those its operator allows', () => {
  it('is unavailable of the kind model_not_offered at its admission, before any call', async () => {
    const failure = new ModelNotAllowed({
      detail: 'openai/gpt-5 is not one of the models this server offers',
      provider: 'openai',
    });

    expect(await admittingOnly(() => Effect.fail(failure))).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'openai/gpt-5 is not one of the models this server offers',
          kind: 'model_not_offered',
          because: 'model_not_allowed',
        }),
      ),
    );
  });
});

describe('a run whose gateway rejects the definition', () => {
  it('is a conflict built only from the provider, the status and what the status means', async () => {
    const { exit, reports } = await executedThroughGateway(gatewayProviderMessages);

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'conflict',
          detail: anyWords,
          kind: 'unworkable',
        }),
      ),
    );
    expect(gatewayInternals.filter((internal) => exposedText(exit).includes(internal))).toEqual([]);
    expect(reports).toEqual([
      {
        provider: 'gateway',
        model: 'gateway/no-such-model-xyz',
        status: 404,
        message: gatewayErrorText,
        run_id: runContext().id,
      },
    ]);
  });

  it('carries what the gateway said when the operator exposes its messages', async () => {
    const { exit } = await executedThroughGateway({ ...gatewayProviderMessages, expose_provider_messages: true });

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'conflict',
          detail: `gateway answered HTTP 404: the model was not found, with the error code 404; update the reasoning function definition. The provider said: ${gatewayErrorText.slice(0, 300)}`,
          kind: 'unworkable',
        }),
      ),
    );
  });
});

describe('a run whose gateway echoes a secret that only the composer of the model access knows', () => {
  it('keeps it from the caller, the facts of the run and the operator, and the settings secrets stay redacted', async () => {
    const { exit, facts, reports } = await executed({
      environment: {
        MODEL_GATEWAYS: JSON.stringify([
          { ...gatewayProviderMessages, api_key_env: 'KEY', expose_provider_messages: true },
        ]),
        KEY: keyOfTheSettings,
      },
      answer: () => jsonResponse(echoingBothSecrets, 400),
      scrubbing: { scrubProviderText },
    });
    const said = 'The key [redacted] and the token [scrubbed] may not call this model';
    const detail =
      'gateway answered HTTP 400: the request was rejected as invalid, with the error code refused_[scrubbed]';

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'conflict',
          detail: `${detail}; update the reasoning function definition. The provider said: ${said}`,
          kind: 'unworkable',
        }),
      ),
    );
    expect(facts.find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      because: 'definition_invalid',
      detail,
      provider_message: said,
    });
    expect(reports).toMatchObject([{ provider: 'gateway', status: 400, message: said }]);
    const seen = exposedText({ exit, facts, reports });
    expect([seen.includes(keyOfTheSettings), seen.includes(secretOfTheComposer)]).toEqual([false, false]);
  });
});

describe('a run rejected after its model answered', () => {
  it('records the tokens the answer used and how long the model took, whatever the rejection', async () => {
    const keptRecord = { usage, duration_ms: 1500 };

    const runs = await Promise.all(
      [
        ...[invalidAnswer('stop'), invalidAnswer('length'), refused].map((failureOf) => answeredAfter(1500, failureOf)),
        stillCalling,
      ].map((reply) => reasoningWith(reply).running(jsonDefinition, { text: 'x' })),
    );

    expect(runs).toMatchObject([
      Exit.fail(new Unavailable({ detail: 'The answer is not JSON; try again', record: keptRecord })),
      Exit.fail({ _tag: 'conflict', record: keptRecord }),
      Exit.fail({ _tag: 'invalid_input', record: keptRecord }),
      Exit.fail(
        new Unavailable({
          detail: 'openai kept calling tools in the step that withheld them, instead of answering',
          record: keptRecord,
        }),
      ),
    ]);
  });
});

describe('a run that called tools, rejected however it ended', () => {
  it('records the spending of its model calls when its servers failed, its model timed out or was no longer allowed, a call had no known outcome or its content was gone', async () => {
    const tools = graphAccessTo((await aGraph()).url);
    const runs = [
      await reasoningOf({ tools }, asking(broken)).running(withGraphTools),
      await reasoningOf({ tools }, asking([['graph__search', { query: 'acme' }]]), timedOut).running(withGraphTools),
      await reasoningOf({ tools }, asking([['graph__search', { query: 'acme' }]]), noLongerAllowed).running(
        withGraphTools,
      ),
      await resumedAtTheStartOf(['graph__echo', { said: 'acme' }]),
      await resumedAtTheStartOf(['graph__search', { query: 'acme' }], { record_content: false }),
    ];

    expect(runs).toMatchObject([
      Exit.fail({ because: 'server_failed', record }),
      Exit.fail({ because: 'model_unavailable', record }),
      Exit.fail({ kind: 'tools_unfinished', because: 'model_unavailable', record }),
      Exit.fail({ because: 'call_outcome_unknown', record }),
      Exit.fail({ because: 'restarted_without_content', record }),
    ]);
  });
});

describe('a run whose answer no longer matches its schema once the secrets of its tool servers are scrubbed from it', () => {
  it('is unavailable as the answer of a model that did not match its schema, with its spending', async () => {
    const tools = graphAccessTo((await aGraph()).url);
    const answer = JSON.stringify({ key: graphKey });
    const run = reasoningOf(
      { tools },
      answers(jsonResult({ key: graphKey }, { text: answer, usage, duration_ms: 1500 })),
    );

    const scrubbedAway: unknown = expect.stringMatching(
      /^The answer does not match its schema once the secrets .* \(\/key: .*\); try again$/u,
    );

    expect(await run.running(keyedWithTools)).toMatchObject(
      Exit.fail({ _tag: 'unavailable', detail: scrubbedAway, record }),
    );
  });
});

import { recordingJournal } from '@on.auto/definitions/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  gatewayError,
  gatewayErrorText,
  gatewayInternals,
  recordingReporter,
} from '../provider-testing/provider-errors.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import type { ModelAccessOptions } from '../providers/model-access-options.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { exposedText } from '../testing/exposure.ts';
import { reasoningAdapter, runContext, runContextWith } from '../testing/reasoning-runs.ts';

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

function executedThroughGateway(gateway: object) {
  return executed({
    environment: { MODEL_GATEWAYS: JSON.stringify([gateway]) },
    answer: () => jsonResponse(gatewayError, 404),
  });
}

const gateway = { name: 'gateway', base_url: 'https://llm.internal.example/v1' };

describe('a run whose gateway rejects the definition', () => {
  it('is a conflict built only from the provider, the status and what the status means', async () => {
    const { exit, reports } = await executedThroughGateway(gateway);

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'conflict',
          detail:
            'gateway answered HTTP 404: the model was not found, with the error code 404; update the reasoning function definition',
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
    const { exit } = await executedThroughGateway({ ...gateway, expose_provider_messages: true });

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

describe('a run whose gateway echoes a secret that only the composer of the model access knows', () => {
  it('keeps it from the caller, the facts of the run and the operator, and the settings secrets stay redacted', async () => {
    const { exit, facts, reports } = await executed({
      environment: {
        MODEL_GATEWAYS: JSON.stringify([{ ...gateway, api_key_env: 'KEY', expose_provider_messages: true }]),
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

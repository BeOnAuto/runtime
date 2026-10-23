import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  gatewayError,
  gatewayErrorText,
  gatewayInternals,
  recordingReporter,
} from '../provider-testing/provider-errors.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { exposedText } from '../testing/exposure.ts';
import { reasoningAdapter, runContext } from '../testing/reasoning-runs.ts';

async function executedThroughGateway(gateway: object) {
  const reporter = recordingReporter();
  const access = await accessFor(
    { MODEL_GATEWAYS: JSON.stringify([gateway]) },
    { fetch: recordingFetch(() => jsonResponse(gatewayError, 404)).fetch, reportProviderMessage: reporter.report },
  );
  const capability = reasoningAdapter(access);
  const prepared = Effect.runSync(capability.prepare(documentOf('model: gateway/no-such-model-xyz', 'Say hello.')));
  const exit = await Effect.runPromiseExit(prepared.run({}, runContext()));
  return { exit, reports: reporter.reports() };
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

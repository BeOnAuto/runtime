import type { MockLanguageModelV4 } from 'ai/test';
import { Effect, Result } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import { generation } from '../model-calls/generation.ts';
import type { ModelRequest } from '../model/model-request.ts';
import { modelResolution } from '../model/model-resolution.ts';
import type { ModelResult } from '../model/model-result.ts';
import type { ReportOperatorHint } from '../providers/model-access-options.ts';
import { installSdkGlobals } from '../providers/sdk-globals.ts';

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const mockUsage: GenerateResult['usage'] = {
  inputTokens: { total: 120, noCache: 20, cacheRead: 90, cacheWrite: 10 },
  outputTokens: { total: 40, text: 15, reasoning: 25 },
};

export function generatedText(text: string): GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'end_turn' },
    usage: mockUsage,
    warnings: [],
    response: { id: 'response-1', modelId: 'mock-model-2026', timestamp: new Date(0) },
  };
}

export function mockGeneration(model: () => MockLanguageModelV4, reportHint: ReportOperatorHint = () => Effect.void) {
  installSdkGlobals();
  const status = { configured: ['mock'], unconfigured: [] };
  const { generate } = generation(
    modelResolution(new Map([['mock', model]]), { aliases: new Map(), allowed: null, gateways: [] }, status),
    {
      configured: ['mock'],
      showsProviderMessages: () => true,
      scrub: (text) => text,
      report: () => Effect.void,
      reportHint,
      admitsOptions: () => Result.void,
    },
  );
  return {
    generate,
    succeeded: (request: ModelRequest): Promise<ModelResult> => Effect.runPromise(generate(request)),
    failed: (request: ModelRequest): Promise<ModelFailure> => Effect.runPromise(Effect.flip(generate(request))),
    exit: (request: ModelRequest) => Effect.runPromiseExit(generate(request)),
  };
}

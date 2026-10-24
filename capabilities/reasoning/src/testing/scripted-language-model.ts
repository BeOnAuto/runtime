import { Effect, Layer } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import { LanguageModel } from '../model/language-model.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { checkedRequest } from '../model/request-checks.ts';

export type ScriptedReply = (request: ModelRequest) => Effect.Effect<ModelResult, ModelFailure>;

export type ScriptedReplies = ScriptedReply | readonly ScriptedReply[];

export interface ScriptedLanguageModel {
  readonly languageModel: LanguageModel['Service'];
  readonly layer: Layer.Layer<LanguageModel>;
  readonly requests: () => readonly ModelRequest[];
}

export class ScriptExhausted extends Error {
  constructor(calls: number) {
    super(`The scripted language model was called ${calls} times but had no reply left`);
    this.name = 'ScriptExhausted';
  }
}

export function answers(result: ModelResult): ScriptedReply {
  return () => Effect.succeed(result);
}

export function scriptedLanguageModel(...scripted: readonly ScriptedReplies[]): ScriptedLanguageModel {
  const replies = scripted.flat();
  const received: ModelRequest[] = [];
  const languageModel = LanguageModel.of({
    admit: checkedRequest,
    generate: (request) =>
      Effect.suspend(() => {
        received.push(request);
        const reply = replies[received.length - 1];
        return reply === undefined
          ? Effect.die(new ScriptExhausted(received.length))
          : checkedRequest(request).pipe(Effect.andThen(reply(request)));
      }),
  });
  return {
    languageModel,
    layer: Layer.succeed(LanguageModel, languageModel),
    requests: () => [...received],
  };
}

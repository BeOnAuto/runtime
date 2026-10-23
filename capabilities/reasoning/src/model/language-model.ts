import { Context, type Effect } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { AdmissionFailure } from '../failure/request-failure.ts';
import type { ModelRequest } from './model-request.ts';
import type { ModelResult } from './model-result.ts';

export class LanguageModel extends Context.Service<
  LanguageModel,
  {
    readonly admit: (request: ModelRequest) => Effect.Effect<void, AdmissionFailure>;
    readonly generate: (request: ModelRequest) => Effect.Effect<ModelResult, ModelFailure>;
  }
>()('@on.auto/reasoning/LanguageModel') {}

import type { RunContext } from '@on.auto/definitions';
import type { OfferedTool, ToolAccess } from '@on.auto/tool-servers';
import type { Clock } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { PerformJob } from '../jobs/jobs.ts';
import type { ToolCallTelemetry } from '../jobs/performed-in-process.ts';
import type { LanguageModel } from '../model/language-model.ts';
import type { ContentStore } from '../steps/kept-content.ts';
import type { Prompt } from '../steps/step-messages.ts';
import type { ModelReading } from './definition-request.ts';

type PerformJobs = (offered: readonly OfferedTool[]) => PerformJob;

export interface RunServices {
  readonly languageModel: LanguageModel['Service'];
  readonly clock?: Clock.Clock;
  readonly tools: ToolAccess;
  readonly content: ContentStore;
  readonly performJob?: PerformJobs;
  readonly reading?: ModelReading;
  readonly telemetry?: ToolCallTelemetry;
}

export interface Answering {
  readonly languageModel: LanguageModel['Service'];
  readonly access: ToolAccess;
  readonly reading: ModelReading | undefined;
  readonly content: ContentStore;
  readonly perform: PerformJobs;
}

export interface Stepping {
  readonly definition: ReasoningFunctionDefinitionDocument;
  readonly prompt: Prompt;
  readonly run: RunContext;
}

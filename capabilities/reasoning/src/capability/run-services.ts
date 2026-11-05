import type { RunContext } from '@on.auto/definitions';
import type { AskedApproval, OfferedTool, ToolAccess } from '@on.auto/tool-servers';
import type { Clock, Effect } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { PerformJob } from '../jobs/jobs.ts';
import type { ToolCallTelemetry } from '../jobs/performed-in-process.ts';
import type { LanguageModel } from '../model/language-model.ts';
import type { ContentStore, KeepRunImage } from '../steps/kept-content.ts';
import type { Prompt } from '../steps/step-messages.ts';
import type { ModelReading } from './definition-request.ts';

type PerformJobs = (offered: readonly OfferedTool[]) => PerformJob;

export interface ApprovedCall {
  readonly org: string;
  readonly playbook: string;
  readonly run_id: string;
  readonly person: string;
  readonly approved_at: string;
  readonly server: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly asked: AskedApproval;
}

export type SignApproval = (approved: ApprovedCall) => Effect.Effect<string | undefined>;

export interface ApprovalPorts {
  readonly sign?: SignApproval;
}

export interface RunServices {
  readonly languageModel: LanguageModel['Service'];
  readonly clock?: Clock.Clock;
  readonly tools: ToolAccess;
  readonly content: ContentStore;
  readonly images?: KeepRunImage;
  readonly performJob?: PerformJobs;
  readonly reading?: ModelReading;
  readonly telemetry?: ToolCallTelemetry;
  readonly approvals?: ApprovalPorts;
}

export interface Answering {
  readonly languageModel: LanguageModel['Service'];
  readonly access: ToolAccess;
  readonly reading: ModelReading | undefined;
  readonly content: ContentStore;
  readonly images: KeepRunImage | undefined;
  readonly perform: PerformJobs;
  readonly approvals?: ApprovalPorts;
}

export interface Stepping {
  readonly definition: ReasoningFunctionDefinitionDocument;
  readonly prompt: Prompt;
  readonly run: RunContext;
}

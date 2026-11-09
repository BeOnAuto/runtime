import type { CallResult } from '@on.auto/operations';
import type { JsonObject, RunOutcome } from '@on.auto/workflow-engine';
import type { MemoryDriver } from '@on.auto/workflow-engine/testing';

import type { DefinitionArguments } from '../document/definition-arguments.ts';

export type Answer = (definition: DefinitionArguments, run: number) => CallResult;

export interface InputLogPath {
  readonly name: string;
  readonly source: string;
  readonly ends: RunOutcome;
  readonly input?: JsonObject;
  readonly answer?: Answer;
  readonly meanwhile?: (driver: MemoryDriver, runId: string) => void;
}

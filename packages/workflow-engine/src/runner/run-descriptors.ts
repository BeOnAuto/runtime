import type { Context } from '@on.auto/operations';

import type { CallFunctions } from '../dsl/call-functions.ts';
import { objectField, type Json, type JsonObject } from '../dsl/json.ts';
import type { Components } from '../dsl/policy-checks.ts';
import type { RunLimits } from '../machine/run-input.ts';
import { dateTimeOf } from '../machine/utc-time.ts';
import type { ExpressionUnit } from '../programs/expression-units.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import type { RunCell } from './run-cell.ts';
import type { ValueTable } from './run-tables.ts';

export interface MachineSettings {
  readonly functions: CallFunctions;
  readonly runtime: JsonObject;
  readonly contextOf: (attributes: JsonObject, at: string) => Context;
}

export interface MachineOptions extends MachineSettings {
  readonly sandbox: MachineSandbox;
}

export type DecidingOptions = MachineOptions & { readonly unit: ExpressionUnit };

export interface Descriptors {
  readonly runId: () => string;
  readonly attributes: () => JsonObject;
  readonly document: () => JsonObject;
  readonly limits: () => RunLimits;
  readonly startedAt: () => number;
  readonly components: () => Components;
  readonly workflow: () => JsonObject;
}

function documentOf(cell: RunCell): JsonObject {
  return cell.get().state.workflow?.document ?? {};
}

export function descriptorsOf(cell: RunCell, values: ValueTable): Descriptors {
  return {
    runId: () => cell.get().state.runId,
    attributes: () => cell.get().state.attributes,
    document: () => documentOf(cell),
    limits: () => cell.get().state.limits,
    startedAt: () => cell.get().state.startedAt,
    components: () => {
      const use = objectField(documentOf(cell), 'use') ?? {};
      return {
        errors: objectField(use, 'errors') ?? {},
        retries: objectField(use, 'retries') ?? {},
        timeouts: objectField(use, 'timeouts') ?? {},
      };
    },
    workflow: () => {
      const { state } = cell.get();
      const input: Json = state.workflow === null ? null : values.valueOf(state.workflow.input);
      return { id: state.runId, definition: documentOf(cell), input, startedAt: dateTimeOf(state.startedAt) };
    },
  };
}

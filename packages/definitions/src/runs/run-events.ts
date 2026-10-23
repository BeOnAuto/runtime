import { ActedOnRunContextSchema, RunContextSchema, factOf, type Decided } from '@on.auto/operations';
import { CallAnsweredSchema, CallFailedSchema, CallStartedSchema } from '@on.auto/tool-servers';
import { Schema, SchemaTransformation } from 'effect';

import {
  ModelCallAnsweredSchema,
  ModelCallFailedSchema,
  ModelCallStartedSchema,
} from '../run-work/model-call-facts.ts';
import { OutputShapeNameSchema } from '../shapes/shape-names.ts';
import { RunRejectionSchema } from './run.ts';

const numbered = { number: Schema.Int };

export const CancelRequestKindSchema = Schema.Literals(['requested', 'deadline', 'parent_ended']);

const ReplyIdentitySchema = Schema.Struct({ id: Schema.String, sender: Schema.String });

export const RequestAnsweredSchema = Schema.Struct({
  answer: Schema.Json,
  claimed_for: Schema.optionalKey(Schema.String),
  reply: Schema.optionalKey(ReplyIdentitySchema),
});

const coreFactSchemas = [
  factOf(
    'run_started',
    Schema.Struct({
      input: Schema.Json,
      calls_tools: Schema.optionalKey(Schema.Literal(true)),
      finishes_later: Schema.optionalKey(Schema.Literal(true)),
      output_shape: Schema.optionalKey(OutputShapeNameSchema),
    }),
    RunContextSchema,
  ),
  factOf('run_deferred', Schema.Struct({ record: Schema.JsonObject }), RunContextSchema),
  factOf('run_succeeded', Schema.Struct({ output: Schema.Json, record: Schema.JsonObject }), RunContextSchema),
  factOf(
    'run_rejected',
    Schema.Struct({ rejection: RunRejectionSchema, record: Schema.optionalKey(Schema.JsonObject) }),
    RunContextSchema,
  ),
  factOf('run_failed', Schema.Struct({ incident: Schema.optionalKey(Schema.String) }), RunContextSchema),
  factOf(
    'run_cancel_requested',
    Schema.Struct({ kind: CancelRequestKindSchema, reason: Schema.String }),
    ActedOnRunContextSchema,
  ),
  factOf('tool_call_started', Schema.Struct({ ...numbered, ...CallStartedSchema.fields }), RunContextSchema),
  factOf('tool_call_answered', Schema.Struct({ ...numbered, ...CallAnsweredSchema.fields }), RunContextSchema),
  factOf('tool_call_failed', Schema.Struct({ ...numbered, ...CallFailedSchema.fields }), RunContextSchema),
  factOf('model_call_started', Schema.Struct({ ...numbered, ...ModelCallStartedSchema.fields }), RunContextSchema),
  factOf('model_call_answered', Schema.Struct({ ...numbered, ...ModelCallAnsweredSchema.fields }), RunContextSchema),
  factOf('model_call_failed', Schema.Struct({ ...numbered, ...ModelCallFailedSchema.fields }), RunContextSchema),
  factOf('request_answered', RequestAnsweredSchema, RunContextSchema),
];

type CoreRunFact = (typeof coreFactSchemas)[number]['Type'];

const coreTypes: Readonly<Record<CoreRunFact['type'], true>> = {
  run_started: true,
  run_deferred: true,
  run_succeeded: true,
  run_rejected: true,
  run_failed: true,
  run_cancel_requested: true,
  tool_call_started: true,
  tool_call_answered: true,
  tool_call_failed: true,
  model_call_started: true,
  model_call_answered: true,
  model_call_failed: true,
  request_answered: true,
};

export const coreRunFactTypes: readonly string[] = Object.keys(coreTypes);

export function isCoreRunFactType(type: string): boolean {
  return Object.hasOwn(coreTypes, type);
}

const endingTypes: Readonly<Record<RunFinished['type'], true>> = {
  run_succeeded: true,
  run_rejected: true,
  run_failed: true,
};

export function isRunEndingType(type: string): boolean {
  return Object.hasOwn(endingTypes, type);
}

const StoredFactSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: RunContextSchema });

type StoredFact = typeof StoredFactSchema.Type;

const WorkSchema = factOf(
  'work',
  Schema.Struct({ fact: Schema.Struct({ type: Schema.String, data: Schema.JsonObject }) }),
  RunContextSchema,
);

type Work = typeof WorkSchema.Type;

const asWork = SchemaTransformation.transform({
  decode: ({ type, data, context }: StoredFact): Work => ({ type: 'work', data: { fact: { type, data } }, context }),
  encode: ({ data, context }: Work): StoredFact => ({ type: data.fact.type, data: data.fact.data, context }),
});

const CapabilityFactSchema = Schema.Struct({
  ...StoredFactSchema.fields,
  type: Schema.String.check(
    Schema.makeFilter((type: string) => !isCoreRunFactType(type), { expected: 'a fact a capability declares' }),
  ),
});

export type IsDeclared = (fact: StoredFact) => boolean;

export function runEventSchemaOf(isDeclared: IsDeclared) {
  const declared = CapabilityFactSchema.check(
    Schema.makeFilter(isDeclared, { expected: 'a fact a capability of this playbook declares' }),
  );
  return Schema.Union([...coreFactSchemas, declared.pipe(Schema.decodeTo(WorkSchema, asWork))]);
}

function declaredByAnyCapability(): boolean {
  return true;
}

export const RunEventSchema = runEventSchemaOf(declaredByAnyCapability);

export type RecordedRunEvent = typeof RunEventSchema.Type;

export type RunEvent = Decided<RecordedRunEvent>;

type FactNamed<Type extends RunEvent['type']> = Extract<RunEvent, { readonly type: Type }>;

export type RecordedRunFact<Type extends RunEvent['type']> = Extract<RecordedRunEvent, { readonly type: Type }>;

export type RunDeferred = FactNamed<'run_deferred'>;

export type CancelRequestKind = FactNamed<'run_cancel_requested'>['data']['kind'];

export type ToolCallStarted = FactNamed<'tool_call_started'>;

export type ToolCallEnded = FactNamed<'tool_call_answered' | 'tool_call_failed'>;

export type ModelCallStarted = FactNamed<'model_call_started'>;

export type ModelCallEndedFact = FactNamed<'model_call_answered' | 'model_call_failed'>;

export type RequestAnswered = FactNamed<'request_answered'>;

export type ReplyIdentity = typeof ReplyIdentitySchema.Type;

export type RunFinished = FactNamed<'run_succeeded' | 'run_rejected' | 'run_failed'>;

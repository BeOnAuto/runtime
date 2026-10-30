import { Schema } from 'effect';

import type { CallerIdentity } from '../caller/caller.ts';

const forbiddenCharacter = /[\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}]/u;

export const forbiddenCharactersInWords = 'control characters, unpaired surrogates or noncharacters';

export function holdsNoForbiddenCharacter(text: string): boolean {
  return !forbiddenCharacter.test(text);
}

export const refusingForbiddenCharacters = Schema.makeFilter(holdsNoForbiddenCharacter, {
  expected: `text without ${forbiddenCharactersInWords}`,
});

export const mostReferenceBytes = 256;

const utf8 = new TextEncoder();

export function bytesOfReference(reference: string): number {
  return utf8.encode(reference).byteLength;
}

function isWithinTheReferenceBound(reference: string): boolean {
  return bytesOfReference(reference) <= mostReferenceBytes;
}

export const refusingLongReferences = Schema.makeFilter(isWithinTheReferenceBound, {
  expected: `a reference of at most ${mostReferenceBytes} bytes in UTF-8`,
});

export const leastCount = 1;

const ContextText = Schema.String.check(refusingForbiddenCharacters);

export const ContextReference = ContextText.check(refusingLongReferences);

const Counted = Schema.Int.check(Schema.isGreaterThanOrEqualTo(leastCount));

export const CalledBySchema = Schema.Struct({ runId: ContextText, reference: ContextReference, run: Counted });

export type CalledBy = typeof CalledBySchema.Type;

const TriggerKindSchema = Schema.Literals(['event', 'cron', 'every']);

export const StartingTriggerSchema = Schema.Struct({ kind: TriggerKindSchema, reference: ContextReference });

export type StartingTrigger = typeof StartingTriggerSchema.Type;

export const RecordedCallerSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the caller' }),
  name: Schema.String.annotate({
    description:
      "The name of the caller: a person's name as they signed in, the id of a key, the name of the account on the computer in local mode, or the id of the playbook acting as itself",
  }),
});

export type RecordedCaller = typeof RecordedCallerSchema.Type;

export function recordedCallerOf({ id, name }: CallerIdentity): RecordedCaller {
  return { id, name };
}

const acted = { at: ContextText, by: ContextText };

const onTheRun = { runId: ContextText };

const ofTheDefinition = { definitionType: ContextText, definitionName: ContextText, definitionVersion: Counted };

const chain = {
  calledBy: Schema.optionalKey(CalledBySchema),
  callDepth: Schema.optionalKey(Counted),
  depth: Schema.optionalKey(Counted),
  trigger: Schema.optionalKey(StartingTriggerSchema),
};

export const ContextSchema = Schema.Struct({
  ...acted,
  runId: Schema.optionalKey(onTheRun.runId),
  definitionType: Schema.optionalKey(ofTheDefinition.definitionType),
  definitionName: Schema.optionalKey(ofTheDefinition.definitionName),
  definitionVersion: Schema.optionalKey(ofTheDefinition.definitionVersion),
  ...chain,
});

export type Context = typeof ContextSchema.Type;

export const ActedContextSchema = Schema.Struct(acted);

export type ActedContext = typeof ActedContextSchema.Type;

export const ActedOnRunContextSchema = Schema.Struct({ ...acted, ...onTheRun });

export type ActedOnRunContext = typeof ActedOnRunContextSchema.Type;

export const DefinitionContextSchema = Schema.Struct({ ...acted, ...ofTheDefinition });

export type DefinitionContext = typeof DefinitionContextSchema.Type;

export const RunContextSchema = Schema.Struct({ ...acted, ...onTheRun, ...ofTheDefinition, ...chain });

export type RunContext = typeof RunContextSchema.Type;

export const EmittedContextSchema = Schema.Struct({ ...RunContextSchema.fields, depth: Counted });

export type EmittedContext = typeof EmittedContextSchema.Type;

const readContext = Schema.decodeUnknownSync(ContextSchema);

export function contextOf(metadata: unknown): Context {
  return readContext(metadata);
}

export function checkedContext(context: Context): Context {
  return readContext(context);
}

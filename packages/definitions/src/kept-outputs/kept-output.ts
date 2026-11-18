import {
  AssetKeeper,
  Conflict,
  type AssetReference,
  type ConflictKind,
  type PlaybookContext,
  type PlaybookReader,
  type PlaybookWriter,
  type RejectionBecause,
  type ValueKeeping,
} from '@on.auto/operations';
import { sizeInWords } from '@on.auto/phrasing';
import { Effect, JsonPointer, type Schema } from 'effect';

import { jsonBytesOf, mostResultBytes } from '../runs/recorded-size.ts';
import { afterAToolThatMayAct } from '../runs/tool-refusals.ts';
import { keptPlanOf, textOf, type KeptPlan, type MemberToKeep } from './kept-members.ts';

type RunOfAKeptValue = Parameters<ValueKeeping['kept']>[0];

export interface OutputKeeping {
  readonly run: RunOfAKeptValue;
  readonly schema: Schema.JsonObject | undefined;
  readonly calledAToolThatMayChangeSomething: Effect.Effect<boolean, never, PlaybookReader | PlaybookContext>;
}

interface OutputAndRecord {
  readonly output: Schema.Json;
  readonly record: Schema.JsonObject;
}

interface Refusal {
  readonly detail: string;
  readonly kind?: ConflictKind;
  readonly because?: RejectionBecause;
  readonly record?: Schema.JsonObject;
}

interface KeptMember {
  readonly pointer: string;
  readonly reference: AssetReference;
}

const counted = new Intl.NumberFormat('en');

function keptByNoOne(bytes: number): Conflict {
  return new Conflict({
    detail: `The output takes ${counted.format(bytes)} bytes as JSON with the run's record, more than the ${sizeInWords(mostResultBytes)} a run may record; return less, or give each run a part of the input`,
    kind: 'oversized',
  });
}

function referenceOf(reference: AssetReference): Schema.JsonObject {
  return { ...reference };
}

function withMembersKept(of: Schema.JsonArray | Schema.JsonObject, kept: readonly KeptMember[]): Schema.Json {
  const byPointer = new Map(kept.map(({ pointer, reference }) => [pointer, referenceOf(reference)]));
  return Array.isArray(of)
    ? of.map((value: Schema.Json, index) => byPointer.get(`/${index}`) ?? value)
    : Object.fromEntries(
        Object.entries(of).map(([key, value]: readonly [string, Schema.Json]) => [
          key,
          byPointer.get(`/${JsonPointer.escapeToken(key)}`) ?? value,
        ]),
      );
}

type Keeping<Value> = Effect.Effect<Value, Conflict, PlaybookWriter | PlaybookReader | PlaybookContext>;

function keptOne(keeper: ValueKeeping, run: RunOfAKeptValue, member: MemberToKeep): Keeping<AssetReference> {
  return keeper.kept(run, { pointer: member.pointer, text: textOf(member), mediaType: member.mediaType });
}

function keptAsPlanned(
  keeper: ValueKeeping,
  run: RunOfAKeptValue,
  plan: Exclude<KeptPlan, { readonly kept: 'nothing' }>,
): Keeping<Schema.Json> {
  if (plan.kept === 'whole') {
    return Effect.map(keptOne(keeper, run, plan.whole), referenceOf);
  }
  const kept = Effect.forEach(plan.members, (member) =>
    Effect.map(keptOne(keeper, run, member), (reference): KeptMember => ({ pointer: member.pointer, reference })),
  );
  return Effect.map(kept, (members: readonly KeptMember[]) => withMembersKept(plan.of, members));
}

function refusedAfterItsTools(
  calledAToolThatMayChangeSomething: OutputKeeping['calledAToolThatMayChangeSomething'],
): (refusal: Refusal) => Keeping<never> {
  return ({ detail, ...refusal }) =>
    Effect.flatMap(calledAToolThatMayChangeSomething, (mayHaveChanged) =>
      Effect.fail(new Conflict({ detail: mayHaveChanged ? afterAToolThatMayAct(detail) : detail, ...refusal })),
    );
}

export function keptOutputOf(
  answered: OutputAndRecord,
  { run, schema, calledAToolThatMayChangeSomething }: OutputKeeping,
): Keeping<Schema.Json> {
  return Effect.gen(function* () {
    const recordBytes = jsonBytesOf(answered.record);
    const plan = keptPlanOf(answered.output, mostResultBytes - recordBytes, schema);
    if (plan.kept === 'nothing') {
      return answered.output;
    }
    const keeper = yield* AssetKeeper;
    if (keeper === null) {
      return yield* Effect.fail(keptByNoOne(jsonBytesOf(answered.output) + recordBytes));
    }
    return yield* keptAsPlanned(keeper, run, plan);
  }).pipe(Effect.catchTag('conflict', refusedAfterItsTools(calledAToolThatMayChangeSomething)));
}

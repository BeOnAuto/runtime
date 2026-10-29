import { recordedRunIn, type RecordedRun } from '@on.auto/definitions';
import type { RecordedReader, StreamReader } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { predictionDefinitionType } from '../capability/prediction-bounds.ts';
import { buildWorkIn, type Assembled, type BuildWork, type BuildWorkOf } from '../facts/build-facts.ts';
import { askedRunOf } from '../run/prediction-run.ts';

export interface BuildAddress {
  readonly org: string;
  readonly playbook: string;
  readonly id: string;
}

type Uploaded = BuildWorkOf<'candidate_uploaded'>['data'];

type Decided = BuildWorkOf<'candidate_scored' | 'candidate_disqualified'>;

type BaselineFact = BuildWorkOf<'baseline_scored' | 'baseline_not_walked'>;

type Fitted = BuildWorkOf<'candidates_fitted'>['data'];

export interface BuildState {
  readonly address: BuildAddress;
  readonly run: RecordedRun;
  readonly assembled: Assembled | undefined;
  readonly uploads: readonly Uploaded[];
  readonly decided: ReadonlyMap<string, Decided>;
  readonly baselines: ReadonlyMap<string, BaselineFact>;
  readonly fitted: Fitted | undefined;
}

const RequestRecordSchema = Schema.Struct({
  expires_at: Schema.String,
  build: Schema.Struct({
    brief_sha256: Schema.String,
    brief_bytes: Schema.Int,
    training_sha256: Schema.String,
    training_bytes: Schema.Int,
    formats: Schema.Array(Schema.String),
  }),
  waiting_for: Schema.optionalKey(Schema.Struct({ run: Schema.String })),
});

const TrainerlessRecordSchema = Schema.Struct({
  trainer: Schema.Null,
  build: Schema.Struct({ training_sha256: Schema.String, training_bytes: Schema.Int }),
});

const BuildRecordSchema = Schema.Union([RequestRecordSchema, TrainerlessRecordSchema]);

export type RequestRecord = typeof RequestRecordSchema.Type;

export type BuildRecord = typeof BuildRecordSchema.Type;

const decodeRecord = Schema.decodeUnknownOption(BuildRecordSchema);

export function buildRecordOf({ run }: RecordedRun): BuildRecord | undefined {
  return Option.getOrUndefined(decodeRecord(run.record));
}

export function asksATrainer(record: BuildRecord): record is RequestRecord {
  return 'expires_at' in record;
}

function stateOf(address: BuildAddress, run: RecordedRun): BuildState {
  const work = run.work.flatMap((each) => buildWorkIn(each));
  const ofType = <Type extends BuildWork['type']>(...types: readonly Type[]) =>
    work.filter((fact): fact is BuildWorkOf<Type> => types.some((type) => type === fact.type));
  const [assembled] = ofType('dataset_assembled');
  const [fitted] = ofType('candidates_fitted');
  return {
    address,
    run,
    assembled: assembled?.data,
    uploads: ofType('candidate_uploaded').map(({ data }) => data),
    decided: new Map(ofType('candidate_scored', 'candidate_disqualified').map((fact) => [fact.data.sha256, fact])),
    baselines: new Map(ofType('baseline_scored', 'baseline_not_walked').map((fact) => [fact.data.baseline, fact])),
    fitted: fitted?.data,
  };
}

export function buildStateOf(address: BuildAddress, run: RecordedRun | undefined): BuildState | undefined {
  return run === undefined || run.run.type !== predictionDefinitionType || askedRunOf(run.input) !== 'build'
    ? undefined
    : stateOf({ ...address, id: run.run.run_id }, run);
}

export function buildOf(reader: StreamReader, address: BuildAddress): Effect.Effect<BuildState | undefined> {
  return Effect.map(recordedRunIn(reader, address), (run) => buildStateOf(address, run));
}

const FirstSchema = Schema.Tuple([Schema.Struct({ correlationId: Schema.NullOr(Schema.String) })]);

const decodeFirst = Schema.decodeUnknownSync(FirstSchema);

export function correlationOf(ledger: Pick<RecordedReader, 'readRecorded'>, { org, playbook, id }: BuildAddress) {
  return ledger.readRecorded({ org, playbook }, { kind: 'run', run: id }, { order: 'asc', limit: 1, dataOf: [] }).pipe(
    Effect.map(({ records }) => decodeFirst(records.slice(0, 1))[0].correlationId),
    Effect.orDie,
  );
}

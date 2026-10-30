import { runEventOf, type RecordedRunEvent, type RecordedRunFact } from '@on.auto/definitions';
import {
  strictRecordedDecoder,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedStream,
} from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { childReferences, requestReference } from '../build-work/child-runs.ts';
import { predictionDefinitionType } from '../capability/prediction-bounds.ts';
import {
  modelsStreamKind,
  VersionFactSchema,
  versionFactTypes,
  type RecordedVersionFact,
} from '../facts/model-facts.ts';
import { buildRowOf, predictionBuildsName, type BuildRow } from './build-rows.ts';

const DeferredBuildSchema = Schema.Union([
  Schema.Struct({
    expires_at: Schema.String,
    build: Schema.Struct({ brief_sha256: Schema.String }),
    waiting_for: Schema.optionalKey(Schema.Struct({ run: Schema.String })),
  }),
  Schema.Struct({ trainer: Schema.Null, build: Schema.Struct({ training_sha256: Schema.String }) }),
]);

type DeferredBuild = typeof DeferredBuildSchema.Type;

const decodeDeferred = Schema.decodeUnknownOption(DeferredBuildSchema);

type RunType = RecordedRunEvent['type'];

type Asking = Pick<BuildRow, 'standing' | 'through' | 'expires_at' | 'next_due_at' | 'scoring_since'>;

function askingOf(record: DeferredBuild, at: number): Asking {
  if ('trainer' in record) {
    return { standing: 'scoring', through: null, expires_at: null, next_due_at: at, scoring_since: at };
  }
  const through = record.waiting_for !== undefined;
  return {
    standing: through ? 'starting_request' : 'waiting_for_trainer',
    through: record.waiting_for?.run ?? null,
    expires_at: Date.parse(record.expires_at),
    next_due_at: through ? at : null,
    scoring_since: null,
  };
}

function deferred(
  { data, context }: RecordedRunFact<'run_deferred'>,
  message: ProjectedMessage,
): ProjectedRow | undefined {
  if (context.definitionType !== predictionDefinitionType) {
    return undefined;
  }
  return Option.getOrUndefined(
    Option.map(decodeDeferred(data.record), (record): BuildRow => {
      const at = Date.parse(context.at);
      return {
        function: context.definitionName,
        definition_version: context.definitionVersion,
        ...askingOf(record, at),
        requested_at: at,
        uploaded: 0,
        scored: 0,
        winner: null,
        version: null,
        rule: null,
        shadow_origins: 0,
        open: true,
        ended: null,
        staged: false,
        cause: message.id,
      };
    }),
  );
}

function changedBy(row: BuildRow, message: ProjectedMessage, changes: Partial<BuildRow>): BuildRow {
  return { ...row, ...changes, cause: message.id };
}

function dueNow(row: BuildRow, message: ProjectedMessage, changes: Partial<BuildRow> = {}): BuildRow {
  return changedBy(row, message, { ...changes, next_due_at: Date.parse(message.context.at) });
}

function scoringFrom(row: BuildRow, message: ProjectedMessage): BuildRow {
  return dueNow(row, message, { standing: 'scoring', scoring_since: Date.parse(message.context.at) });
}

function ownEnding(row: BuildRow, type: RunType, message: ProjectedMessage): BuildRow {
  const ended = { scoring_since: null, ended: type };
  const versioned = type === 'run_succeeded' && row.version !== null;
  return versioned ? dueNow(row, message, ended) : dueNow(row, message, { ...ended, standing: 'ended', open: false });
}

function childEnding(row: BuildRow, type: RunType, message: ProjectedMessage): BuildRow {
  const answered =
    message.context.calledBy?.reference === requestReference && type === 'run_succeeded' && row.standing !== 'ended';
  return answered ? scoringFrom(row, message) : dueNow(row, message);
}

function onRun(row: BuildRow, fact: RecordedRunEvent, message: ProjectedMessage): BuildRow | undefined {
  const child = childReferences.has(message.context.calledBy?.reference ?? '');
  if (fact.type === 'run_started') {
    return child && row.standing === 'starting_request'
      ? changedBy(row, message, { standing: 'waiting_for_trainer', next_due_at: null })
      : undefined;
  }
  if (fact.type === 'request_answered') {
    return scoringFrom(row, message);
  }
  return child ? childEnding(row, fact.type, message) : ownEnding(row, fact.type, message);
}

const uploadType = 'candidate_uploaded';

const scoringTypes = [
  'candidates_fitted',
  'candidate_scored',
  'candidate_disqualified',
  'baseline_scored',
  'baseline_not_walked',
];

const workTypes: ReadonlySet<string> = new Set([uploadType, ...scoringTypes]);

function onWork(row: BuildRow, type: string, message: ProjectedMessage): BuildRow {
  if (type === uploadType) {
    return changedBy(row, message, { uploaded: row.uploaded + 1, staged: true });
  }
  return type === 'candidate_scored' || type === 'candidate_disqualified'
    ? dueNow(row, message, { scored: row.scored + 1 })
    : dueNow(row, message);
}

function onModel(row: BuildRow, fact: RecordedVersionFact, message: ProjectedMessage): BuildRow {
  if (fact.type === 'version_built') {
    const { version, file, rule } = fact.data;
    return dueNow(row, message, { standing: 'in_shadow', scoring_since: null, version, winner: file.sha256, rule });
  }
  if (fact.type === 'shadow_predicted') {
    return dueNow(row, message, { shadow_origins: row.shadow_origins + (fact.data.of === fact.data.version ? 1 : 0) });
  }
  if (fact.type === 'shadow_passed') {
    return dueNow(row, message, { standing: row.rule === 'approved' ? 'awaiting_approval' : row.standing });
  }
  return fact.type === 'version_activated' || fact.type === 'activation_refused'
    ? dueNow(row, message, { standing: 'ended', open: false })
    : dueNow(row, message);
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = runEventOf(message);
  if (fact?.type === 'run_deferred') {
    return row === undefined ? deferred(fact, message) : undefined;
  }
  const kept = buildRowOf(row);
  if (kept === undefined) {
    return undefined;
  }
  if (workTypes.has(message.type)) {
    return onWork(kept, message.type, message);
  }
  return fact === undefined ? onModel(kept, decodeModelFact(message), message) : onRun(kept, fact, message);
}

const decodeModelFact = strictRecordedDecoder(VersionFactSchema);

function keyOf(message: ProjectedMessage, stream: ProjectedStream): string | undefined {
  if (stream.kind === modelsStreamKind) {
    const build: unknown = Reflect.get(new Object(message.data), 'build');
    return typeof build === 'string' ? build : undefined;
  }
  const calledBy = message.context.calledBy;
  return calledBy !== undefined && childReferences.has(calledBy.reference) ? calledBy.runId : stream.id;
}

const runTypes = ['run_started', 'request_answered', 'run_succeeded', 'run_rejected', 'run_failed'];

const types = ['run_deferred', ...runTypes, ...workTypes, ...versionFactTypes];

export const predictionBuilds: KeyedProjection = {
  name: predictionBuildsName,
  version: 1,
  kinds: ['runs', modelsStreamKind],
  types,
  columns: [
    { name: 'function', kind: 'text' },
    { name: 'definition_version', kind: 'integer' },
    { name: 'standing', kind: 'text' },
    { name: 'through', kind: 'text' },
    { name: 'requested_at', kind: 'integer' },
    { name: 'expires_at', kind: 'integer' },
    { name: 'uploaded', kind: 'integer' },
    { name: 'scored', kind: 'integer' },
    { name: 'winner', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'rule', kind: 'text' },
    { name: 'shadow_origins', kind: 'integer' },
    { name: 'next_due_at', kind: 'integer' },
    { name: 'open', kind: 'boolean' },
    { name: 'scoring_since', kind: 'integer' },
    { name: 'ended', kind: 'text' },
    { name: 'staged', kind: 'boolean' },
    { name: 'cause', kind: 'text' },
  ],
  indexes: [
    { name: 'by_open', columns: ['function', 'open', 'requested_at', 'row_key'] },
    { name: 'builds_due', columns: ['next_due_at'], acrossPlaybooks: true, whereSet: 'next_due_at' },
    { name: 'builds_scoring', columns: ['scoring_since'], acrossPlaybooks: true, whereSet: 'scoring_since' },
  ],
  keyOf,
  advanced: [
    { column: 'next_due_at', setBy: [...runTypes, ...scoringTypes, ...versionFactTypes] },
    { column: 'staged', setBy: [uploadType] },
  ],
  rowAfter,
};

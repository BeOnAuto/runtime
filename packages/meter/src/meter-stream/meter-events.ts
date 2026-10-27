import { ActedContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

export const METER_STREAM = 'meter';

const PointSchema = Schema.Array(Schema.String);

const FaultReasonSchema = Schema.Literals(['history_removed', 'history_rewritten', 'unreadable']);

export const MeterEventSchema = Schema.Union([
  factOf('installation_identified', Schema.Struct({ installation: Schema.String }), ActedContextSchema),
  factOf(
    'actions_counted',
    Schema.Struct({
      actions: Schema.Int,
      through: PointSchema,
      last: Schema.String,
      digest: Schema.String,
      started: Schema.Array(Schema.String),
      lapsed: Schema.Array(Schema.String),
    }),
    ActedContextSchema,
  ),
  factOf('action_admitted', Schema.Struct({ run: Schema.String, until: Schema.String }), ActedContextSchema),
  factOf('metering_faulted', Schema.Struct({ reason: FaultReasonSchema, detail: Schema.String }), ActedContextSchema),
]);

export type MeterEvent = typeof MeterEventSchema.Type;

type FaultReason = typeof FaultReasonSchema.Type;

interface Checkpoint {
  readonly actions: number;
  readonly through: readonly string[];
  readonly last: string;
  readonly digest: string;
}

interface Hold {
  readonly run: string;
  readonly until: string;
}

export interface Fault {
  readonly reason: FaultReason;
  readonly detail: string;
}

export interface MeterState {
  readonly installation: string | undefined;
  readonly checkpoint: Checkpoint | undefined;
  readonly holds: readonly Hold[];
  readonly fault: Fault | undefined;
}

export const noMeter: MeterState = { installation: undefined, checkpoint: undefined, holds: [], fault: undefined };

export function evolveMeter(state: MeterState, event: MeterEvent): MeterState {
  if (event.type === 'installation_identified') {
    return { ...state, installation: event.data.installation };
  }
  if (event.type === 'actions_counted') {
    const { actions, through, last, digest, started, lapsed } = event.data;
    const gone = new Set([...started, ...lapsed]);
    return {
      ...state,
      checkpoint: { actions, through, last, digest },
      holds: state.holds.filter(({ run }) => !gone.has(run)),
    };
  }
  if (event.type === 'action_admitted') {
    return { ...state, holds: [...state.holds, event.data] };
  }
  return { ...state, fault: event.data };
}

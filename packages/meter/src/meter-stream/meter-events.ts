import { ActedContextSchema, factOf } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { SignedSchema } from '../licensing/signed-answers.ts';
import { allocationAfter, AllocationEventSchema, type Allocation } from './allocation-events.ts';

export const METER_STREAM = 'meter';

const PointSchema = Schema.Array(Schema.String);

const FaultReasonSchema = Schema.Literals(['history_removed', 'history_rewritten', 'unreadable']);

const LicenseSchema = Schema.Struct({
  installation: Schema.String,
  org: Schema.String,
  plan: Schema.String,
  issued_at: Schema.String,
  expires_at: Schema.String,
  key_sha256: Schema.String,
  entitlement: SignedSchema,
});

const ReportSchema = Schema.Struct({
  actions: Schema.Int,
  through: Schema.NullOr(PointSchema),
  last: Schema.NullOr(Schema.String),
});

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
  factOf('license_activated', LicenseSchema, ActedContextSchema),
  factOf('license_refreshed', LicenseSchema, ActedContextSchema),
  factOf(
    'license_invalidated',
    Schema.Struct({ key_sha256: Schema.String, detail: Schema.String }),
    ActedContextSchema,
  ),
  factOf('usage_reported', ReportSchema, ActedContextSchema),
  factOf(
    'metering_repaired',
    Schema.Struct({ id: Schema.String, reason: Schema.String, issued_at: Schema.String, repair: SignedSchema }),
    ActedContextSchema,
  ),
  AllocationEventSchema,
]);

export type MeterEvent = typeof MeterEventSchema.Type;

export type LicenseRecord = typeof LicenseSchema.Type;

export type Report = typeof ReportSchema.Type;

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

export interface License {
  readonly installation: string;
  readonly org: string;
  readonly plan: string;
  readonly expires_at: string;
  readonly key_sha256: string;
  readonly invalid: string | undefined;
}

export interface MeterState {
  readonly installation: string | undefined;
  readonly checkpoint: Checkpoint | undefined;
  readonly holds: readonly Hold[];
  readonly fault: Fault | undefined;
  readonly license: License | undefined;
  readonly reported: Report | undefined;
  readonly repairs: readonly string[];
  readonly allocation: Allocation | undefined;
}

export const noMeter: MeterState = {
  installation: undefined,
  checkpoint: undefined,
  holds: [],
  fault: undefined,
  license: undefined,
  reported: undefined,
  repairs: [],
  allocation: undefined,
};

function licensed({ installation, org, plan, expires_at: expiresAt, key_sha256: sha256 }: LicenseRecord): License {
  return { installation, org, plan, expires_at: expiresAt, key_sha256: sha256, invalid: undefined };
}

type LicenseEvent = Extract<MeterEvent, { type: `license_${string}` }>;

type AllocationEvent = Extract<MeterEvent, { type: `allocation_${string}` }>;

function isLicenseEvent(event: MeterEvent): event is LicenseEvent {
  return event.type.startsWith('license_');
}

function isAllocationEvent(event: MeterEvent): event is AllocationEvent {
  return event.type.startsWith('allocation_');
}

function licenseAfter(license: License | undefined, event: LicenseEvent): License | undefined {
  if (event.type !== 'license_invalidated') return licensed(event.data);
  return Option.getOrUndefined(
    Option.map(Option.fromNullishOr(license), (standing) => ({ ...standing, invalid: event.data.detail })),
  );
}

function counted(state: MeterState, data: Extract<MeterEvent, { type: 'actions_counted' }>['data']): MeterState {
  const { actions, through, last, digest, started, lapsed } = data;
  const gone = new Set([...started, ...lapsed]);
  return {
    ...state,
    checkpoint: { actions, through, last, digest },
    holds: state.holds.filter(({ run }) => !gone.has(run)),
  };
}

export function evolveMeter(state: MeterState, event: MeterEvent): MeterState {
  if (isAllocationEvent(event)) return { ...state, allocation: allocationAfter(state.allocation, event) };
  if (isLicenseEvent(event)) return { ...state, license: licenseAfter(state.license, event) };
  if (event.type === 'installation_identified') return { ...state, installation: event.data.installation };
  if (event.type === 'actions_counted') return counted(state, event.data);
  if (event.type === 'action_admitted') return { ...state, holds: [...state.holds, event.data] };
  if (event.type === 'metering_faulted') return { ...state, fault: event.data };
  if (event.type === 'usage_reported') return { ...state, reported: event.data };
  return { ...state, fault: undefined, checkpoint: undefined, repairs: [...state.repairs, event.data.id] };
}

import { ActedContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

import {
  admittedAfter,
  AdmittedSchema,
  flooredAt,
  heldAfter,
  noneAdmitted,
  type Admitted,
  type Hold,
} from './admission-events.ts';
import { allocationAfter, AllocationEventSchema, type Allocation } from './allocation-events.ts';
import {
  heldLicenseOf,
  InvalidatedSchema,
  keyRefusedOf,
  LicenseRecordSchema,
  type HeldLicense,
  type KeyRefused,
} from './license-events.ts';

export const METER_STREAM = 'meter';

const ReportSchema = Schema.Struct({ actions: Schema.Int, licensed: Schema.Int });

export const MeterEventSchema = Schema.Union([
  factOf('installation_identified', Schema.Struct({ installation: Schema.String }), ActedContextSchema),
  factOf('action_admitted', AdmittedSchema, ActedContextSchema),
  factOf('license_activated', LicenseRecordSchema, ActedContextSchema),
  factOf('license_renewed', LicenseRecordSchema, ActedContextSchema),
  factOf('license_invalidated', InvalidatedSchema, ActedContextSchema),
  factOf('usage_reported', ReportSchema, ActedContextSchema),
  AllocationEventSchema,
]);

export type MeterEvent = typeof MeterEventSchema.Type;

export type Report = typeof ReportSchema.Type;

export interface MeterState {
  readonly installation: string | undefined;
  readonly admitted: Admitted;
  readonly recent: readonly Hold[];
  readonly license: HeldLicense | undefined;
  readonly refused: KeyRefused | undefined;
  readonly reported: Report | undefined;
  readonly allocation: Allocation | undefined;
}

export const noMeter: MeterState = {
  installation: undefined,
  admitted: noneAdmitted,
  recent: [],
  license: undefined,
  refused: undefined,
  reported: undefined,
  allocation: undefined,
};

type AllocationEvent = Extract<MeterEvent, { type: `allocation_${string}` }>;

function isAllocationEvent(event: MeterEvent): event is AllocationEvent {
  return event.type.startsWith('allocation_');
}

type AdmissionEvent = Extract<MeterEvent, { type: 'action_admitted' }>;

function admittedBy(state: MeterState, { data: { run, until, basis }, context: { at } }: AdmissionEvent): MeterState {
  return {
    ...state,
    admitted: admittedAfter(state.admitted, basis, at),
    recent: heldAfter(state.recent, { run, until }, at),
  };
}

type LicenseEvent = Extract<MeterEvent, { type: 'license_activated' | 'license_renewed' }>;

function licensedBy(state: MeterState, { data, context: { at } }: LicenseEvent): MeterState {
  return {
    ...state,
    admitted: flooredAt(state.admitted, data.charged_through),
    license: heldLicenseOf(data, at),
    refused: undefined,
  };
}

export function evolveMeter(state: MeterState, event: MeterEvent): MeterState {
  if (isAllocationEvent(event)) return { ...state, allocation: allocationAfter(state.allocation, event) };
  if (event.type === 'installation_identified') return { ...state, installation: event.data.installation };
  if (event.type === 'action_admitted') return admittedBy(state, event);
  if (event.type === 'license_invalidated') return { ...state, refused: keyRefusedOf(event.data) };
  if (event.type === 'usage_reported') return { ...state, reported: event.data };
  return licensedBy(state, event);
}

import type { RunDispatch } from '@on.auto/definitions';
import { offlineCheckpoint, type QuoteContext } from '@on.auto/metering';
import { OrgIdSchema, PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import type { RuntimeRunOptions, SingleRunLimits } from './records.ts';

const place = Schema.decodeUnknownSync(Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema }));
const runId = Schema.decodeUnknownSync(Schema.String.check(Schema.isUUID()));
const finiteLimit = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const limits = Schema.decodeUnknownSync(
  Schema.Struct({ deadlineMs: finiteLimit, budget: finiteLimit, memoryBytes: finiteLimit }),
);

export const runtimeQuoteVersion = 'auto.runtime.single-run.v1';

export function canonicalRunId(id: string): string {
  return runId(id).toLowerCase();
}

function canonical(value: Schema.Json): Schema.Json {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item: Schema.Json) => canonical(item));
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([a]: readonly [string, Schema.Json], [b]: readonly [string, Schema.Json]) => (a < b ? -1 : 1))
      .map(([key, item]: readonly [string, Schema.Json]) => [key, canonical(item)]),
  );
}

export function inputDigest(input: Schema.Json): Promise<string> {
  return offlineCheckpoint(JSON.stringify(canonical(input)));
}

export function playbookIdentity(run: Pick<RunDispatch, 'org' | 'playbook'>): string {
  const checked = place(run);
  return `runtime:${checked.org}:${checked.playbook}`;
}

export function playbookAddress(identity: string): ReturnType<typeof place> | undefined {
  const parts = identity.split(':');
  if (parts.length !== 3 || parts[0] !== 'runtime') return undefined;
  return place({ org: parts[1], playbook: parts[2] });
}

export function capabilityOf(run: RunDispatch): 'computation' | 'recall' {
  if (run.calledBy !== null || !['computation', 'recall'].includes(run.definition.type))
    throw new Error('runtime_quote_unbounded');
  return Schema.decodeUnknownSync(Schema.Literals(['computation', 'recall']))(run.definition.type);
}

export async function bindingOf(
  run: RunDispatch,
  bounds: SingleRunLimits,
): Promise<Pick<QuoteContext, 'definitionVersion' | 'inputDigest' | 'limitsDigest'>> {
  const { type, name, version, source } = run.definition;
  return {
    definitionVersion: JSON.stringify([runtimeQuoteVersion, type, name, version, await offlineCheckpoint(source)]),
    inputDigest: await inputDigest(run.input),
    limitsDigest: await offlineCheckpoint(JSON.stringify(limits(bounds))),
  };
}

export function capturedOptions(options: RuntimeRunOptions): RuntimeRunOptions {
  return {
    ...options,
    meter: { ...options.meter, license: { ...options.meter.license }, accounting: { ...options.meter.accounting } },
    limits: structuredClone(options.limits),
  };
}

import type { CreditSource } from '../funding/lots.ts';
import { licenseInteger } from '../licenses/claim-values.ts';

export function offlineRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError('Offline evidence must contain an object');
  }
  return Object.fromEntries(Object.entries(value));
}

export function offlineTime(value: unknown): number {
  const time = licenseInteger(value);
  if (time > 8_640_000_000_000_000) throw new RangeError('Offline time is outside the supported date range');
  return time;
}

export function offlineSource(value: unknown): CreditSource {
  if (
    value !== 'welcome' &&
    value !== 'free' &&
    value !== 'subscription' &&
    value !== 'topup' &&
    value !== 'enterprise' &&
    value !== 'adjustment'
  ) {
    throw new RangeError('The offline credit source is unsupported');
  }
  return value;
}

export function offlineList(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new RangeError('Offline evidence requires a nonempty bounded list');
  }
  return value;
}

import { rebuiltEvents } from './checkpoint-events.ts';
import type { DecidedEvent, Invalidating, Licensing, Repairing, Reporting } from './meter-commands.ts';
import type { MeterState } from './meter-events.ts';

export function licensedEvents({ license }: Licensing, state: MeterState): readonly DecidedEvent[] {
  const identified: readonly DecidedEvent[] =
    state.installation === undefined
      ? [{ type: 'installation_identified', data: { installation: license.installation } }]
      : [];
  const standing = state.license;
  const isRefresh = standing?.key_sha256 === license.key_sha256 && standing.invalid === undefined;
  return [...identified, { type: isRefresh ? 'license_refreshed' : 'license_activated', data: license }];
}

export function invalidatedEvents(
  { key_sha256: sha256, invalidity }: Invalidating,
  state: MeterState,
): readonly DecidedEvent[] {
  const standing = state.license;
  const stands = standing?.key_sha256 === sha256 && standing.invalid === undefined;
  return stands ? [{ type: 'license_invalidated', data: { key_sha256: sha256, ...invalidity } }] : [];
}

export function identifiedEvents(installation: string, state: MeterState): readonly DecidedEvent[] {
  return state.installation === undefined ? [{ type: 'installation_identified', data: { installation } }] : [];
}

export function reportedEvents({ report }: Reporting): readonly DecidedEvent[] {
  return [{ type: 'usage_reported', data: report }];
}

export function repairedEvents(command: Repairing, state: MeterState): readonly DecidedEvent[] {
  const { id, reason, issued_at: issuedAt, repair, counting, at } = command;
  return [
    { type: 'metering_repaired', data: { id, reason, issued_at: issuedAt, repair } },
    ...rebuiltEvents(state, counting, at),
  ];
}

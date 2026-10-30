import type { DecidedEvent, Invalidating, Licensing, Reporting } from './meter-commands.ts';
import type { MeterState } from './meter-events.ts';

export function identifiedEvents(installation: string, state: MeterState): readonly DecidedEvent[] {
  return state.installation === undefined ? [{ type: 'installation_identified', data: { installation } }] : [];
}

export function licensedEvents({ license }: Licensing, state: MeterState): readonly DecidedEvent[] {
  return [...identifiedEvents(license.installation, state), { type: 'license_activated', data: license }];
}

export function invalidatedEvents(
  { key_sha256: sha256, invalidity }: Invalidating,
  { refused }: MeterState,
): readonly DecidedEvent[] {
  const same =
    refused?.key_sha256 === sha256 && refused.detail === invalidity.detail && refused.because === invalidity.because;
  return same ? [] : [{ type: 'license_invalidated', data: { key_sha256: sha256, ...invalidity } }];
}

export function reportedEvents({ report, license }: Reporting): readonly DecidedEvent[] {
  return [
    { type: 'usage_reported', data: report },
    { type: 'license_renewed', data: license },
  ];
}

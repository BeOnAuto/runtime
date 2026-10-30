import { writeFileSync } from 'node:fs';

import { waitForeverAnnouncing } from '@on.auto/api/testing';
import { Schema } from 'effect';

export const callInFlightFileVariable = 'CALL_IN_FLIGHT_FILE';

const decodeFile = Schema.decodeUnknownSync(Schema.NonEmptyString);

export function callInFlightAnnouncedIn(environment: Readonly<Record<string, string | undefined>>): () => void {
  return () => {
    writeFileSync(decodeFile(environment[callInFlightFileVariable]), '');
  };
}

export function waitForeverAnnouncedIn(environment: Readonly<Record<string, string | undefined>>) {
  return waitForeverAnnouncing(callInFlightAnnouncedIn(environment));
}

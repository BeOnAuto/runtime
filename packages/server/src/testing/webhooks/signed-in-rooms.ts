import { defaultOrg } from '@on.auto/openid-connect';
import { onTestFinished } from 'vitest';

import { personSigningIn } from '../../sign-in/person-signing-in.ts';
import { roomsServer, servedWithRooms, theWebhookUrl } from '../interaction-servers/room-events.ts';
import { receivingOtlp } from '../telemetry/otlp-receiver.ts';

/** A server that signs people in, given WEBHOOK_URL, and the key of the person it signs in. */
export async function signingPeopleIn() {
  const signing = await personSigningIn();
  return {
    signingIn: { ...signing.environment, WEBHOOK_URL: theWebhookUrl },
    asThePerson: { key: (origin: string) => signing.tokenAt(origin, 'Ada') },
  };
}

/** A server that signs people in, given WEBHOOK_URL, connected to the rooms service. */
export async function signingInWithRooms(environment: Readonly<Record<string, string>> = {}) {
  const rooms = await roomsServer();
  const { signingIn, asThePerson } = await signingPeopleIn();
  const server = await servedWithRooms(rooms, { ...signingIn, ...environment }, asThePerson, defaultOrg);
  return { rooms, server };
}

/** The same server, exporting its traces to a receiver the test reads. */
export async function tracedWithRooms() {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  const { rooms, server } = await signingInWithRooms({
    OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
  });
  return { receiver, rooms, server };
}

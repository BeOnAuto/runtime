import { isHeldBy, type Generation, type RecordedSubscription, type SubscriptionFailureKind } from '@on.auto/providers';

import { isMadePerApp, type Hearing } from './connection-hearing.ts';

type NotListeningKind =
  | 'workflow_paused'
  | 'connection_gone'
  | 'connection_pending'
  | 'connection_broken'
  | 'not_received_here'
  | 'app_credential_needed'
  | 'account_not_recorded'
  | 'setting_up'
  | 'access_lacking'
  | 'request_failed'
  | 'service_not_answering'
  | 'too_many_places';

export interface ConnectionAsRecorded {
  readonly status: 'pending' | 'connected' | 'broken';
  readonly accountRecorded: boolean;
  readonly identified: boolean;
}

export interface Subscribed {
  readonly topic: string;
  readonly recorded: RecordedSubscription | undefined;
  readonly generation: Generation;
}

export interface TriggerRecords {
  readonly connection: string;
  readonly paused: boolean;
  readonly recorded: ConnectionAsRecorded | undefined;
  readonly hearing: Hearing;
  readonly actorDeclared: boolean;
  readonly subscribed: Subscribed | undefined;
}

type TriggerStood =
  | { readonly listening: true }
  | {
      readonly listening: false;
      readonly kind: NotListeningKind;
      readonly detail: string;
      readonly needsReconnecting: boolean;
    };

interface Named {
  readonly connection: string;
  readonly place: string;
  readonly label: string;
}

const notListeningWords: Readonly<Record<NotListeningKind, (named: Named) => string>> = {
  workflow_paused: () =>
    'The workflow is paused, so nothing starts it. `resume_definition` resumes it, and it then starts for what happens from then on.',
  connection_gone: ({ connection }) =>
    `No connection named ${connection} serves this playbook any more, so this trigger starts nothing. \`list_connections\` lists the connections and the playbooks that may use each.`,
  connection_pending: ({ connection }) =>
    `The connection ${connection} is not connected yet. Ask the person to finish connecting it; \`reconnect_connection\` gives a new link.`,
  connection_broken: ({ connection }) =>
    `The connection ${connection} is broken, so the app cannot tell Auto. \`reconnect_connection\` gives a link for the person; once they have used it, this trigger listens again by itself. It does not start for what happened in between.`,
  not_received_here: ({ connection }) =>
    `This runtime no longer receives these events from ${connection}. Tell the person, and ask whether the workflow should start on a schedule instead.`,
  app_credential_needed: ({ connection, label }) =>
    `The connection ${connection} needs its ${label} to hear this, and holds none the app accepts. \`reconnect_connection\` gives a link where the person gives one.`,
  account_not_recorded: ({ connection }) =>
    `Auto has not yet read which account ${connection} acts as, so it starts nothing from it. This takes a moment after connecting: read the workflow again shortly. If it stays, ask the person to reconnect it.`,
  setting_up: () => 'Auto is setting this up with the app now. Read the workflow again shortly.',
  access_lacking: ({ connection, place }) =>
    `The app did not let ${connection} set this up in ${place}: its account lacks the access that takes. Ask the person to reconnect it with an account that has that access there; \`reconnect_connection\` gives the link.`,
  request_failed: ({ connection, place }) =>
    `The app refused Auto's request to listen in ${place}, or its answer could not be read. Check that the subject names a place that exists, written as the connection's list says, and save the workflow again. If it is right, ask the person to reconnect ${connection}.`,
  service_not_answering: () =>
    "The app did not take Auto's request just now. Auto tries again by itself; nothing needs doing.",
  too_many_places: ({ connection, place }) =>
    `${connection} already listens in as many places as one connection can for this playbook, so it does not listen in ${place}. Listen in fewer places, or in places its other workflows already listen in.`,
};

const mendedByReconnecting: ReadonlySet<NotListeningKind> = new Set([
  'connection_broken',
  'app_credential_needed',
  'access_lacking',
  'request_failed',
]);

const keptUntilReconnected: Readonly<
  Record<Exclude<SubscriptionFailureKind, 'unreachable' | 'not_sent'>, NotListeningKind>
> = {
  connection_broken: 'connection_broken',
  scope_lacking: 'access_lacking',
  tool_error: 'request_failed',
};

function failedKindOf({ recorded, generation }: Subscribed): NotListeningKind | undefined {
  const failed = recorded?.failed;
  if (failed === undefined) {
    return undefined;
  }
  if (failed.kind === 'unreachable') {
    return 'service_not_answering';
  }
  if (failed.kind === 'not_sent') {
    return 'too_many_places';
  }
  return isHeldBy(failed, generation) ? keptUntilReconnected[failed.kind] : 'setting_up';
}

function isMadeAsDeclared({ recorded, generation }: Subscribed): boolean {
  return recorded?.made?.declared === generation.declared;
}

function heardKindOf(records: TriggerRecords, recorded: ConnectionAsRecorded): NotListeningKind | undefined {
  const { hearing, subscribed, actorDeclared } = records;
  const failed = subscribed === undefined ? undefined : failedKindOf(subscribed);
  if (failed !== undefined) {
    return failed;
  }
  const accountWanted = hearing.kind === 'heard' && isMadePerApp(hearing.destination) && !recorded.accountRecorded;
  if (accountWanted || (actorDeclared && !recorded.identified)) {
    return 'account_not_recorded';
  }
  return subscribed === undefined || isMadeAsDeclared(subscribed) ? undefined : 'setting_up';
}

function recordedKindOf(records: TriggerRecords, recorded: ConnectionAsRecorded): NotListeningKind | undefined {
  if (recorded.status === 'pending') {
    return 'connection_pending';
  }
  if (recorded.status === 'broken') {
    return 'connection_broken';
  }
  if (records.hearing.kind === 'not_heard') {
    return 'not_received_here';
  }
  return records.hearing.kind === 'lacking' ? 'app_credential_needed' : heardKindOf(records, recorded);
}

function kindOf(records: TriggerRecords): NotListeningKind | undefined {
  if (records.paused) {
    return 'workflow_paused';
  }
  return records.recorded === undefined ? 'connection_gone' : recordedKindOf(records, records.recorded);
}

function namedIn({ connection, hearing, subscribed }: TriggerRecords): Named {
  return {
    connection,
    place: subscribed?.topic ?? '',
    label: hearing.kind === 'lacking' ? hearing.label : '',
  };
}

export function triggerStandingOf(records: TriggerRecords): TriggerStood {
  const kind = kindOf(records);
  return kind === undefined
    ? { listening: true }
    : {
        listening: false,
        kind,
        detail: notListeningWords[kind](namedIn(records)),
        needsReconnecting: mendedByReconnecting.has(kind),
      };
}

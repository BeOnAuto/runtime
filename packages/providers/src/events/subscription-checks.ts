import { readStartTemplates, readTemplates, type Destination, type DestinationIssue } from './destination-fields.ts';
import {
  answerIssuesOf,
  callIssuesOf,
  placesTheSecret,
  renewTemplates,
  topicTemplates,
  subscribeTemplates,
  textIssues,
  unsubscribeTemplates,
  type Placed,
} from './event-calls.ts';
import { pathOf } from './json-texts.ts';

function issuesOf(placed: readonly Placed[]): readonly DestinationIssue[] {
  return placed.map(({ pointer, detail }) => ({ path: pathOf(pointer), issue: detail }));
}

function subscribeIssuesOf({ type, subscribe }: Destination): readonly Placed[] {
  if (subscribe === undefined) {
    return [];
  }
  const { subscribed } = subscribe;
  return [
    ...callIssuesOf('/subscribe', subscribe, subscribeTemplates(type === 'queue' ? 'queue' : 'webhook')),
    ...answerIssuesOf([
      ['/subscribe/subscribed/id', subscribed.id],
      ['/subscribe/subscribed/expires_at', subscribed.expires_at],
      ['/subscribe/subscribed/secret', subscribed.secret],
    ]),
  ];
}

function readIssuesOf({ read }: Destination): readonly Placed[] {
  if (read === undefined) {
    return [];
  }
  return [
    ...callIssuesOf('/read', read, readTemplates),
    ...(read.start === undefined ? [] : textIssues(readStartTemplates, '/read/start', read.start)),
    ...answerIssuesOf([
      ['/read/list', read.list],
      ['/read/cursor', read.cursor],
      ['/read/next_page_token', read.next_page_token],
    ]),
  ];
}

function callsIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const { topic, renew, unsubscribe } = destination;
  return issuesOf([
    ...(topic === undefined ? [] : textIssues(topicTemplates, '/topic', topic)),
    ...subscribeIssuesOf(destination),
    ...(renew === undefined
      ? []
      : [
          ...callIssuesOf('/renew', renew, renewTemplates),
          ...answerIssuesOf([['/renew/renewed/expires_at', renew.renewed?.expires_at]]),
        ]),
    ...(unsubscribe === undefined ? [] : callIssuesOf('/unsubscribe', unsubscribe, unsubscribeTemplates)),
    ...readIssuesOf(destination),
  ]);
}

const unlapsing =
  'Expected lease_seconds, or expires_at among what subscribe answers, since a subscription is renewed before it lapses';

function lapseIssuesOf({ renew, lease_seconds: lease, subscribe }: Destination): readonly DestinationIssue[] {
  return renew === undefined || lease !== undefined || subscribe?.subscribed.expires_at !== undefined
    ? []
    : [{ path: ['renew'], issue: unlapsing }];
}

const provenOtherwise =
  "Expected no secret of the subscription, neither {{ secret }} nor subscribed.secret: the destination's deliveries are proven otherwise";

const twoSecrets =
  "Expected one secret of the subscription, Auto's, placed as {{ secret }}, or the service's, which subscribed.secret points to, and not both";

const noSecret =
  'Expected one secret here: write {{ secret }} in the call where the service takes a secret, or point subscribed.secret at the secret the call returns. Auto verifies the webhooks with that secret';

function subscriptionSecretIssueOf(subscribe: Destination['subscribe'], provenByIt: boolean): string | undefined {
  if (subscribe === undefined) {
    return undefined;
  }
  const placed = placesTheSecret(subscribe);
  const answered = subscribe.subscribed.secret !== undefined;
  if (!provenByIt) {
    return placed || answered ? provenOtherwise : undefined;
  }
  if (placed !== answered) {
    return undefined;
  }
  return placed ? twoSecrets : noSecret;
}

const ofTheApp = "Expected app: a destination per app proves its deliveries with the app's own secret";

function secretIssuesOf({ per, verify, subscribe }: Destination): readonly DestinationIssue[] {
  const provenBySubscription = verify?.secret === 'subscription';
  if (per === 'app') {
    return provenBySubscription ? [{ path: ['verify', 'secret'], issue: ofTheApp }] : [];
  }
  const issue = per === 'subscription' ? subscriptionSecretIssueOf(subscribe, provenBySubscription) : undefined;
  return issue === undefined ? [] : [{ path: ['subscribe'], issue }];
}

export function subscriptionIssuesOf(destination: Destination): readonly DestinationIssue[] {
  return [...callsIssuesOf(destination), ...lapseIssuesOf(destination), ...secretIssuesOf(destination)];
}

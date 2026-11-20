import {
  arrangesNoSubscription,
  subscribesForEachPlace,
  transportOf,
  type Destination,
  type DestinationIssue,
} from './destination-fields.ts';
import { answerIssuesOf, eventTopicTemplates, textIssues } from './event-calls.ts';
import { provesTheBody, provesTheBodyAndATime } from './event-proofs.ts';
import { pathOf } from './json-texts.ts';
import { expressionIssueOf, inEveryPlaceOf, type ExpressionPlace } from './runtime-expressions.ts';

type Path = readonly (string | number)[];

function expressionIssuesAt(
  path: Path,
  expression: string | undefined,
  place: ExpressionPlace,
): readonly DestinationIssue[] {
  const issue = expression === undefined ? undefined : expressionIssueOf(expression, place);
  return issue === undefined ? [] : [{ path, issue }];
}

const noConditions = 'Expected at least one runtime expression with the values it may equal';

type Conditions = Readonly<Record<string, readonly (string | null)[]>>;

function conditionIssuesOf(path: Path, when: Conditions, place: ExpressionPlace): readonly DestinationIssue[] {
  const expressions = Object.keys(when);
  return expressions.length === 0
    ? [{ path, issue: noConditions }]
    : expressions.flatMap((expression) => expressionIssuesAt([...path, expression], expression, place));
}

const namesNoSubscription =
  'Expected subscription only in the filter of a destination per subscription, whose arrivals name the subscription Auto made';

function filterIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const { filter } = destination;
  const place = inEveryPlaceOf(transportOf(destination));
  return [
    ...conditionIssuesOf(['filter', 'when'], filter.when, place),
    ...expressionIssuesAt(['filter', 'subscription'], filter.subscription, place),
    ...expressionIssuesAt(['filter', 'conversation'], filter.conversation, place),
    ...expressionIssuesAt(['filter', 'automatic'], filter.automatic, place),
    ...(filter.subscription !== undefined && arrangesNoSubscription(destination)
      ? [{ path: ['filter', 'subscription'], issue: namesNoSubscription }]
      : []),
  ];
}

type DeliveredReply = NonNullable<Destination['filter']['reply']>;

const placesOfAReply: readonly (keyof DeliveredReply)[] = ['id', 'sender', 'text', 'to', 'time', 'changed'];

const fromTheBody = 'since a reply is read from the body alone, which the proof covers';

function replyPlaceOf(destination: Destination): ExpressionPlace {
  return transportOf(destination) === 'request'
    ? { transport: 'request', sources: ['body'], because: fromTheBody }
    : { transport: 'message', sources: ['payload'], because: fromTheBody };
}

const unproven =
  'Expected reply only where verify proves every byte of the body and a time, as standard-webhooks does, and hmac where it signs {payload} and a timestamp: a secret or a signed token in a header proves who sent a delivery, not that its body is theirs, so such a destination only makes Auto read';

const unowned =
  'Expected reply only beside connection, where a delivery names the account it happened in, so that a reply is taken only for the connections made in it';

const unplaced =
  "Expected reply only beside conversation, where a delivery names the conversation the reply was posted in, since a message's id may be unique only within its conversation, so that a reply is taken only for the request sent there as the message it answers";

function replyIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const { filter, verify, connection } = destination;
  const { reply } = filter;
  if (reply === undefined) {
    return [];
  }
  const place = replyPlaceOf(destination);
  return [
    ...placesOfAReply.flatMap((field) => expressionIssuesAt(['filter', 'reply', field], reply[field], place)),
    ...(verify !== undefined && provesTheBodyAndATime(verify) ? [] : [{ path: ['filter', 'reply'], issue: unproven }]),
    ...(connection === undefined ? [{ path: ['filter', 'reply'], issue: unowned }] : []),
    ...(filter.conversation === undefined ? [{ path: ['filter', 'reply'], issue: unplaced }] : []),
  ];
}

type DeclaredEvent = NonNullable<Destination['events']>[number];

const placesOfAnEvent: readonly ('time' | 'subject')[] = ['time', 'subject'];

const whereEachApplies: readonly ('automatic' | 'changed')[] = ['automatic', 'changed'];

function whereItAppliesIssuesOf(
  path: Path,
  declared: string | Conditions | undefined,
  place: ExpressionPlace,
): readonly DestinationIssue[] {
  return typeof declared === 'object'
    ? conditionIssuesOf(path, declared, place)
    : expressionIssuesAt(path, declared, place);
}

function eventPlaceOf(destination: Destination): ExpressionPlace {
  return transportOf(destination) === 'request'
    ? {
        transport: 'request',
        sources: ['body'],
        because: 'since an event is read from the body alone, which the proof covers',
      }
    : {
        transport: 'message',
        sources: ['payload'],
        because: "since an event is read from the message's payload alone",
      };
}

const unprovenEvents =
  'Expected events only on a websocket, or on a webhook whose verify proves every byte of the body, as standard-webhooks does, and as hmac does where it signs {payload}. A secret or a signed token in a header proves who sent a delivery but not that its body is theirs, and nothing proves what a queue holds, so such a destination can only tell Auto to read the replies now';

const noTopic =
  'Expected topic, because this destination is made per subscription. Write the topic Auto subscribes to for this event, as a Liquid template that reads subject';

const topicOnlyPerSubscription =
  'Expected no topic, because only an event of a destination made per subscription takes one';

function eventTopicIssuesOf(destination: Destination, { topic }: DeclaredEvent, at: Path): readonly DestinationIssue[] {
  const subscribing = subscribesForEachPlace(destination);
  if (topic === undefined) {
    return subscribing ? [{ path: at, issue: noTopic }] : [];
  }
  if (!subscribing) {
    return [{ path: [...at, 'topic'], issue: topicOnlyPerSubscription }];
  }
  return textIssues(eventTopicTemplates, '/topic', topic).map(({ pointer, detail }) => ({
    path: [...at, ...pathOf(pointer)],
    issue: detail,
  }));
}

function mappingIssuesOf(
  destination: Destination,
  declared: DeclaredEvent,
  index: number,
): readonly DestinationIssue[] {
  const at = ['events', index];
  const place = eventPlaceOf(destination);
  return [
    ...conditionIssuesOf([...at, 'when'], declared.when, place),
    ...declared.id.flatMap((part, each) => expressionIssuesAt([...at, 'id', each], part, place)),
    ...placesOfAnEvent.flatMap((field) => expressionIssuesAt([...at, field], declared[field], place)),
    ...whereEachApplies.flatMap((field) => whereItAppliesIssuesOf([...at, field], declared[field], place)),
    ...Object.entries(declared.data ?? {}).flatMap(([field, expression]: readonly [string, string]) =>
      expressionIssuesAt([...at, 'data', field], expression, place),
    ),
    ...(declared.own ?? []).flatMap((part, each) => expressionIssuesAt([...at, 'own', each], part, place)),
    ...eventTopicIssuesOf(destination, declared, at),
  ];
}

function isProvenWhole({ type, verify }: Destination): boolean {
  return type === 'websocket' || (verify !== undefined && provesTheBody(verify));
}

function eventIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const { events } = destination;
  if (events === undefined) {
    return [];
  }
  return [
    ...events.flatMap((declared, index) => mappingIssuesOf(destination, declared, index)),
    ...(isProvenWhole(destination) ? [] : [{ path: ['events'], issue: unprovenEvents }]),
  ];
}

const onlyAnHmacKeys =
  "Expected hmac only where the destination's proof is hmac, whose hash, encoding and secret key it";

function handshakeIssuesOf({ handshake, verify }: Destination): readonly DestinationIssue[] {
  if (handshake === undefined) {
    return [];
  }
  const place = inEveryPlaceOf('request');
  return [
    ...conditionIssuesOf(['handshake', 'when'], handshake.when, place),
    ...expressionIssuesAt(['handshake', 'challenge'], handshake.challenge, place),
    ...Object.entries(handshake.response ?? {})
      .filter(([, answered]: readonly [string, string]) => answered === 'hmac' && verify?.scheme !== 'hmac')
      .map(([field]: readonly [string, string]) => ({ path: ['handshake', 'response', field], issue: onlyAnHmacKeys })),
  ];
}

function connectionIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const place = inEveryPlaceOf(transportOf(destination));
  return [
    ...expressionIssuesAt(['connection', 'account'], destination.connection?.account, place),
    ...expressionIssuesAt(['connection', 'user'], destination.connection?.user, place),
  ];
}

function acknowledgeIssuesOf(destination: Destination): readonly DestinationIssue[] {
  return expressionIssuesAt(['acknowledge'], destination.acknowledge, inEveryPlaceOf(transportOf(destination)));
}

const writtenOutWhole = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#][^{}\s]*)?$/u;

const notWrittenOutWhole = 'Expected an https URL written out whole';

function openIssuesOf({ open }: Destination): readonly DestinationIssue[] {
  if (open === undefined) {
    return [];
  }
  return [
    ...(writtenOutWhole.test(open.url) ? [] : [{ path: ['open', 'url'], issue: notWrittenOutWhole }]),
    ...answerIssuesOf([['/open/address', open.address]]).map(({ pointer, detail }) => ({
      path: pathOf(pointer),
      issue: detail,
    })),
  ];
}

export function arrivalIssuesOf(destination: Destination): readonly DestinationIssue[] {
  return [
    ...filterIssuesOf(destination),
    ...replyIssuesOf(destination),
    ...eventIssuesOf(destination),
    ...handshakeIssuesOf(destination),
    ...connectionIssuesOf(destination),
    ...openIssuesOf(destination),
    ...acknowledgeIssuesOf(destination),
  ];
}

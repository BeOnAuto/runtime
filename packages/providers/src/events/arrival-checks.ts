import { arrangesNoSubscription, transportOf, type Destination, type DestinationIssue } from './destination-fields.ts';
import { answerIssuesOf } from './event-calls.ts';
import { provesTheBodyAndATime } from './event-proofs.ts';
import { pathOf } from './json-texts.ts';
import { expressionIssueOf, inEveryPlaceOf, type ExpressionPlace } from './runtime-expressions.ts';

function expressionIssuesAt(
  path: readonly string[],
  expression: string | undefined,
  place: ExpressionPlace,
): readonly DestinationIssue[] {
  const issue = expression === undefined ? undefined : expressionIssueOf(expression, place);
  return issue === undefined ? [] : [{ path, issue }];
}

const noConditions = 'Expected at least one runtime expression with the values it may equal';

function conditionIssuesOf(
  path: readonly string[],
  when: Readonly<Record<string, readonly string[]>>,
  place: ExpressionPlace,
): readonly DestinationIssue[] {
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
    ...handshakeIssuesOf(destination),
    ...connectionIssuesOf(destination),
    ...openIssuesOf(destination),
    ...acknowledgeIssuesOf(destination),
  ];
}

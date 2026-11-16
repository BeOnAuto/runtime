import { isToolName, toolNameShape } from '@on.auto/tool-servers/policy';

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
  'Expected subscription only in the wake of a destination per subscription, whose arrivals name the subscription Auto made';

function wakeIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const { wake } = destination;
  const place = inEveryPlaceOf(transportOf(destination));
  return [
    ...conditionIssuesOf(['wake', 'when'], wake.when, place),
    ...expressionIssuesAt(['wake', 'subscription'], wake.subscription, place),
    ...expressionIssuesAt(['wake', 'conversation'], wake.conversation, place),
    ...expressionIssuesAt(['wake', 'automatic'], wake.automatic, place),
    ...(wake.subscription !== undefined && arrangesNoSubscription(destination)
      ? [{ path: ['wake', 'subscription'], issue: namesNoSubscription }]
      : []),
  ];
}

type DeliveredReply = NonNullable<Destination['wake']['reply']>;

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

function replyIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const { wake, verify, connection } = destination;
  const { reply } = wake;
  if (reply === undefined) {
    return [];
  }
  const place = replyPlaceOf(destination);
  return [
    ...placesOfAReply.flatMap((field) => expressionIssuesAt(['wake', 'reply', field], reply[field], place)),
    ...(verify !== undefined && provesTheBodyAndATime(verify) ? [] : [{ path: ['wake', 'reply'], issue: unproven }]),
    ...(connection === undefined ? [{ path: ['wake', 'reply'], issue: unowned }] : []),
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

const writtenOutWhole = /^wss:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#][^{}\s]*)?$/u;

function openedAt(url: string, given: boolean): readonly DestinationIssue[] {
  if (given) {
    return [{ path: ['open'], issue: 'Expected tool and address, or url, and not both' }];
  }
  return writtenOutWhole.test(url)
    ? []
    : [{ path: ['open', 'url'], issue: "Expected a wss URL written out whole, the address of the service's socket" }];
}

function openIssuesOf({ open }: Destination): readonly DestinationIssue[] {
  if (open === undefined) {
    return [];
  }
  const { tool, address, url } = open;
  if (url !== undefined) {
    return openedAt(url, tool !== undefined || address !== undefined);
  }
  if (tool === undefined || address === undefined) {
    return [
      { path: ['open'], issue: "Expected tool and address, the JSON Pointer to the socket's address it answers" },
    ];
  }
  return [
    ...(isToolName(tool) ? [] : [{ path: ['open', 'tool'], issue: `Expected ${toolNameShape}` }]),
    ...answerIssuesOf([['/open/address', address]]).map(({ pointer, detail }) => ({
      path: pathOf(pointer),
      issue: detail,
    })),
  ];
}

export function arrivalIssuesOf(destination: Destination): readonly DestinationIssue[] {
  return [
    ...wakeIssuesOf(destination),
    ...replyIssuesOf(destination),
    ...handshakeIssuesOf(destination),
    ...connectionIssuesOf(destination),
    ...openIssuesOf(destination),
    ...acknowledgeIssuesOf(destination),
  ];
}

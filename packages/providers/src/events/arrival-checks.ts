import { isToolName, toolNameShape } from '@on.auto/tool-servers/policy';

import { arrangesNoSubscription, transportOf, type Destination, type DestinationIssue } from './destination-fields.ts';
import { answerIssuesOf } from './event-calls.ts';
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
    ...handshakeIssuesOf(destination),
    ...connectionIssuesOf(destination),
    ...openIssuesOf(destination),
    ...acknowledgeIssuesOf(destination),
  ];
}

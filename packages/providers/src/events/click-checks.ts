import type { Destination, DestinationIssue } from './destination-fields.ts';
import { conditionIssuesOf, expressionIssuesAt, provesAReply, replyPlaceOf } from './expression-issues.ts';

const placesOfAClick: readonly ('account' | 'conversation' | 'to' | 'sender' | 'action' | 'id' | 'time')[] = [
  'account',
  'conversation',
  'to',
  'sender',
  'action',
  'id',
  'time',
];

const unprovenClick =
  'Expected click only on a websocket, or on a webhook whose verify proves every byte of the body and a time, as standard-webhooks does, and as hmac does where it signs {payload} and a timestamp. A secret or a signed token in a header proves who sent a delivery but not that its body is theirs, and nothing proves what a queue holds, so Auto cannot know that a person clicked what such a destination delivers';

const unownedClick =
  'Expected click only beside connection, where a delivery names the account it happened in, so that a click is taken only for the connections made in it';

export function clickIssuesOf(destination: Destination): readonly DestinationIssue[] {
  const click = destination.filter?.click;
  if (click === undefined) {
    return [];
  }
  const place = replyPlaceOf(destination);
  return [
    ...conditionIssuesOf(['filter', 'click', 'when'], click.when, place),
    ...placesOfAClick.flatMap((field) => expressionIssuesAt(['filter', 'click', field], click[field], place)),
    ...(provesAReply(destination) ? [] : [{ path: ['filter', 'click'], issue: unprovenClick }]),
    ...(destination.connection === undefined ? [{ path: ['filter', 'click'], issue: unownedClick }] : []),
  ];
}

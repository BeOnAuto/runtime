import { plainNumber } from '@on.auto/operations';
import { toolInWords } from '@on.auto/tool-servers';

import type {
  DeliveryEnded,
  DeliveryFailedBecause,
  DeliveryRefusedBecause,
  DeliveryStarted,
  ReplyRefused,
} from './run-facts.ts';

const refusedWords: Readonly<Record<DeliveryRefusedBecause, string>> = {
  too_large: 'its arguments are larger than a call may send',
  unworkable: 'its arguments cannot be rendered for this request',
};

const failedWords: Readonly<Record<DeliveryFailedBecause, string>> = {
  timed_out: 'the tool server did not answer in time',
  too_large: 'the tool answered more than one call may take',
  tool_not_offered: 'this server no longer offers the tool it names',
  tool_error: 'the tool answered with an error',
  arguments_refused: 'the tool server refused its arguments',
  server_failure: 'the tool server failed',
  lost: 'the server stopped before it learned how the attempt ended',
};

export function deliveryStarted({ data }: DeliveryStarted): string {
  return `Delivery attempt ${plainNumber(data.number)} of the request started, through ${toolInWords(data)}.`;
}

export function deliveryEnded({ type, data }: DeliveryEnded): string {
  const attempt = `Delivery attempt ${plainNumber(data.number)}`;
  if (type === 'delivery_succeeded') {
    return `${attempt} was delivered.`;
  }
  return type === 'delivery_failed'
    ? `${attempt} failed, because ${failedWords[data.because]}; another follows on the schedule, unless it was the last.`
    : `${attempt} was refused, because ${refusedWords[data.because]}, so it is not tried again.`;
}

export function replyRefused({ data }: ReplyRefused): string {
  const told = data.told ? 'the party was told how to answer' : 'nobody was told';
  return `A reply from the party was not an answer the function takes, and ${told}.`;
}

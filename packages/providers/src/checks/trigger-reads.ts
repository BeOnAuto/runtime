import { readTopicOf, type TriggerRead } from '@on.auto/definitions/trigger-reads';

import type { Polled } from '../subscriptions/subscription-records.ts';

function inTheItem(pointer: string): string {
  return `$message.payload#${pointer}`;
}

interface ReadOfATrigger {
  readonly topic: string;
  readonly destination: Polled;
}

export function readOfATrigger(type: string, read: TriggerRead): ReadOfATrigger {
  return { topic: readTopicOf(type, read), destination: polledOfATrigger(type, read) };
}

export function polledOfATrigger(type: string, read: TriggerRead): Polled {
  const { tool, with: written, list, order, cursor, next_page_token: nextPageToken, start, id, time } = read;
  return {
    type: 'polling',
    read: {
      tool,
      ...(written === undefined ? {} : { with: written }),
      list,
      order,
      ...(cursor === undefined ? {} : { cursor }),
      ...(nextPageToken === undefined ? {} : { next_page_token: nextPageToken }),
      ...(start === undefined ? {} : { start }),
    },
    events: [
      {
        type,
        when: {},
        id: id.map((pointer) => inTheItem(pointer)),
        ...(time === undefined ? {} : { time: inTheItem(time) }),
      },
    ],
    writtenInATrigger: true,
  };
}

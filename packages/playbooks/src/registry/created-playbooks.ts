import { recordedDecoder } from '@on.auto/operations';
import { Option } from 'effect';

import { PlaybookEventSchema } from './playbook-events.ts';

const decodePlaybookEvent = recordedDecoder(PlaybookEventSchema);

export function playbookCreatedOf(recorded: unknown): string | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodePlaybookEvent(recorded), (event) =>
      event.type === 'playbook_created' ? Option.some(event.data.playbook) : Option.none(),
    ),
  );
}

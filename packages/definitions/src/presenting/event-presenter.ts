import { strictRecordedDecoder, type ChangesNamed, type Presenter, type Recorded } from '@on.auto/operations';
import type { Schema } from 'effect';

export interface Account {
  readonly summary: string;
  readonly data: Schema.JsonObject;
}

export interface EventPresenting<Event extends Recorded> {
  readonly streamKind: string;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
  readonly types: readonly Event['type'][];
  readonly hidden?: readonly string[];
  readonly account: (event: Event, subject: string) => Account;
  readonly changes: ChangesNamed;
}

export function eventPresenter<Event extends Recorded>({
  streamKind,
  eventSchema,
  types,
  hidden = [],
  account,
  changes,
}: EventPresenting<Event>): Presenter {
  const decode = strictRecordedDecoder(eventSchema);
  const subjectStart = streamKind.length + 1;
  return {
    streamKind,
    publicNames: Object.fromEntries([
      ...types.map((type): readonly [string, readonly string[]] => [type, [type]]),
      ...hidden.map((type): readonly [string, readonly string[]] => [type, []]),
    ]),
    present: (recorded) => {
      const event = decode(recorded);
      return [{ type: event.type, ...account(event, recorded.stream.slice(subjectStart)) }];
    },
    changes,
  };
}

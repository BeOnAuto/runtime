import type { Digested } from '@on.auto/content';
import {
  playbookPayloadReader,
  type PlaybookContext,
  type PlaybookReader,
  type PlaybookWriter,
} from '@on.auto/operations';
import type { Payload } from '@on.auto/operations/payloads';
import { Context, Data, Effect } from 'effect';

import type { DefinitionTexts, TextName, TextsAsRecorded } from './definition-texts.ts';
import { textWritten, type WrittenAs } from './payload-writing.ts';
import type { PayloadUnread } from './run-payloads.ts';

export type TextsByDigest = ReadonlyMap<string, string>;

export const TextsInHand = Context.Reference<TextsByDigest>('@on.auto/definitions/TextsInHand', {
  defaultValue: () => new Map(),
});

export interface TextsWritten {
  readonly texts: TextsAsRecorded;
  readonly inHand: TextsByDigest;
}

type Keeping = PlaybookWriter | PlaybookContext;

function optionalTextWritten(text: string | undefined): Effect.Effect<WrittenAs<string> | undefined, never, Keeping> {
  return text === undefined ? Effect.undefined : textWritten(text);
}

export function textsWritten(written: DefinitionTexts<string>): Effect.Effect<TextsWritten, never, Keeping> {
  return Effect.map(
    Effect.all(
      [textWritten(written.source), optionalTextWritten(written.overview), optionalTextWritten(written.diagram)],
      { concurrency: 'unbounded' },
    ),
    ([source, overview, diagram]: readonly [
      WrittenAs<string>,
      WrittenAs<string> | undefined,
      WrittenAs<string> | undefined,
    ]): TextsWritten => ({
      texts: {
        source: source.payload,
        ...(overview === undefined ? {} : { overview: overview.payload }),
        ...(diagram === undefined ? {} : { diagram: diagram.payload }),
      },
      inHand: new Map(
        [source, overview, diagram].flatMap((each) => (each === undefined ? [] : Array.from(each.inHand))),
      ),
    }),
  );
}

export class DefinitionTextUnread extends Data.TaggedError('definition_text_unread')<{
  readonly name: TextName;
  readonly because: PayloadUnread;
}> {}

type ReadInTheCall<A> = Effect.Effect<A, DefinitionTextUnread, PlaybookReader | PlaybookContext>;

function unread(name: TextName, because: PayloadUnread) {
  return () => Effect.fail(new DefinitionTextUnread({ name, because }));
}

function keptTextRead(name: TextName, kept: Digested) {
  return Effect.flatMap(playbookPayloadReader, (payloads) => payloads.text(kept)).pipe(
    Effect.catchTags({
      unavailable: unread(name, 'unavailable'),
      payload_missing: unread(name, 'missing'),
      payload_erased: unread(name, 'erased'),
    }),
  );
}

export function textRead(name: TextName, text: Payload<string>): ReadInTheCall<string> {
  if ('inline' in text) {
    return Effect.succeed(text.inline);
  }
  return TextsInHand.use((inHand) => {
    const known = inHand.get(text.kept.sha256);
    return known === undefined ? keptTextRead(name, text.kept) : Effect.succeed(known);
  });
}

function optionalTextRead(name: TextName, text: Payload<string> | undefined): ReadInTheCall<string | undefined> {
  return text === undefined ? Effect.undefined : textRead(name, text);
}

export function textsRead({ source, overview, diagram }: TextsAsRecorded): ReadInTheCall<DefinitionTexts<string>> {
  return Effect.map(
    Effect.all(
      [textRead('source', source), optionalTextRead('overview', overview), optionalTextRead('diagram', diagram)],
      { concurrency: 'unbounded' },
    ),
    ([sourceRead, overviewRead, diagramRead]: readonly [string, string | undefined, string | undefined]) => ({
      source: sourceRead,
      ...(overviewRead === undefined ? {} : { overview: overviewRead }),
      ...(diagramRead === undefined ? {} : { diagram: diagramRead }),
    }),
  );
}

export function textsByDigestOf(recorded: TextsAsRecorded, read: DefinitionTexts<string>): TextsByDigest {
  return new Map(
    (['source', 'overview', 'diagram'] as const).flatMap((name) => {
      const text = recorded[name];
      const value = read[name];
      return text === undefined || value === undefined || 'inline' in text ? [] : [[text.kept.sha256, value] as const];
    }),
  );
}

export type TextAsRead =
  | { readonly text: string }
  | { readonly unread: { readonly because: PayloadUnread; readonly bytes: number } };

export function textAsRead(
  name: TextName,
  text: Payload<string>,
): Effect.Effect<TextAsRead, never, PlaybookReader | PlaybookContext> {
  if ('inline' in text) {
    return Effect.succeed({ text: text.inline });
  }
  return textRead(name, text).pipe(
    Effect.map((read): TextAsRead => ({ text: read })),
    Effect.catchTag('definition_text_unread', ({ because }: { readonly because: PayloadUnread }) =>
      Effect.succeed<TextAsRead>({ unread: { because, bytes: text.kept.bytes } }),
    ),
  );
}

import { Buffer } from 'node:buffer';

import { refusingForbiddenCharacters } from '@on.auto/definitions';
import { parsedTemplate, type RenderClock } from '@on.auto/definitions/template';
import { answerDocument, type CallAnswer } from '@on.auto/tool-servers';
import { Result, Schema } from 'effect';

import { interactionEngine } from '../document/request-templates.ts';
import type { DeliveringRecord } from '../run/request-record.ts';
import { renderedText } from '../run/text-rendering.ts';
import { textAt } from '../tool-blocks/json-pointers.ts';
import type { DeliveredAs, Replies, RepliesIn } from '../tool-blocks/tool-block-schemas.ts';

const sentBounds = { partBytes: 256 } as const;

const isPartText = Schema.is(Schema.String.check(refusingForbiddenCharacters));

export function isBoundedPart(part: string): boolean {
  return part !== '' && Buffer.byteLength(part, 'utf8') <= sentBounds.partBytes && isPartText(part);
}

export interface Kept {
  readonly delivered_as?: DeliveredAs;
  readonly replies_in?: RepliesIn;
  readonly detail?: string;
}

const firstConversation = '{{ sent.conversation }}';

function partAt(document: Schema.Json, pointer: string, name: string): Result.Result<string, string> {
  const part = textAt(document, pointer);
  if (part === undefined) {
    return Result.fail(`The answer of the tool has no text or whole number at ${pointer}, its ${name}`);
  }
  return isBoundedPart(part)
    ? Result.succeed(part)
    : Result.fail(
        `The ${name} at ${pointer} takes more than ${sentBounds.partBytes} bytes or holds a character a part may not hold`,
      );
}

const unkeyed = `The conversation's key renders to nothing, to more than ${sentBounds.partBytes} bytes or to a character a key may not hold`;

function renderedKey(replies: Replies, party: string, sent: DeliveredAs, clock: RenderClock): string | undefined {
  const parsed = parsedTemplate(interactionEngine, replies.conversation ?? firstConversation, 1);
  if (Result.isFailure(parsed)) {
    return undefined;
  }
  const rendered = renderedText(parsed.success, { to: party, sent: { ...sent } }, sentBounds.partBytes + 1, clock);
  return Result.isSuccess(rendered) && isBoundedPart(rendered.success) ? rendered.success : undefined;
}

function keyOf(replies: Replies, party: string, sent: DeliveredAs, clock: RenderClock): Result.Result<string, string> {
  const key = renderedKey(replies, party, sent, clock);
  return key === undefined ? Result.fail(unkeyed) : Result.succeed(key);
}

function readingOf(record: DeliveringRecord): Replies | undefined {
  return record.answer_schema === undefined || record.reply === undefined ? undefined : record.replies;
}

function keptAs(record: DeliveringRecord, deliveredAs: DeliveredAs, clock: RenderClock): Result.Result<Kept, string> {
  const reading = readingOf(record);
  if (reading === undefined) {
    return Result.succeed({ delivered_as: deliveredAs });
  }
  return Result.map(keyOf(reading, record.to, deliveredAs, clock), (key) => ({
    delivered_as: deliveredAs,
    replies_in: { server: record.deliver.server, tool: reading.tool, key },
  }));
}

export function keptOf(record: DeliveringRecord, answer: CallAnswer, clock: RenderClock): Kept {
  const { sent } = record.deliver;
  if (sent === undefined) {
    return {};
  }
  const document = answerDocument(answer);
  const kept =
    document === undefined
      ? Result.fail('The answer of the tool holds neither structured content nor text')
      : Result.flatMap(
          Result.all({
            conversation: partAt(document, sent.conversation, 'conversation'),
            id: partAt(document, sent.id, 'message'),
          }),
          (deliveredAs) => keptAs(record, deliveredAs, clock),
        );
  return Result.getOrElse(kept, (what) => ({
    detail:
      readingOf(record) === undefined
        ? what
        : `${what}, so the request takes no reply and waits for answer_interaction`,
  }));
}

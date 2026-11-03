import type { RunAccount } from '@on.auto/definitions';
import { Option, Schema } from 'effect';

import { kindInWords, sizeInWords } from '../assets/asset-words.ts';
import { generationWaitOf } from '../waiting/generation-wait.ts';

const MadeSchema = Schema.Struct({ media_type: Schema.String, bytes: Schema.Int });

const decodeMade = Schema.decodeUnknownOption(MadeSchema);

const madeInWords: ReadonlyMap<string, string> = new Map([
  ['image', 'an image'],
  ['audio', 'audio'],
  ['video', 'a video'],
]);

export function whatOf(mediaType: string): string {
  return madeInWords.get(mediaType.slice(0, mediaType.indexOf('/'))) ?? 'an asset';
}

export function describeOutput(output: Schema.Json): string {
  return Option.match(decodeMade(output), {
    onNone: () => 'It made an asset, which the details below describe.',
    onSome: ({ media_type: mediaType, bytes }) =>
      `It made ${whatOf(mediaType)} of ${sizeInWords(bytes)}, kept as an asset of the playbook.`,
  });
}

export function waitingAccount(record: Schema.JsonObject): RunAccount | undefined {
  const wait = generationWaitOf(record);
  return wait === undefined
    ? undefined
    : {
        summary: `The run waits while the provider makes ${kindInWords[wait.kind]}, until ${wait.waits_until} at most.`,
        data: { model: wait.model, kind: wait.kind, waits_until: wait.waits_until },
      };
}

import { Option, Schema } from 'effect';

import { sizeInWords } from '../assets/asset-words.ts';

const MadeSchema = Schema.Struct({ media_type: Schema.String, bytes: Schema.Int });

const decodeMade = Schema.decodeUnknownOption(MadeSchema);

const madeInWords: ReadonlyMap<string, string> = new Map([
  ['image', 'an image'],
  ['audio', 'audio'],
  ['video', 'a video'],
]);

function whatOf(mediaType: string): string {
  return madeInWords.get(mediaType.slice(0, mediaType.indexOf('/'))) ?? 'an asset';
}

export function describeOutput(output: Schema.Json): string {
  return Option.match(decodeMade(output), {
    onNone: () => 'It made an asset, which the details below describe.',
    onSome: ({ media_type: mediaType, bytes }) =>
      `It made ${whatOf(mediaType)} of ${sizeInWords(bytes)}, kept as an asset of the playbook.`,
  });
}

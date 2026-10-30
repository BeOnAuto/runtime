import { inWords } from '@on.auto/definitions';
import { asSentence, counted } from '@on.auto/operations';
import { toolInWords } from '@on.auto/tool-servers';
import { Option, Schema } from 'effect';

const CallRecordSchema = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  read: Schema.optionalKey(Schema.String),
});

type CallRecord = typeof CallRecordSchema.Type;

const decodeCallRecord = Schema.decodeUnknownOption(CallRecordSchema);

const isList = Schema.is(Schema.Array(Schema.Json));

const item = { one: 'item', other: 'items' };

const inTheDetails = 'is too long to repeat here; the whole of it is in the details below.';

function askedInWords(call: CallRecord, output: Schema.Json): string {
  const asked = `It asked ${toolInWords(call)}`;
  const words = inWords(output);
  if (words !== undefined) {
    return asSentence(`${asked}; its answer: ${words}`);
  }
  return isList(output)
    ? `${asked}, whose answer of ${counted(output.length, item)} ${inTheDetails}`
    : `${asked}, whose answer ${inTheDetails}`;
}

export function callOutputInWords(output: Schema.Json, record: unknown): string | undefined {
  return Option.getOrUndefined(Option.map(decodeCallRecord(record), (call) => askedInWords(call, output)));
}

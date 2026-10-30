import { Schema } from 'effect';

import { mostInputDepth, nestsWithin } from '../runs/recorded-size.ts';
import { isTime } from './event-time.ts';

export const mostPublishedEventBytes = 245_760;

export const mostEventDataDepth = mostInputDepth - 2;

const mostIdLength = 256;

const mostTypeLength = 256;

const mostTextLength = 1024;

const leastExtensionInteger = -2_147_483_648;

const mostExtensionInteger = 2_147_483_647;

const mostExtensionNameLength = 20;

const mostExtensions = 32;

const contextAttributes: ReadonlySet<string> = new Set([
  'specversion',
  'id',
  'source',
  'type',
  'subject',
  'time',
  'datacontenttype',
  'dataschema',
  'data',
]);

const uriCharacters = String.raw`(?:[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=]|%[0-9A-Fa-f]{2})`;

const uriReference = new RegExp(String.raw`^${uriCharacters}+$`, 'u');

const absoluteUri = new RegExp(String.raw`^[A-Za-z][A-Za-z0-9+.\-]*:${uriCharacters}*$`, 'u');

const mediaTypeToken = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";

const quotedParameter = String.raw`"(?:[\t !#-\[\]-~]|\\[\t -~])*"`;

const mediaType = new RegExp(
  String.raw`^${mediaTypeToken}/${mediaTypeToken}(?:[ \t]*;[ \t]*${mediaTypeToken}=(?:${mediaTypeToken}|${quotedParameter}))*$`,
  'u',
);

const extensionName = new RegExp(`^[a-z0-9]{1,${mostExtensionNameLength}}$`, 'u');

const forbiddenCharacter = /[\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}]/u;

const notASpace = /\S/u;

const forbiddenInWords = 'control characters, unpaired surrogates or noncharacters';

function isAllowedText(text: string): boolean {
  return !forbiddenCharacter.test(text);
}

function isWorded(text: string): boolean {
  return text === '' || notASpace.test(text);
}

function isExtensionInteger(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= leastExtensionInteger &&
    value <= mostExtensionInteger
  );
}

function isExtensionValue(value: unknown): boolean {
  return (typeof value === 'string' && isAllowedText(value)) || typeof value === 'boolean' || isExtensionInteger(value);
}

function extensionIssue([name, value]: readonly [string, unknown]) {
  if (!extensionName.test(name)) {
    return [
      {
        path: [name],
        issue: `Expected the name of an extension attribute: 1 to ${mostExtensionNameLength} lowercase letters and digits`,
      },
    ];
  }
  return isExtensionValue(value)
    ? []
    : [
        {
          path: [name],
          issue: `Expected text without ${forbiddenInWords}, a boolean, or an integer from -2147483648 to 2147483647`,
        },
      ];
}

function extensionIssues(event: { readonly [attribute: string]: unknown }) {
  const extensions = Object.entries(event).filter(([name]: readonly [string, unknown]) => !contextAttributes.has(name));
  const tooMany =
    extensions.length > mostExtensions
      ? [{ path: [], issue: `Expected at most ${mostExtensions} extension attributes, not ${extensions.length}` }]
      : [];
  return [...tooMany, ...extensions.flatMap((extension: readonly [string, unknown]) => extensionIssue(extension))];
}

export const refusingForbiddenCharacters = Schema.makeFilter(isAllowedText, {
  expected: `text without ${forbiddenInWords}`,
});

export const refusingBlankText = Schema.makeFilter(isWorded, {
  expected: 'text with a character that is not a space',
});

function boundedText(most: number, description: string) {
  return Schema.String.annotate({ description: `${description}, 1 to ${most} characters` }).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(most),
    refusingForbiddenCharacters,
  );
}

function wordedText(most: number, description: string) {
  return boundedText(most, description).check(refusingBlankText);
}

function timeFieldOf(description: string) {
  return Schema.String.annotate({ description }).check(
    Schema.makeFilter(isTime, {
      expected:
        'a time in RFC 3339 on a day that exists, such as 2026-10-05T09:00:00Z, its second 60 only at the end of a day',
    }),
  );
}

const TimeField = timeFieldOf('When it happened, in RFC 3339, such as 2026-10-05T09:00:00Z');

const unique = 'The id of the event, unique among the events of its source';

export const EventSourceSchema = Schema.String.annotate({
  description: `Where the event comes from, a URI reference such as /ledger/eu, 1 to ${mostTextLength} characters`,
}).check(
  Schema.isMaxLength(mostTextLength),
  Schema.makeFilter((source: string) => uriReference.test(source), {
    expected: 'a URI reference that is not empty, such as /ledger/eu or https://acme.example/ledger',
  }),
);

const contextFields = {
  source: EventSourceSchema,
  type: wordedText(mostTypeLength, 'What happened, such as com.acme.ledger.month-closed'),
  subject: Schema.optionalKey(wordedText(mostTextLength, 'What the event is about, within its source')),
  datacontenttype: Schema.optionalKey(
    boundedText(mostTypeLength, 'The media type of data, such as application/json').check(
      Schema.makeFilter((type: string) => mediaType.test(type), {
        expected: 'a media type, such as application/json or text/plain; charset=utf-8',
      }),
    ),
  ),
  dataschema: Schema.optionalKey(
    boundedText(mostTextLength, 'The schema data follows, an absolute URI').check(
      Schema.makeFilter((schema: string) => absoluteUri.test(schema), { expected: 'an absolute URI' }),
    ),
  ),
  data: Schema.optionalKey(
    Schema.Json.annotate({
      description: `What the event carries, any JSON value that nests at most ${mostEventDataDepth} levels deep`,
    }).check(
      Schema.makeFilter((data: Schema.Json) => nestsWithin(data, mostEventDataDepth), {
        expected: `data that nests at most ${mostEventDataDepth} levels deep, so that a run can hold the event in a list`,
      }),
    ),
  ),
};

const extensionsCheck = Schema.makeFilter(extensionIssues);

const ExtensionsSchema = Schema.Record(Schema.String, Schema.Json);

const extensionsInWords = `Any other attribute is an extension, at most ${mostExtensions} of them: its name 1 to ${mostExtensionNameLength} lowercase letters and digits, its value text, a boolean, or an integer from -2147483648 to 2147483647, kept as given. No text may hold ${forbiddenInWords}.`;

export const EventToPublishSchema = Schema.StructWithRest(
  Schema.Struct({
    specversion: Schema.optionalKey(
      Schema.Literal('1.0').annotate({
        description: 'The version of CloudEvents the event follows; 1.0 when left out',
      }),
    ),
    id: Schema.optionalKey(wordedText(mostIdLength, `${unique}; made when left out`)),
    ...contextFields,
    time: Schema.optionalKey(
      timeFieldOf(
        'When it happened, in RFC 3339, such as 2026-10-05T09:00:00Z; when the playbook records it, if left out',
      ),
    ),
  }),
  [ExtensionsSchema],
)
  .annotate({
    description: `A CloudEvents 1.0 event of at most ${mostPublishedEventBytes} bytes as JSON; any other attribute is an extension, its name 1 to ${mostExtensionNameLength} lowercase letters and digits, its value text, a boolean or an integer`,
  })
  .check(extensionsCheck);

export type EventToPublish = typeof EventToPublishSchema.Type;

export const CloudEventSchema = Schema.StructWithRest(
  Schema.Struct({
    specversion: Schema.Literal('1.0'),
    id: wordedText(mostIdLength, unique),
    ...contextFields,
    time: TimeField,
  }),
  [ExtensionsSchema],
)
  .check(extensionsCheck)
  .annotate({
    identifier: 'CloudEvent',
    description: `An event in the shape of CloudEvents 1.0. ${extensionsInWords}`,
  });

export type CloudEvent = typeof CloudEventSchema.Type;

import { InvalidInput } from '@on.auto/operations';
import { Schema, SchemaTransformation } from 'effect';

import { ResolvedHowSchema, isFraction } from '../facts/comment-facts.ts';
import { mostAddressCharacters } from '../positions/comment-addresses.ts';

const mostTextCharacters = 4000;

const mostCommentsInAPage = 200;

export const commentsInAPage = 50;

const longestCursor = 512;

const forbiddenInText = /[\p{Cs}\p{Noncharacter_Code_Point}]|[^\P{Cc}\t\n\r]/u;

const notASpace = /\S/u;

export const AddressInputField = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(mostAddressCharacters),
).annotate({
  description: `The address of what the comment is about, a thing of the playbook, or of the organization for its own comments, at most ${mostAddressCharacters} characters`,
});

const FractionField = (description: string) => Schema.Finite.annotate({ description });

export const AnchorInputField = Schema.Struct({
  x: FractionField("From the thing's left edge to its right, 0 to 1 with at most 4 decimals"),
  y: FractionField("From the thing's top to its bottom, 0 to 1 with at most 4 decimals"),
})
  .check(
    Schema.makeFilter(({ x, y }: { readonly x: number; readonly y: number }) => isFraction(x) && isFraction(y), {
      expected: 'x and y, each a number from 0 to 1 with at most 4 decimals',
    }),
  )
  .annotate({
    description:
      "Where on the thing the person dropped the comment, as fractions of the thing's box; left out, or null, for a comment made without a pin, as a reply is",
  });

export const TextInputField = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(mostTextCharacters),
  Schema.makeFilter((text: string) => text === '' || notASpace.test(text), {
    expected: 'text with a character that is not a space',
  }),
  Schema.makeFilter((text: string) => !forbiddenInText.test(text), {
    expected: 'text without control characters other than tabs and line breaks, unpaired surrogates or noncharacters',
  }),
).annotate({
  description: `What the person says, in Markdown, 1 to ${mostTextCharacters} characters, kept without the white space around it`,
});

export const HowInputField = ResolvedHowSchema.annotate({
  description: 'acted once what the comment asked is done, or dismissed to close it without acting',
});

export const CommentIdField = Schema.String.annotate({
  description: 'The id of the comment, as list_comments gives it',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

export const LimitField = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: mostCommentsInAPage })).annotate({
  description: `How many comments a page holds, 1 to ${mostCommentsInAPage}; ${commentsInAPage} when left out`,
});

export const CursorField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(longestCursor)).annotate({
  description: 'The next_cursor of the page before, to read on only as the person needs',
});

export function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

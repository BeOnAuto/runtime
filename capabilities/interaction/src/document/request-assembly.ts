import type { SourceLines, ValueContract } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import type { Result } from 'effect';

import type { ReplyRule } from '../replies/reply-rule.ts';
import type { InteractionFrontMatter } from './front-matter.ts';
import type { RequestBody, RequestDocument } from './interaction-document.ts';
import { wayOf, type WrittenWay } from './route-parts.ts';
import type { Checked } from './written-parts.ts';

export type CheckedParts = {
  readonly route: Checked<WrittenWay>;
  readonly expires: Checked<number>;
  readonly input: Checked<ValueContract>;
  readonly output: Checked<ValueContract>;
  readonly to: Checked<ParsedTemplate>;
  readonly from: Checked<ParsedTemplate | null>;
  readonly body: Checked<RequestBody>;
  readonly reply: Checked<ReplyRule | null>;
};

type DoneParts = { readonly [Part in keyof CheckedParts]: Result.Result.Success<CheckedParts[Part]> };

export function assembledRequest(
  written: InteractionFrontMatter,
  { expires, lines }: { readonly expires: string; readonly lines: SourceLines },
  done: DoneParts,
): RequestDocument {
  const { route, input, output, to, from, body, reply } = done;
  return {
    shape: 'request',
    ...(written.description === undefined ? {} : { description: written.description }),
    ...wayOf(route, lines),
    to,
    ...(from === null ? {} : { from }),
    expires,
    expiresMs: done.expires,
    input,
    output,
    ...body,
    ...(reply === null ? {} : { reply }),
  };
}

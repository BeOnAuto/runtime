import { issueAt, type DocumentParts, type SourceLines, type ValueContract } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import { Result } from 'effect';

import type { ReplyRule } from '../replies/reply-rule.ts';
import type { DocumentReading } from '../tool-blocks/compiled-tool-block.ts';
import type { InteractionFrontMatter } from './front-matter.ts';
import type { RequestDocument } from './interaction-document.ts';
import { fromOf, replyOf } from './reply-parts.ts';
import { routeIn, wayOf, type WrittenWay } from './route-parts.ts';
import { contractOf, expiresOf, issuesOf, messageOf, toOf, type Checked } from './written-parts.ts';

interface Asked {
  readonly to: string;
  readonly expires: string;
}

type CheckedParts = {
  readonly route: Checked<WrittenWay>;
  readonly expires: Checked<number>;
  readonly input: Checked<ValueContract>;
  readonly output: Checked<ValueContract>;
  readonly to: Checked<ParsedTemplate>;
  readonly from: Checked<ParsedTemplate | null>;
  readonly message: Checked<ParsedTemplate>;
  readonly reply: Checked<ReplyRule | null>;
};

function partsOf(
  written: InteractionFrontMatter,
  asked: Asked,
  reading: DocumentReading,
  parts: DocumentParts,
): CheckedParts {
  const { lines } = reading;
  const input = contractOf(written.input, 'input', lines);
  const output = contractOf(written.output, 'output', lines);
  const inputSchema = Result.isSuccess(input) ? input.success.schema?.document : undefined;
  return {
    route: routeIn(written, reading, inputSchema),
    expires: expiresOf(asked.expires, lines),
    input,
    output,
    to: toOf(asked.to, lines, inputSchema),
    from: fromOf(written.from, lines, inputSchema),
    message: messageOf(parts, inputSchema),
    reply: Result.isFailure(output)
      ? Result.succeed(null)
      : replyOf(
          {
            reply: written.reply,
            answerSchema: output.success.schema?.document,
            readsReplies: written.replies !== undefined,
          },
          lines,
        ),
  };
}

type DoneParts = { readonly [Part in keyof CheckedParts]: Result.Result.Success<CheckedParts[Part]> };

function documentOfParts(
  written: InteractionFrontMatter,
  { expires, lines }: { readonly expires: string; readonly lines: SourceLines },
  done: DoneParts,
): RequestDocument {
  const { route, input, output, to, from, message, reply } = done;
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
    message,
    ...(reply === null ? {} : { reply }),
  };
}

const unaskedWords = {
  to: 'to is required, the party the request goes to, unless the function asks a system with call',
  expires: 'expires is required, how long the request waits, unless the function asks a system with call',
} as const;

export function requestFrom(
  written: InteractionFrontMatter,
  reading: DocumentReading,
  parts: DocumentParts,
): Checked<RequestDocument> {
  const { lines } = reading;
  const { to, expires } = written;
  if (to === undefined || expires === undefined) {
    const unasked = (['to', 'expires'] as const).filter((key) => written[key] === undefined);
    return Result.fail([
      ...unasked.map((key) => issueAt(lines, `/${key}`, unaskedWords[key])),
      ...issuesOf(() => messageOf(parts)),
    ]);
  }
  const checked = partsOf(written, { to, expires }, reading, parts);
  const found = [
    ...issuesOf(() => checked.route),
    ...issuesOf(() => checked.expires),
    ...issuesOf(() => checked.input),
    ...issuesOf(() => checked.output),
    ...issuesOf(() => checked.to),
    ...issuesOf(() => checked.from),
    ...issuesOf(() => checked.message),
    ...issuesOf(() => checked.reply),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all(checked), (done) => documentOfParts(written, { expires, lines }, done));
}

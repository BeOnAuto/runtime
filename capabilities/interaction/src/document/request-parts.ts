import { issueAt, type DocumentParts } from '@on.auto/definitions/document';
import type { DocumentReading } from '@on.auto/definitions/tool-blocks';
import { Result } from 'effect';

import type { InteractionFrontMatter } from './front-matter.ts';
import type { RequestDocument } from './interaction-document.ts';
import { bodyOf } from './render-parts.ts';
import { fromOf, replyOf } from './reply-parts.ts';
import { assembledRequest, type CheckedParts } from './request-assembly.ts';
import { routeIn } from './route-parts.ts';
import { contractOf, expiresOf, issuesOf, toOf, type Checked } from './written-parts.ts';

interface Asked {
  readonly to: string;
  readonly expires: string;
}

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
    body: bodyOf(written, parts, lines, inputSchema),
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
      ...issuesOf(() => bodyOf(written, parts, lines)),
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
    ...issuesOf(() => checked.body),
    ...issuesOf(() => checked.reply),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all(checked), (done) => assembledRequest(written, { expires, lines }, done));
}

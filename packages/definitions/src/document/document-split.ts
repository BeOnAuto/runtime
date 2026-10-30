import { Result } from 'effect';

import type { DocumentIssue } from './document-issue.ts';

export interface DocumentParts {
  readonly frontMatter: string;
  readonly frontMatterLine: number;
  readonly body: string;
  readonly bodyLine: number;
}

const delimiter = /^---[ \t]*$/u;

const byteOrderMark = '﻿';

function issue(detail: string): readonly DocumentIssue[] {
  return [{ line: 1, pointer: '', detail }];
}

export function splitDocument(
  source: string,
  definition: string,
): Result.Result<DocumentParts, readonly DocumentIssue[]> {
  const lines = (source.startsWith(byteOrderMark) ? source.slice(1) : source).split(/\r?\n/u);
  if (!delimiter.test(String(lines[0]))) {
    return Result.fail(
      issue(`${definition} starts with a line of three dashes (---) that opens its front matter of YAML`),
    );
  }
  const closing = lines.findIndex((line, index) => index > 0 && delimiter.test(line));
  if (closing === -1) {
    return Result.fail(issue('The front matter that opens on line 1 is never closed by a line of three dashes (---)'));
  }
  return Result.succeed({
    frontMatter: lines.slice(1, closing).join('\n'),
    frontMatterLine: 2,
    body: lines.slice(closing + 1).join('\n'),
    bodyLine: closing + 2,
  });
}

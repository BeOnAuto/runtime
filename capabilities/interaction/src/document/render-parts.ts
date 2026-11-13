import { issueAt, type DocumentIssue, type DocumentParts, type SourceLines } from '@on.auto/definitions/document';
import { Predicate, Result, type Schema } from 'effect';

import { cardBodyIssues } from '../card-bodies/card-body-issues.ts';
import { readCardBody } from '../card-bodies/card-body-reading.ts';
import { isRenderTargetName, renderTargetNames } from '../rendering/render-targets.ts';
import { forAnAgent } from '../tool-blocks/tool-block-schemas.ts';
import type { InteractionFrontMatter } from './front-matter.ts';
import type { RequestBody } from './interaction-document.ts';
import { messageOf, type Checked } from './written-parts.ts';

const writesRender = /^render:/mu;

export function rendersABody(root: unknown): boolean {
  return Predicate.hasProperty(root, 'render');
}

export function seemsToRender({ frontMatter }: Pick<DocumentParts, 'frontMatter'>): boolean {
  return writesRender.test(frontMatter);
}

const allowed = renderTargetNames.join(', ');

function targetIssues(render: string, lines: SourceLines): readonly DocumentIssue[] {
  return isRenderTargetName(render)
    ? []
    : [issueAt(lines, '/render', `render is ${render}, which Auto does not render to; write one of: ${allowed}`)];
}

const needsATool =
  "A request with render is sent through the tool of a connection, so write deliver with the server and tool that send it, and read the message with, for example, blocks: '{{ rendered }}'";

const agentsReadText =
  "A request with render goes through the tool of a connection, which sends what it renders; deliver: agent holds text for an agent, so write deliver with the server and tool that send it, and read the message with, for example, blocks: '{{ rendered }}'";

function wayIssues({ deliver }: InteractionFrontMatter, lines: SourceLines): readonly DocumentIssue[] {
  if (deliver === undefined) {
    return [issueAt(lines, '/render', needsATool)];
  }
  return deliver === forAnAgent ? [issueAt(lines, '/deliver', agentsReadText)] : [];
}

function renderedBodyOf(
  render: string,
  parts: DocumentParts,
  inputSchema: Schema.JsonObject | undefined,
): Checked<RequestBody> {
  if (!isRenderTargetName(render)) {
    return Result.fail([]);
  }
  return Result.flatMap(readCardBody(parts), ({ card, lines: bodyLines }) => {
    const issues = cardBodyIssues(render, card, bodyLines, inputSchema);
    return issues.length > 0 ? Result.fail(issues) : Result.succeed({ render: { target: render, card } });
  });
}

export function bodyOf(
  written: InteractionFrontMatter,
  parts: DocumentParts,
  lines: SourceLines,
  inputSchema?: Schema.JsonObject,
): Checked<RequestBody> {
  const { render } = written;
  if (render === undefined) {
    return Result.map(messageOf(parts, inputSchema), (message) => ({ message }));
  }
  const refused = [...targetIssues(render, lines), ...wayIssues(written, lines)];
  const body = renderedBodyOf(render, parts, inputSchema);
  const found = [...refused, ...(Result.isFailure(body) ? body.failure : [])];
  return found.length > 0 ? Result.fail(found) : body;
}

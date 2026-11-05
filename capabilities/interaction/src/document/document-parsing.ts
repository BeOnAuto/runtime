import {
  frontMatterIn,
  reportedIssues,
  splitDocument,
  type DocumentIssue,
  type DocumentParts,
  type ReadFrontMatter,
} from '@on.auto/definitions/document';
import type { RenderClock } from '@on.auto/definitions/template';
import { Result } from 'effect';

import { asksASystem, callFrom, seemsToAskASystem } from './call-parts.ts';
import { decodeFrontMatter, interactionFrontMatter } from './front-matter.ts';
import type { InteractionFunctionDefinitionDocument } from './interaction-document.ts';
import { requestFrom } from './request-parts.ts';
import { asksToSignIn, seemsToAskToSignIn, signInFrom } from './sign-in-parts.ts';
import { messageOf, type Checked } from './written-parts.ts';

function bodyIssuesOf(parts: DocumentParts, writesNoRequest: boolean): readonly DocumentIssue[] {
  if (writesNoRequest) {
    return [];
  }
  const message = messageOf(parts);
  return Result.isFailure(message) ? message.failure : [];
}

function documentFrom(
  reading: ReadFrontMatter,
  parts: DocumentParts,
  clock: RenderClock,
): Checked<InteractionFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(reading.root);
  if (reading.issues.length > 0 || Result.isFailure(decoded)) {
    const { root } = reading;
    return Result.fail([...reading.issues, ...bodyIssuesOf(parts, asksASystem(root) || asksToSignIn(root))]);
  }
  const written = decoded.success;
  const read = { lines: reading.lines, clock };
  if (written.sign_in !== undefined) {
    return signInFrom(written, written.sign_in, read, parts);
  }
  return written.call === undefined ? requestFrom(written, read, parts) : callFrom(written, written.call, read, parts);
}

function documentOf(parts: DocumentParts, clock: RenderClock): Checked<InteractionFunctionDefinitionDocument> {
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, interactionFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...bodyIssuesOf(parts, seemsToAskASystem(parts) || seemsToAskToSignIn(parts))])
    : documentFrom(reading.success, parts, clock);
}

export function parseInteractionDocument(
  source: string,
  clock: RenderClock,
): Checked<InteractionFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'An interaction function definition'), (parts) => documentOf(parts, clock)),
    reportedIssues,
  );
}

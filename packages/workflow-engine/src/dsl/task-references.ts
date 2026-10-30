import {
  bytesOfReference,
  forbiddenCharactersInWords,
  holdsNoForbiddenCharacter,
  mostReferenceBytes,
} from '@on.auto/operations';

import { withinBytes } from './json.ts';
import { rejection, type Rejection } from './policy-checks.ts';
import { kindOf, type TaskEntry } from './tasks.ts';

const mostShownReferenceBytes = 120;

function cutReference(reference: string): string {
  return `${withinBytes(reference, mostShownReferenceBytes)}…`;
}

function pointerOfTheNameHolding(reference: string): string {
  const segments = reference.split('/');
  const holding = segments.findIndex((segment) => !holdsNoForbiddenCharacter(segment));
  return segments.slice(0, holding + 1).join('/');
}

export function referenceRejections({ task, reference }: TaskEntry): readonly Rejection[] {
  if (kindOf(task) !== 'call') {
    return [];
  }
  if (!holdsNoForbiddenCharacter(reference)) {
    return [
      rejection(
        reference,
        `The name of the task at ${pointerOfTheNameHolding(reference)} holds ${forbiddenCharactersInWords}, which a reference never holds`,
      ),
    ];
  }
  const bytes = bytesOfReference(reference);
  return bytes > mostReferenceBytes
    ? [
        rejection(
          reference,
          `The reference of this task, ${cutReference(reference)}, takes ${bytes} bytes, more than the ${mostReferenceBytes} a reference may take, since a run the task starts carries it; shorten its name or the names above it`,
        ),
      ]
    : [];
}

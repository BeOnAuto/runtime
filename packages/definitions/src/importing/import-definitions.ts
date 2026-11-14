import type { InvalidInput, Issue, Unavailable } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { contributionsChecked } from '../contributions/contribution-gate.ts';
import { goalsDocumentOf } from '../goals/goals-check.ts';
import { DefinitionNameField, DiagramField, OverviewField, SourceField } from '../operations/definition-fields.ts';
import { checkedContentOf } from '../operations/definition-views.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import type { PortableDefinition } from '../portable/portable-package.ts';

type Goals = Parameters<typeof contributionsChecked>[1];

const WrittenSchema = Schema.Struct({
  name: DefinitionNameField,
  source: SourceField,
  overview: Schema.optionalKey(OverviewField),
  diagram: Schema.optionalKey(DiagramField),
});

const decodeWritten = Schema.decodeUnknownResult(WrittenSchema);

export function under(pointer: string, issues: readonly Issue[]): readonly Issue[] {
  return issues.map((issue) => ({ pointer: `${pointer}${issue.pointer}`, detail: issue.detail }));
}

interface Refused {
  readonly detail: string;
  readonly issues?: readonly Issue[];
}

function refusedIssues(pointer: string, { detail, issues = [] }: Refused, whole: string): readonly Issue[] {
  return issues.length > 0 ? under(pointer, issues) : [{ pointer: whole, detail }];
}

export function issuesOfEffect<A, R>(
  pointer: string,
  checked: Effect.Effect<A, InvalidInput | Unavailable, R>,
  whole = pointer,
): Effect.Effect<readonly Issue[], never, R> {
  return Effect.match(checked, {
    onFailure: (refused: Refused) => refusedIssues(pointer, refused, whole),
    onSuccess: () => [],
  });
}

export function goalsOfThePackage(source: string | undefined): Goals | undefined {
  if (source === undefined) {
    return undefined;
  }
  const document = goalsDocumentOf(source);
  return Result.isSuccess(document) ? document.success.goals : undefined;
}

interface DefinitionChecking {
  readonly capabilities: readonly Capability[];
  readonly pages: Pick<SubjectPages, 'check'>;
}

export function definitionIssues({ capabilities, pages }: DefinitionChecking, packagePointer: string, goals?: Goals) {
  const known = knownCapabilities(capabilities);
  const gated = (type: string, content: Parameters<typeof contributionsChecked>[2]) =>
    goals === undefined ? Effect.succeed(content) : contributionsChecked(type, goals, content);
  return (definition: PortableDefinition, index: number) => {
    const pointer = `${packagePointer}/definitions/${String(index)}`;
    const decoded = decodeWritten(definition);
    if (Result.isFailure(decoded)) {
      return Effect.succeed<readonly Issue[]>([{ pointer, detail: decoded.failure.message }]);
    }
    return Effect.matchEffect(known.capabilityOfType(definition.type), {
      onFailure: () =>
        Effect.succeed<readonly Issue[]>([
          { pointer: `${pointer}/type`, detail: `This runtime serves no ${definition.type} definitions` },
        ]),
      onSuccess: (capability) =>
        issuesOfEffect(
          pointer,
          Effect.flatMap(checkedContentOf(capability, decoded.success, pages), (content) =>
            gated(capability.type, content),
          ),
        ),
    });
  };
}

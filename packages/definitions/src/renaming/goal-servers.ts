import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { contributesIn } from '../contributions/contributes-details.ts';
import { refusedToAnswerFor } from '../operations/unread-texts.ts';
import { textsRead } from '../payloads/kept-texts.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { DefinitionRegistry, RegisteredDefinition } from '../registry/definition-registry.ts';
import { startedTypesOf } from './rename-checks.ts';
import { renamedIn, type TextRenamed } from './renamed-yaml.ts';
import { resavedContent, type Resaving } from './resaved-contents.ts';

export interface GoalRenaming {
  readonly from: string;
  readonly to: string;
}

export interface GoalRenamer extends Resaving {
  readonly workflow: Capability;
  readonly started: readonly string[];
}

interface ServerResaved {
  readonly stored: RegisteredDefinition;
  readonly content: DefinitionContent;
}

const workflowType = 'workflow';

export function goalRenamerOf(capabilities: readonly Capability[], resaving: Resaving): GoalRenamer {
  const workflow = capabilities.find(({ type }) => type === workflowType);
  if (workflow === undefined) {
    throw new Error(
      'A goal is renamed only where workflows are kept, since the workflows that serve it are saved again',
    );
  }
  return { workflow, started: startedTypesOf(capabilities), ...resaving };
}

function contributionsRenamed({ details }: RegisteredDefinition, { from, to }: GoalRenaming): readonly TextRenamed[] {
  return (contributesIn(details) ?? []).flatMap(({ goal }, index) =>
    goal === from ? [{ pointer: `/contributes/${String(index)}/goal`, from, to }] : [],
  );
}

export function servingWorkflowsOf(
  workflows: DefinitionRegistry,
  renaming: GoalRenaming,
): readonly RegisteredDefinition[] {
  return [...workflows.values()]
    .filter((stored) => stored.status !== 'retired' && contributionsRenamed(stored, renaming).length > 0)
    .toSorted((one, other) => one.name.localeCompare(other.name));
}

export function resavedServerOf({ workflow, pages }: GoalRenamer, renaming: GoalRenaming) {
  return Effect.fnUntraced(function* (stored: RegisteredDefinition) {
    const texts = yield* textsRead(stored).pipe(Effect.mapError(refusedToAnswerFor(workflow.type, stored)));
    const source = renamedIn(texts.source, workflowType, contributionsRenamed(stored, renaming));
    const { content } = yield* resavedContent(workflow, { ...texts, name: stored.name, source }, { pages });
    const resaved: ServerResaved = { stored, content };
    return resaved;
  });
}

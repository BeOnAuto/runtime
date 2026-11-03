import { Conflict, type Context, type Rejection } from '@on.auto/operations';
import { plainNumber } from '@on.auto/phrasing';
import { Result } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type {
  CommandMetadata,
  DefinitionCommand,
  DefinitionCreation,
  DefinitionPause,
  DefinitionResumption,
  DefinitionRetirement,
  DefinitionUpdate,
} from './definition-commands.ts';
import type { DefinitionContent, DefinitionEvent } from './definition-events.ts';
import type { DefinitionRegistry } from './definition-registry.ts';
import { hasTriggers } from './definition-triggers.ts';
import { isRetired, type StoredDefinition } from './definition.ts';
import { definitionNotFound } from './registry-lookup.ts';

type Decision = Result.Result<readonly DefinitionEvent[], Rejection<'not_found' | 'conflict'>>;

const nothingToRecord: Decision = Result.succeed([]);

export const mostReactingDefinitions = 1024;

function reactingOtherThan(registry: DefinitionRegistry, name: string): number {
  return [...registry.values()].filter(
    (definition) => !isRetired(definition) && hasTriggers(definition) && definition.name !== name,
  ).length;
}

function beyondTheReactingBound(
  type: string,
  registry: DefinitionRegistry,
  { name, content }: Pick<DefinitionCreation, 'name' | 'content'>,
): Conflict | undefined {
  return hasTriggers(content) && reactingOtherThan(registry, name) >= mostReactingDefinitions
    ? new Conflict({
        detail: `The playbook already has ${mostReactingDefinitions} ${definitionResourceLabel(type)}s that start on their own, the most a playbook holds; retire one, or save this one without its schedule`,
      })
    : undefined;
}

function recording(event: DefinitionEvent): Decision {
  return Result.succeed([event]);
}

function takenBy(type: string, existing: StoredDefinition): Conflict {
  const { name } = existing;
  return new Conflict({
    detail: isRetired(existing)
      ? `The ${definitionResourceLabel(type)} ${name} was retired, and a definition name is never reused`
      : `The playbook already has the ${definitionResourceLabel(type)} ${name}`,
    kind: 'taken',
  });
}

export interface RegistryRules {
  readonly type: string;
  readonly mostActive: number;
}

function keptIn(registry: DefinitionRegistry): number {
  return [...registry.values()].filter((definition) => !isRetired(definition)).length;
}

function tooMany({ type, mostActive }: RegistryRules, kept: number, saving: string): Conflict {
  const label = definitionResourceLabel(type);
  return new Conflict({
    detail: `The playbook keeps ${plainNumber(kept)} ${label}s, and a playbook may keep at most ${plainNumber(mostActive)}; retire one before ${saving}`,
  });
}

function decideCreation(
  rules: RegistryRules,
  { name, content, created_by }: DefinitionCreation & CommandMetadata,
  registry: DefinitionRegistry,
): Decision {
  const existing = registry.get(name);
  if (existing !== undefined) {
    return Result.fail(takenBy(rules.type, existing));
  }
  const kept = keptIn(registry);
  if (kept >= rules.mostActive) {
    return Result.fail(tooMany(rules, kept, 'creating another'));
  }
  const beyond = beyondTheReactingBound(rules.type, registry, { name, content });
  return beyond === undefined
    ? recording({ type: 'definition_created', data: { content, created_by } })
    : Result.fail(beyond);
}

function withTheSavedOverview(content: DefinitionContent, { overview }: StoredDefinition): DefinitionContent {
  return content.overview === undefined && overview !== undefined ? { ...content, overview } : content;
}

function isAsSaved({ source, overview, diagram }: DefinitionContent, saved: StoredDefinition): boolean {
  return source === saved.source && overview === saved.overview && diagram === saved.diagram;
}

function decideUpdate(
  rules: RegistryRules,
  { name, content: given }: DefinitionUpdate & CommandMetadata,
  registry: DefinitionRegistry,
): Decision {
  const { type } = rules;
  const existing = registry.get(name);
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  if (isRetired(existing)) {
    return Result.fail(
      new Conflict({
        detail: `The ${definitionResourceLabel(type)} ${name} is retired and can no longer change`,
        kind: 'retired',
      }),
    );
  }
  const content = withTheSavedOverview(given, existing);
  if (isAsSaved(content, existing)) {
    return nothingToRecord;
  }
  const kept = keptIn(registry);
  if (kept > rules.mostActive) {
    return Result.fail(tooMany(rules, kept, 'saving another version'));
  }
  const beyond = beyondTheReactingBound(type, registry, { name, content });
  return beyond === undefined ? recording({ type: 'definition_updated', data: { content } }) : Result.fail(beyond);
}

function decideRetirement(
  type: string,
  { name }: DefinitionRetirement & CommandMetadata,
  registry: DefinitionRegistry,
): Decision {
  const existing = registry.get(name);
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  return isRetired(existing) ? nothingToRecord : recording({ type: 'definition_retired', data: {} });
}

function standingToChange(
  type: string,
  name: string,
  registry: DefinitionRegistry,
): Result.Result<StoredDefinition, Rejection<'not_found' | 'conflict'>> {
  const existing = registry.get(name);
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  return isRetired(existing)
    ? Result.fail(
        new Conflict({
          detail: `The ${definitionResourceLabel(type)} ${name} is retired and can no longer be paused or resumed`,
          kind: 'retired',
        }),
      )
    : Result.succeed(existing);
}

function decidePause(
  type: string,
  { name, paused_by, reason }: DefinitionPause,
  registry: DefinitionRegistry,
): Decision {
  return Result.flatMap(standingToChange(type, name, registry), ({ status }) =>
    status === 'paused'
      ? nothingToRecord
      : recording({ type: 'definition_paused', data: { paused_by, ...(reason === undefined ? {} : { reason }) } }),
  );
}

function decideResumption(type: string, { name }: DefinitionResumption, registry: DefinitionRegistry): Decision {
  return Result.flatMap(standingToChange(type, name, registry), ({ status }) =>
    status === 'paused' ? recording({ type: 'definition_resumed', data: {} }) : nothingToRecord,
  );
}

function versionSaved(command: DefinitionCommand, registry: DefinitionRegistry): Pick<Context, 'definitionVersion'> {
  const existing = registry.get(command.name);
  if (command.type === 'create') {
    return { definitionVersion: 1 };
  }
  if (existing === undefined) {
    return {};
  }
  return { definitionVersion: command.type === 'update' ? existing.version + 1 : existing.version };
}

export function definitionContextOf(type: string, command: DefinitionCommand, registry: DefinitionRegistry): Context {
  const { by, at, name } = command;
  return { at, by, definitionType: type, definitionName: name, ...versionSaved(command, registry) };
}

export function decideOnDefinitions(
  rules: RegistryRules,
  command: DefinitionCommand,
  registry: DefinitionRegistry,
): Decision {
  if (command.type === 'create') {
    return decideCreation(rules, command, registry);
  }
  if (command.type === 'update') {
    return decideUpdate(rules, command, registry);
  }
  if (command.type === 'pause') {
    return decidePause(rules.type, command, registry);
  }
  return command.type === 'resume'
    ? decideResumption(rules.type, command, registry)
    : decideRetirement(rules.type, command, registry);
}

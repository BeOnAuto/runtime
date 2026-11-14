import type { Capability } from '../capability/capability.ts';
import { definePauseDefinition } from './pause-definition.ts';
import { defineRestoreDefinition } from './restore-definition.ts';
import { defineResumeDefinition } from './resume-definition.ts';
import { defineRetireDefinition } from './retire-definition.ts';

export function standingChangesOf(capabilities: readonly Capability[], goals: boolean) {
  return [
    definePauseDefinition(capabilities, goals),
    defineResumeDefinition(capabilities, goals),
    defineRetireDefinition(capabilities, goals),
    defineRestoreDefinition(capabilities, goals),
  ];
}

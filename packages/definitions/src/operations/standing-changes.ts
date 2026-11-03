import type { Capability } from '../capability/capability.ts';
import { definePauseDefinition } from './pause-definition.ts';
import { defineResumeDefinition } from './resume-definition.ts';
import { defineRetireDefinition } from './retire-definition.ts';

export function standingChangesOf(capabilities: readonly Capability[]) {
  return [
    definePauseDefinition(capabilities),
    defineResumeDefinition(capabilities),
    defineRetireDefinition(capabilities),
  ];
}

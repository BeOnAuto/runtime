import type { Capability } from '../capability/capability.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { defineCreateDefinition } from './create-definition.ts';
import { defineGetDefinition } from './get-definition.ts';
import { defineGetRun } from './get-run.ts';
import { defineListDefinitions } from './list-definitions.ts';
import { pageRenderings } from './render-page.ts';
import { defineRunDefinition } from './run-definition.ts';
import { standingChangesOf } from './standing-changes.ts';
import { defineUpdateDefinition } from './update-definition.ts';

export function operationsOnDefinitions(capabilities: readonly Capability[], pages: SubjectPages) {
  return [
    defineCreateDefinition(capabilities, pages),
    defineListDefinitions(capabilities),
    defineGetDefinition(capabilities, pages),
    ...pageRenderings(capabilities, pages),
    defineUpdateDefinition(capabilities, pages),
    ...standingChangesOf(capabilities),
    defineRunDefinition(capabilities),
    defineGetRun(capabilities, pages),
  ];
}

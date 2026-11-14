import { defineHttpOperation } from '@on.auto/operations';
import { Schema } from 'effect';

import type { CheckedGoals, PlaybookGoals } from '../goals/playbook-goals.ts';
import { importPlaybookFields, ImportedPlaybookSchema } from './import-fields.ts';
import { playbookImported, playbookImportedInItsObject, type Importing } from './playbook-imported.ts';
import type { ImportPlanned, PlaybookImports, PlaybookImportsInItsObject } from './playbook-imports.ts';

const description = [
  'Makes a new playbook from a package, such as one an export answered: its goals, its page and its definitions, every definition paused, so nothing runs until its owner resumes it.',
  'Everything is checked before anything is written: the goals, the page, every definition as a save checks it, that this runtime serves each type, and that the org has every connection the definitions name.',
  'A package that fails any check writes nothing, and the issues say what is missing.',
  'Sending the same import_id with the same id and package again goes on where it stopped; another package under the same import_id, or an id that is taken, is refused.',
].join(' ');

type ImportHandle = (input: Importing) => ReturnType<typeof playbookImported>;

function importOperationOf(handle: ImportHandle) {
  return defineHttpOperation('org', 'command', {
    name: 'import_playbook',
    title: 'Import playbook',
    description,
    route: { method: 'POST', path: '/playbooks/import' },
    body: { kind: 'json' },
    successStatus: 201,
    inputSchema: Schema.Struct(importPlaybookFields),
    outputSchema: ImportedPlaybookSchema,
    reasons: ['conflict', 'invalid_input', 'unavailable'],
    handle,
  });
}

export function defineImportPlaybook<Checked extends CheckedGoals, Plan extends ImportPlanned>(
  goals: PlaybookGoals<Checked>,
  imports: PlaybookImports<Plan>,
) {
  return importOperationOf((input) => playbookImported(goals, imports, input));
}

export function defineImportPlaybookInItsObject<Checked extends CheckedGoals>(
  goals: PlaybookGoals<Checked>,
  imports: PlaybookImportsInItsObject<Checked>,
) {
  return importOperationOf((input) => playbookImportedInItsObject(goals, imports, input));
}

import { defineHttpOperation } from '@on.auto/operations';
import { Schema } from 'effect';

import type { DefinitionKind } from '../capability/definition-kinds.ts';
import { DefinitionNameField, SampleOutputField } from '../operations/definition-fields.ts';
import { definitionRead } from '../operations/definition-read.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { pageDefinitionType } from './page-subjects.ts';

const description = [
  'Renders a page now and answers it as get_definition does, with page.result and page.lately, so that it can be seen before its subject has run.',
  "`name` is the page's name, and `sample_output`, optional, an output of its subject to render result over, as a run that succeeded gave it.",
  "Without sample_output, result renders over the subject's latest run, and is left out when the subject has not run.",
].join(' ');

export function defineRenderPage(capabilities: readonly DefinitionKind[]) {
  const read = definitionRead(capabilities);
  return defineHttpOperation('playbook', 'query', {
    name: 'render_page',
    title: 'Render page',
    description,
    route: { method: 'POST', path: '/definitions/page/{name}/render' },
    body: { kind: 'json' },
    inputSchema: Schema.Struct({ name: DefinitionNameField, sample_output: Schema.optionalKey(SampleOutputField) }),
    outputSchema: DefinitionSchema,
    reasons: ['not_found', 'invalid_input', 'conflict'],
    handle: (asked) => read({ ...asked, type: pageDefinitionType, render: true }),
  });
}

export function pageOperationsOf(capabilities: readonly DefinitionKind[]) {
  return capabilities.some(({ presents }) => presents !== undefined) ? [defineRenderPage(capabilities)] : [];
}

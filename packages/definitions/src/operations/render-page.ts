import { defineHttpOperation, NotFound } from '@on.auto/operations';
import { Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField, SampleOutputField } from './definition-fields.ts';
import { definitionRead, type PageMissing } from './definition-read.ts';
import { defineRenderPlaybookPage } from './render-playbook-page.ts';

const description = [
  "Renders a definition's page now and answers the definition as get_definition does, with page.result and page.lately, so that the page can be seen before the definition has run.",
  '`sample_output`, optional, is an output to render result over, as a run that succeeded gave it.',
  "Without sample_output, result renders over the definition's latest run, and is left out when it has not run.",
].join(' ');

function noPage({ label, name }: PageMissing): NotFound {
  return new NotFound({ detail: `The ${label} ${name} has no page; save one with update_definition` });
}

export function defineRenderPage(capabilities: readonly Capability[], pages: SubjectPages) {
  const known = knownCapabilities(capabilities);
  const read = definitionRead(capabilities, pages, noPage);
  return known.publish(
    defineHttpOperation('playbook', 'query', {
      name: 'render_page',
      title: 'Render page',
      description,
      route: { method: 'POST', path: '/definitions/{type}/{name}/render' },
      body: { kind: 'json' },
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        sample_output: Schema.optionalKey(SampleOutputField),
      }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict'],
      handle: (asked) => read({ ...asked, render: true }),
    }),
  );
}

export function pageRenderings(capabilities: readonly Capability[], pages: SubjectPages) {
  return [defineRenderPage(capabilities, pages), defineRenderPlaybookPage(pages)];
}

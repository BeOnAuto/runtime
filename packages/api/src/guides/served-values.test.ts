import type { GuideVariables } from '@on.auto/definitions';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { describe, expect, it } from 'vitest';

import { guideFiles } from '../testing/guide-shelves.ts';
import { guideShelfFrom, type ServedType } from './served-guides.ts';

interface WorkflowBounds {
  readonly mostSteps: number;
  readonly longestRunMinutes: number;
}

const defaultBounds: WorkflowBounds = { mostSteps: 50, longestRunMinutes: 10 };

function guideVariablesOf(bounds: WorkflowBounds): GuideVariables {
  return {
    'workflow.most_steps': { value: `${bounds.mostSteps} steps`, default: `${defaultBounds.mostSteps} steps` },
    'workflow.longest_run': {
      value: `${bounds.longestRunMinutes} minutes`,
      default: `${defaultBounds.longestRunMinutes} minutes`,
    },
  };
}

function workflowsHeldTo(bounds: WorkflowBounds | undefined): ServedType {
  return {
    type: 'workflow',
    noun: { one: 'workflow', other: 'workflows' },
    guide: bounds === undefined ? { name: 'workflow' } : { name: 'workflow', variables: guideVariablesOf(bounds) },
  };
}

function withValues(text: string): string {
  return text
    .replace(
      'through steps.',
      'through steps, at most <span data-variable="workflow.most_steps">50 steps</span> of them.',
    )
    .replace(
      '## Document fields',
      [
        '<div data-variable="workflow.longest_run">',
        '',
        '```yaml',
        'timeout: 10 minutes',
        '```',
        '',
        '</div>',
        '',
        '## Document fields',
      ].join('\n'),
    );
}

function withTheTemplatesValue(text: string): string {
  return text.replace(
    /^# .*$/mu,
    (title) => `${title}\n\nA template renders within <span data-variable="templates.longest">2 seconds</span>.`,
  );
}

const files: ShippedFiles = {
  text: (file) =>
    guideFiles.text(file).then((text) => {
      if (file.path === 'docs/reference/workflow-format.md') {
        return withValues(text);
      }
      return file.path === 'docs/reference/template.md' ? withTheTemplatesValue(text) : text;
    }),
  bytes: (file) => guideFiles.bytes(file),
  list: (folder) => guideFiles.list(folder),
};

const templatesValue: GuideVariables = { 'templates.longest': { value: '5 seconds', default: '2 seconds' } };

function servedTo(bounds: WorkflowBounds | undefined, variables: GuideVariables): ReturnType<typeof guideShelfFrom> {
  return guideShelfFrom(files, [workflowsHeldTo(bounds)], { pages: false, variables });
}

describe('the guide of a capability whose page names its values', () => {
  it('says each value as the bounds the capability was given have it, in a sentence and in its example', async () => {
    const asComposed = await servedTo(defaultBounds, templatesValue);
    const heldToOthers = await servedTo({ mostSteps: 200, longestRunMinutes: 45 }, templatesValue);

    expect(asComposed.named('workflow')?.text).toContain('through steps, at most 50 steps of them.');
    expect(asComposed.named('workflow')?.text).toContain('```yaml\ntimeout: 10 minutes\n```\n\n## Document fields');
    expect(heldToOthers.named('workflow')?.text).toContain('through steps, at most 200 steps of them.');
    expect(heldToOthers.named('workflow')?.text).toContain('```yaml\ntimeout: 45 minutes\n```\n\n## Document fields');
    expect(heldToOthers.named('workflow')?.text).not.toMatch(/data-variable|50 steps|10 minutes/u);
  });

  it("says a value the server gives for a page that is no capability's, as the server has it", async () => {
    const shelf = await servedTo(defaultBounds, templatesValue);

    expect(shelf.named('templates')?.text).toContain('A template renders within 5 seconds.');
  });
});

describe('the guides of a server whose pages name values', () => {
  it('cannot be built where a page names a value the server does not declare', async () => {
    await expect(servedTo(undefined, templatesValue)).rejects.toThrow(
      'The page reference/workflow-format.md cannot be served as a guide. The line "<div data-variable="workflow.longest_run">" names the value workflow.longest_run, which this server does not declare. The line "A workflow coordinates a playbook\'s functions through steps, at most <span data-…" names the value workflow.most_steps, which this server does not declare.',
    );
  });

  it('cannot be built where the server declares one value twice', async () => {
    await expect(
      servedTo(defaultBounds, {
        ...templatesValue,
        'workflow.most_steps': { value: '1 step', default: '50 steps' },
      }),
    ).rejects.toThrow('The value workflow.most_steps is declared more than once for the guides of the server');
  });
});

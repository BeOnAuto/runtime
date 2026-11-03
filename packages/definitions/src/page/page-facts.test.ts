import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { PageEventSchema } from './page-facts.ts';

const ofThePlaybook = { at: '2026-11-02T10:00:00.000Z', by: 'key_7f3a' };

const source = [
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '        subject: workflow/close-the-month',
  '  views:',
  '    revenue: series',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  '      return view;',
  '    }',
  'lately: |',
  '  ```chart line',
  '  {{ views.revenue | json }}',
  '  ```',
  '',
].join('\n');

const saved = {
  type: 'playbook_page_saved',
  data: {
    page: {
      source,
      details: {
        data: {
          views: { revenue: 'series' },
          language: 'typescript',
          fold: 'export function fold(view: View, event: Event): View {\n  return view;\n}\n',
          foldLine: 10,
          filters: [{ type: 'run_succeeded', subject: 'workflow/close-the-month' }],
        },
      },
      stripped: { module: 'export function fold(view      , event       )       {\n  return view;\n}\n' },
    },
  },
  context: ofThePlaybook,
} as const;

describe('the facts of the page of a playbook', () => {
  recordedFactsBehaviour({
    schema: PageEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': [saved] },
  });
});

import type { VariableSegment } from '@on.auto/definitions/template';

import type { TemplateVariables } from './rendered-arguments.ts';

export interface TemplateSet {
  readonly names: readonly string[];
  readonly what: string;
  readonly sample: TemplateVariables;
  readonly structured: string;
}

const momentOfTheSample = '2026-10-07T09:00:00.000Z';

const sent = { conversation: 'C0123', id: '1699.1' };

export const callTemplates: TemplateSet = {
  names: ['input', 'today', 'now'],
  what: 'a template of a call',
  sample: { today: momentOfTheSample.slice(0, 10), now: momentOfTheSample },
  structured: 'input',
};

export const deliveryTemplates: TemplateSet = {
  names: ['input', 'today', 'now', 'to', 'message', 'run_id', 'function', 'expires_at', 'answer_schema'],
  what: 'a template of a delivery',
  sample: {
    today: momentOfTheSample.slice(0, 10),
    now: momentOfTheSample,
    to: 'ada',
    message: 'Please review the brief.',
    run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    function: 'approve-brief',
    expires_at: '2026-10-09T09:00:00.000Z',
    answer_schema: { type: 'object', properties: { choice: { type: 'string' } } },
  },
  structured: 'answer_schema',
};

export const conversationTemplates: TemplateSet = {
  names: ['to', 'sent.conversation', 'sent.id'],
  what: 'the conversation key of a reading',
  sample: { to: 'ada', sent },
  structured: 'sent',
};

export const readingTemplates: TemplateSet = {
  names: ['to', 'sent.conversation', 'sent.id', 'conversation', 'since'],
  what: 'a template of a reading',
  sample: { to: 'ada', sent, conversation: 'C0123/1699.1', since: '1699.2' },
  structured: 'sent',
};

export const tellingTemplates: TemplateSet = {
  names: ['to', 'sent.conversation', 'sent.id', 'message'],
  what: 'a template of a telling',
  sample: { to: 'ada', sent, message: 'To answer, reply with one of approve, reject.' },
  structured: 'sent',
};

function nestsUnder({ names }: TemplateSet, first: string): boolean {
  return names.some((name) => name.startsWith(`${first}.`));
}

export function nameOf(set: TemplateSet, path: readonly VariableSegment[]): string {
  const [first, ...nested] = path.map(String);
  const outer = String(first);
  return nested.length > 0 && nestsUnder(set, outer) ? `${outer}.${String(nested[0])}` : outer;
}

export function reads(set: TemplateSet, path: readonly VariableSegment[]): boolean {
  const name = nameOf(set, path);
  return set.names.includes(name) || nestsUnder(set, name);
}

import { sampleMoment, type TemplateSet } from '@on.auto/definitions/tool-blocks';

const sent = { conversation: 'C0123', id: '1699.1' };

export const deliveryTemplates: TemplateSet = {
  names: ['input', 'today', 'now', 'to', 'message', 'run_id', 'function', 'expires_at', 'answer_schema'],
  what: 'a template of a delivery',
  sample: {
    today: sampleMoment.slice(0, 10),
    now: sampleMoment,
    to: 'ada',
    message: 'Please review the brief.',
    run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    function: 'approve-brief',
    expires_at: '2026-10-09T09:00:00.000Z',
    answer_schema: { type: 'object', properties: { choice: { type: 'string' } } },
  },
  structured: 'answer_schema',
};

export const conversationKeyTemplates: TemplateSet = {
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
  names: ['to', 'sent.conversation', 'sent.id', 'message', 'reply.id', 'reply.to'],
  what: 'a template of a telling',
  sample: {
    to: 'ada',
    sent,
    message: "Auto couldn't take that as an answer. Reply with approve or reject.",
    reply: { id: '1699.2', to: '1699.1' },
  },
  structured: 'sent',
};

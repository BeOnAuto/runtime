export const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

export const caller = { id: 'key_7f3a', name: 'key_7f3a' };

export const onTheRun = {
  ...acted,
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'reasoning',
  definitionName: 'qualify-lead',
  definitionVersion: 2,
};

export const calledByAWorkflow = {
  ...onTheRun,
  calledBy: { runId: '019a3c4e-1111-7c1a-9b3f-2f1e0d9c8b7a', reference: '/do/0/qualify', run: 1 },
  callDepth: 1,
  depth: 1,
  trigger: { kind: 'event', reference: '/schedule/on' },
} as const;

export const usage = {
  input: { total: 1200, uncached: 200, cache_read: 1000, cache_write: 0 },
  output: { total: 300, text: 250, reasoning: 50 },
  total: 1500,
};

export const toolCall = { number: 1, call_id: 'call-1', server: 'crm', tool: 'find_contact' };

export const modelCall = { number: 2 };

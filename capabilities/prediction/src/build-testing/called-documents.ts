export function sendingDocument(expires = 'P1D'): string {
  return [
    '---',
    'description: Send a build to the trainer of the playbook',
    'to: trainer',
    `expires: ${expires}`,
    'input:',
    '  schema:',
    '    type: object',
    '    required: [build]',
    '    properties:',
    '      build: { type: object }',
    'output:',
    '  schema:',
    '    type: object',
    '    required: [candidates]',
    '    properties:',
    '      candidates: { type: array, items: { type: string } }',
    '      recipe: { type: string }',
    '---',
    'Build {{ input.build.run_id }} of {{ input.build.function }} waits for its candidates.',
  ].join('\n');
}

export function approvingDocument(expires = 'P1D'): string {
  return [
    '---',
    'description: Ask the owner of the forecasts to approve a version',
    'to: owner',
    `expires: ${expires}`,
    'input:',
    '  schema:',
    '    type: object',
    '    required: [function, version, card]',
    '    properties:',
    '      function: { type: string }',
    '      version: { type: integer }',
    '      card: { type: object }',
    'output:',
    '  schema:',
    '    type: object',
    '    required: [decision]',
    '    properties:',
    '      decision: { type: string, enum: [approve, reject] }',
    '---',
    'Version {{ input.version }} of {{ input.function }} waits for your approval.',
  ].join('\n');
}

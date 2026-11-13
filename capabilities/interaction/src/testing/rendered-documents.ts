export const renderedDelivery: readonly string[] = [
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '{{ to }}'",
  "    blocks: '{{ rendered }}'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
];

const reviewInput: readonly string[] = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [owner, review]',
  '    properties:',
  '      owner: { type: string }',
  '      review: { type: string }',
];

const reviewCard: readonly string[] = [
  'root: card',
  'elements:',
  '  card:',
  '    type: Card',
  '    props: { title: Campaign brief review }',
  '    children: [review]',
  '  review:',
  '    type: Text',
  '    props: { content: { $state: /input/review } }',
];

export interface RenderedDocumentParts {
  readonly front?: readonly string[];
  readonly delivery?: readonly string[];
  readonly input?: readonly string[];
  readonly card?: readonly string[];
}

export function renderedDocument({
  front = ["to: '{{ input.owner }}'", 'expires: P2D', 'render: slack'],
  delivery = renderedDelivery,
  input = reviewInput,
  card = reviewCard,
}: RenderedDocumentParts = {}): string {
  return ['---', ...front, ...delivery, ...input, '---', ...card].join('\n');
}

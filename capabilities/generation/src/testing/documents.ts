export const imageSource = [
  '---',
  'description: A picture of the product for its listing',
  'produces: image',
  'model: gateway/openai/gpt-image-2',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [product]',
  '    properties:',
  '      product: { type: string }',
  '      photo: { type: string }',
  'parameters:',
  '  size: 1024x1024',
  '  quality: high',
  'expires: P30D',
  '---',
  'A studio photograph of {{ input.product }} on a white table.',
].join('\n');

export const referringSource = [
  '---',
  'produces: image',
  'model: gateway/openai/gpt-image-2',
  'references: [/photo]',
  '---',
  'The same product, {{ input.product }}, in a garden.',
].join('\n');

export const audioSource = [
  '---',
  'produces: audio',
  'model: gateway/openai/gpt-4o-mini-tts',
  'parameters:',
  '  voice: coral',
  '---',
  'Welcome to {{ input.shop }}. Today is {{ today }}.',
].join('\n');

export const videoSource = [
  '---',
  'produces: video',
  'model: gateway/example/short-film',
  'parameters:',
  '  size: 720x1280',
  '  duration: 8',
  '---',
  'A drone flight over the warehouse.',
].join('\n');

export function sourceWith(frontMatter: readonly string[], prompt = 'A lighthouse at dawn.'): string {
  return ['---', ...frontMatter, '---', prompt].join('\n');
}

import { describe, expect, it } from 'vitest';

import { renderedDelivery, renderedDocument } from '../testing/rendered-documents.ts';
import { problemsOf, renderedDocumentOf, replacing, requestDocumentOf, without } from '../testing/route-documents.ts';

const front = ["to: '{{ input.owner }}'", 'expires: P2D'];

function withRender(...more: readonly string[]) {
  return [...front, ...more];
}

describe('a request with render', () => {
  it('keeps the target and the card its body writes, and no message template', () => {
    const parsed = renderedDocumentOf(renderedDocument());

    expect(parsed.render).toEqual({
      target: 'slack',
      card: {
        root: 'card',
        elements: {
          card: { type: 'Card', props: { title: 'Campaign brief review' }, children: ['review'] },
          review: { type: 'Text', props: { content: { $state: '/input/review' } } },
        },
      },
    });
    expect(parsed).not.toHaveProperty('message');
    expect(parsed.route?.deliver.with).toEqual({
      channel: '{{ to }}',
      blocks: '{{ rendered }}',
      text: '{{ message }}',
    });
  });

  it('is saved when deliver.with reads rendered and no message', () => {
    const blocksOnly = without(renderedDelivery, "    text: '{{ message }}'");

    expect(problemsOf(renderedDocument({ delivery: blocksOnly }))).toEqual([]);
  });

  it('is refused for a target Auto does not render to, naming the ones it does', () => {
    expect(problemsOf(renderedDocument({ front: withRender('render: email') }))).toEqual([
      'Line 4, /render: render is email, which Auto does not render to; write one of: slack',
    ]);
  });

  it('is refused beside call, like the other keys of a request', () => {
    const source = [
      '---',
      'render: slack',
      'call: { server: chat, tool: post_message, with: { text: x } }',
      'output: { schema: { type: object } }',
      '---',
      '',
    ].join('\n');

    expect(problemsOf(source)).toEqual([
      'Line 2, /render: A function with call answers at once and asks no party, so it takes no render',
    ]);
  });
});

describe('the way a request with render is sent', () => {
  it('is refused without a tool to send through', () => {
    expect([
      problemsOf(renderedDocument({ front: withRender('render: slack'), delivery: [] })),
      problemsOf(renderedDocument({ front: withRender('render: slack'), delivery: ['deliver: agent'] })),
    ]).toEqual([
      [
        "Line 4, /render: A request with render is sent through the tool of a connection, so write deliver with the server and tool that send it, and read the message with, for example, blocks: '{{ rendered }}'",
      ],
      [
        "Line 5, /deliver: A request with render goes through the tool of a connection, which sends what it renders; deliver: agent holds text for an agent, so write deliver with the server and tool that send it, and read the message with, for example, blocks: '{{ rendered }}'",
      ],
    ]);
  });

  it('is refused when deliver.with does not read rendered', () => {
    const textOnly = without(renderedDelivery, "    blocks: '{{ rendered }}'");

    expect(problemsOf(renderedDocument({ delivery: textOnly }))).toEqual([
      "Line 9, /deliver/with: A request with render sends the message it renders, so deliver.with reads rendered somewhere; write for example blocks: '{{ rendered }}'",
    ]);
  });

  it('is refused for rendered written among text', () => {
    const among = replacing(renderedDelivery, "    text: '{{ message }}'", "    text: 'Blocks: {{ rendered }}'");

    expect(problemsOf(renderedDocument({ delivery: among }))).toEqual([
      'Line 11, /deliver/with/text: Renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
    ]);
  });
});

describe('the body of a request with render, at save', () => {
  it('is refused for a body that is not YAML, empty, or not a card', () => {
    expect([
      problemsOf(renderedDocument({ card: ['root: card', 'elements: [a'] })),
      problemsOf(renderedDocument({ card: [] })),
      problemsOf(renderedDocument({ card: ['- card'] })),
      problemsOf(renderedDocument({ card: ['Approve {{ input.review }}?'] })),
    ]).toEqual([
      [expect.stringMatching(/^Line 2\d: /u)],
      ['Line 23: The definition has no message: write its card, with root and elements, after the front matter'],
      ['Line 23: Write the body as a mapping with `root` and `elements`'],
      ['Line 23: Write the body as a mapping with `root` and `elements`'],
    ]);
  });

  it('is refused with the line of each issue of its card', () => {
    const card = [
      'root: card',
      'elements:',
      '  card:',
      '    type: Card',
      '    props: { title: T }',
      '    children: [body]',
      '  body:',
      '    type: Button',
      '    props: { label: Go }',
    ];

    expect(problemsOf(renderedDocument({ card }))).toEqual([
      expect.stringMatching(
        /^Line 30, \/elements\/body\/type: Button is interactive\. A click is not taken as an answer/u,
      ),
      expect.stringMatching(/^Line 31, \/elements\/body\/props\/id: This does not fit a Button/u),
    ]);
  });
});

describe('the state a request with render reads, at save', () => {
  it('is refused for a state it reads outside the input, the day and the time, or the input has no property of', () => {
    const card = [
      'root: card',
      'elements:',
      '  card:',
      '    type: Card',
      '    props: { title: { $state: /user/name } }',
      '    children: [body]',
      '  body:',
      '    type: Text',
      '    props: { content: { $state: /input/missing } }',
    ];
    const closed = [
      'input:',
      '  schema:',
      '    type: object',
      '    additionalProperties: false',
      '    required: [owner]',
      '    properties:',
      '      owner: { type: string }',
    ];

    expect(problemsOf(renderedDocument({ card, input: closed }))).toEqual([
      'Line 27, /elements/card/props/title/$state: Reads /user/name, which a request does not have; start the path with /input, /today or /now',
      'Line 31, /elements/body/props/content/$state: input.missing is not a property of the input schema, which allows no others',
    ]);
  });

  it('names a body line for a card issue that has no place of its own', () => {
    expect(problemsOf(renderedDocument({ card: ['root: card', 'elements: {}'] }))).toEqual([
      expect.stringMatching(/^Line 2\d, \/root: Root names "card"/u),
    ]);
  });
});

describe('the front matter of a request with render', () => {
  it('is not compiled as a template when the front matter is refused', () => {
    expect([
      problemsOf(renderedDocument({ front: withRender('render: slack', 'colour: red'), card: ['{{ nope'] })),
      problemsOf(renderedDocument({ front: ['render: slack', 'to: [', 'expires: P2D'], card: ['{{ nope'] })),
    ]).toEqual([
      [expect.stringContaining('colour is not a key of the front matter')],
      [expect.stringMatching(/^Line \d: /u)],
    ]);
  });

  it('reports a body that is not a card beside a missing party or expiry', () => {
    expect(problemsOf(renderedDocument({ front: ['render: slack'], card: ['- card'] }))).toEqual([
      'Line 1, /to: to is required, the party the request goes to, unless the function asks a system with call',
      'Line 1, /expires: expires is required, how long the request waits, unless the function asks a system with call',
      'Line 21: Write the body as a mapping with `root` and `elements`',
    ]);
  });
});

describe('a request without render', () => {
  const textDelivery = replacing(renderedDelivery, "    blocks: '{{ rendered }}'", "    blocks: '{{ input.review }}'");

  it('still reads its body as a message', () => {
    const source = renderedDocument({ front, delivery: textDelivery, card: ['Please review {{ input.review }}.'] });

    expect(problemsOf(source)).toEqual([]);
    expect(requestDocumentOf(source).message.variables.map(({ path }) => path)).toEqual([['input', 'review']]);
  });

  it('is refused for a template that reads rendered, which needs render', () => {
    const source = renderedDocument({ front, card: ['Please review {{ input.review }}.'] });

    expect(problemsOf(source)).toEqual([
      'Line 8, /deliver/with: rendered is the message a request with render builds, so a function that reads it writes render: slack in its front matter',
    ]);
  });
});

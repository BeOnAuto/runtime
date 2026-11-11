import assert from 'node:assert/strict';
import { test } from 'node:test';

import { instructionsShownInFull, promptOf, type Brief, type Shown } from './prompts.ts';

const instructions = `Read the guide start first. ${'Then build from the job. '.repeat(30)}This connection acts as someone.`;

const shown: Shown = {
  instructions,
  tools: [
    { name: 'create_definition', listed: { name: 'create_definition', description: 'Saves a definition.' } },
    { name: 'get_guide', listed: { name: 'get_guide', description: 'Reads a guide.' } },
  ],
  welcome: 'No playbooks yet. Read the guide start.',
  start: '# Start\n\nBuild from the job.\n',
  firstPlaybook: '# Create your first playbook\n\n1. Ask the job.\n',
  search: '{"tools":[]}',
};

const judging: Brief = {
  id: 'J9',
  shape: 'J',
  business: 'testing',
  held_out: false,
  search: false,
  text: 'Judge what I paste.',
};

const reading: Brief = { ...judging, id: 'R9', shape: 'R', search: true, text: 'Read, total and write.' };

const person = { serverName: 'auto', starter: 'Use auto to list my playbooks.' };

const listingWhole = JSON.stringify(shown.tools.map(({ listed }) => listed));

await test('a client that shows the listing alone gives the whole listing and no instructions', () => {
  const prompt = promptOf(shown, { profile: 'listing' }, judging, person);

  assert.ok(prompt.includes(listingWhole));
  assert.ok(!prompt.includes('Read the guide start first.'));
  assert.ok(!prompt.includes('{"load"'));
});

await test('a client that shows the first 512 characters of the instructions cuts them there, beside the whole listing', () => {
  const prompt = promptOf(shown, { profile: 'first-512' }, judging, person);

  assert.ok(prompt.includes(`=== Server instructions ===\n${instructions.slice(0, 512)}\n\n`));
  assert.ok(!prompt.includes(instructions.slice(0, 513)));
  assert.ok(prompt.includes(listingWhole));
});

await test('a client that shows tools by name gives the instructions and the names, and a tool’s entry once it is loaded', () => {
  const first = promptOf(shown, { profile: 'names' }, judging, person);
  const loaded = promptOf(shown, { profile: 'names', loaded: ['get_guide'] }, judging, person);

  assert.ok(instructions.length < instructionsShownInFull);
  assert.ok(first.includes(instructions));
  assert.ok(first.includes('=== Tools the server lists, by name ===\ncreate_definition, get_guide\n'));
  assert.ok(!first.includes('Saves a definition.'));
  assert.ok(first.includes('{"load":["<tool name>"]}'));
  assert.ok(loaded.includes('=== Tools your client loaded ===\n[{"name":"get_guide","description":"Reads a guide."}]'));
  assert.ok(!loaded.includes('{"load":["<tool name>"]}'));
});

await test('the conversation follows the onboarding path, and gives what search answers only for a brief that reads or acts', () => {
  const judged = promptOf(shown, { profile: 'listing' }, judging, person);
  const read = promptOf(shown, { profile: 'listing' }, reading, person);
  const inOrder = [
    'The person has connected an MCP server named "auto".',
    'Person: Use auto to list my playbooks.',
    `You called list_playbooks {}. It answered:\n${shown.welcome}`,
    `You called get_guide {"guide":"start"}. It answered:\n${shown.start}`,
    `You called get_guide {"guide":"first-playbook"}. It answered:\n${shown.firstPlaybook}`,
    'Person: Read, total and write.',
    'listing every definition you would save with create_definition',
  ];

  const places = inOrder.map((part) => read.indexOf(part));

  assert.ok(places.every((place) => place >= 0));
  assert.deepEqual(
    places,
    places.toSorted((one, other) => one - other),
  );
  assert.ok(read.includes('You called search {}. It answered:\n{"tools":[]}'));
  assert.ok(!judged.includes('You called search'));
  assert.ok(judged.startsWith('Answer in text only, from what is written below. Use no tool'));
});

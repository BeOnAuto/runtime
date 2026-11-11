import { Schema } from 'effect';

import { ShapeSchema } from './grading.ts';

export const ProfileSchema = Schema.Literals(['listing', 'first-512', 'names']);

export type Profile = typeof ProfileSchema.Type;

export const BriefSchema = Schema.Struct({
  id: Schema.String,
  shape: ShapeSchema,
  business: Schema.String,
  held_out: Schema.Boolean,
  search: Schema.Boolean,
  text: Schema.String,
});

export type Brief = typeof BriefSchema.Type;

export const ShownSchema = Schema.Struct({
  instructions: Schema.String,
  tools: Schema.Array(Schema.Struct({ name: Schema.String, listed: Schema.Unknown })),
  welcome: Schema.String,
  start: Schema.String,
  firstPlaybook: Schema.String,
  search: Schema.String,
});

export type Shown = typeof ShownSchema.Type;

export interface Person {
  readonly serverName: string;
  readonly starter: string;
}

export const instructionsShownInFull = 4096;

const instructionsShownAlone = 512;

const ask = [
  'Do not call any tool now and do not ask the person anything more: assume they agree to what you propose and that',
  'any service the job names is the one search shows, or not connected where search was not called. Answer with ONLY',
  'one line of JSON, no prose and no code fence, listing every definition you would save with create_definition for',
  'this job, in the order you would save them:',
  '{"definitions":[{"type":"<the type you would give create_definition>","name":"<its name>",',
  '"tools":["<server/tool that its document names in tools, if any>"],',
  '"calls":["<for a workflow: the name of the definition each of its steps calls, in order>"]}]}',
].join(' ');

const askToLoad = [
  'Your client shows a tool by its name until you load it. If you need the full entry of any tool to answer, answer',
  'instead with ONLY one line of JSON naming them, {"load":["<tool name>"]}, and you will be asked again with them.',
].join(' ');

function listingSeen({ instructions, tools }: Shown, profile: Profile, loaded: readonly string[]): readonly string[] {
  const whole = ['=== Tools the server lists (tools/list) ===', JSON.stringify(tools.map(({ listed }) => listed)), ''];
  const shownUpTo = (most: number) => ['=== Server instructions ===', instructions.slice(0, most), ''];
  if (profile === 'listing') {
    return whole;
  }
  if (profile === 'first-512') {
    return [...shownUpTo(instructionsShownAlone), ...whole];
  }
  const entries = tools.filter(({ name }) => loaded.includes(name)).map(({ listed }) => listed);
  return [
    ...shownUpTo(instructionsShownInFull),
    '=== Tools the server lists, by name ===',
    tools.map(({ name }) => name).join(', '),
    '',
    ...(entries.length === 0 ? [] : ['=== Tools your client loaded ===', JSON.stringify(entries), '']),
  ];
}

function closing(profile: Profile, loaded: readonly string[]): readonly string[] {
  return profile === 'names' && loaded.length === 0 ? [askToLoad, ask] : [ask];
}

export function promptOf(
  shown: Shown,
  { profile, loaded = [] }: { readonly profile: Profile; readonly loaded?: readonly string[] },
  brief: Brief,
  person: Person,
): string {
  return [
    'Answer in text only, from what is written below. Use no tool: run no command and read or write no file.',
    '',
    `You are an AI assistant in a chat with a person. The person has connected an MCP server named "${person.serverName}".`,
    'Below is what your client gives you from it, exactly as served, and the conversation so far.',
    '',
    ...listingSeen(shown, profile, loaded),
    '=== Conversation ===',
    `Person: ${person.starter}`,
    '',
    'You called list_playbooks {}. It answered:',
    shown.welcome,
    '',
    'You called get_guide {"guide":"start"}. It answered:',
    shown.start,
    '',
    'You called get_guide {"guide":"first-playbook"}. It answered:',
    shown.firstPlaybook,
    '',
    ...(brief.search ? ['You called search {}. It answered:', shown.search, ''] : []),
    'You asked the person what job they want done again and again.',
    `Person: ${brief.text}`,
    '',
    ...closing(profile, loaded),
  ].join('\n');
}

import { describe, expect, it } from 'vitest';

import { foundIn, oldWordsIn } from './old-words.ts';

describe('the old words of the vocabulary', () => {
  it('are found in a text, each where it stands, and none in a text in the words of playbooks', () => {
    expect(oldWordsIn('A brain_key opened the execution of a spec.')).toEqual(['spec', 'execution', 'brain_key']);
    expect(foundIn('One spec, two specs.', 'specs?')).toEqual([
      { index: 4, word: 'spec' },
      { index: 14, word: 'specs' },
    ]);
    expect(oldWordsIn('A playbook runs its functions and workflows.')).toEqual([]);
  });

  it('name a tool server by its transport, in the kinds a refusal carries and the name a model sees', () => {
    expect(oldWordsIn('mcp_server_failed, because mcp_server_not_configured, calling mcp__graph__search')).toEqual([
      'mcp_server_failed',
      'mcp_server_not_configured',
      'mcp__',
    ]);
    expect(oldWordsIn('tool_server_failed, because tool_server_not_configured, calling graph__search')).toEqual([]);
  });

  it('find the old route that ran a definition, and pass the route that calls a tool and the folder of execute', () => {
    expect(oldWordsIn('It called POST /v1/orgs/{org}/execute to run it.')).toEqual(['/execute']);
    expect(oldWordsIn('POST /tool-servers/{server}/tools/{tool}/execute, in src/execute/execute.ts')).toEqual([]);
  });
});

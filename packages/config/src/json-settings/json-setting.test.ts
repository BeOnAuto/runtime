import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { decodedJsonSetting, decodedSettingValue, pointerOf, problem, settingProblemText } from '../index.ts';

const EntriesSchema = Schema.Record(Schema.String, Schema.Struct({ url: Schema.String }));

describe('a setting that holds JSON', () => {
  it('decodes the value its schema takes', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{"graph":{"url":"https://example.com"}}', EntriesSchema)).toEqual(
      Result.succeed({ graph: { url: 'https://example.com' } }),
    );
  });

  it('names its setting and the place of every problem, never the value', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{"graph":{"url":1,"key":"secret-value"}}', EntriesSchema)).toEqual(
      Result.fail([
        { setting: 'EXAMPLE_SERVERS', pointer: '/graph/key', detail: 'Expected no excess property' },
        { setting: 'EXAMPLE_SERVERS', pointer: '/graph/url', detail: 'Expected string' },
      ]),
    );
  });

  it('is refused at its root when it is not JSON', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{graph', EntriesSchema)).toEqual(
      Result.fail([{ setting: 'EXAMPLE_SERVERS', pointer: '', detail: 'Expected JSON' }]),
    );
  });

  it('decodes a value already parsed, its problems named as those of its text', () => {
    expect(decodedSettingValue('EXAMPLE_SERVERS', { graph: { url: 'https://example.com' } }, EntriesSchema)).toEqual(
      Result.succeed({ graph: { url: 'https://example.com' } }),
    );
    expect(decodedSettingValue('EXAMPLE_SERVERS', { graph: { url: 1 } }, EntriesSchema)).toEqual(
      Result.fail([{ setting: 'EXAMPLE_SERVERS', pointer: '/graph/url', detail: 'Expected string' }]),
    );
  });
});

describe('the place of a problem', () => {
  it('is a JSON pointer, with its segments escaped, carried beside its words', () => {
    expect(pointerOf(['a/b', 'c~d', 0])).toBe('/a~1b/c~0d/0');
    expect(problem('EXAMPLE', '', 'Expected an object')).toEqual({
      setting: 'EXAMPLE',
      pointer: '',
      detail: 'Expected an object',
    });
  });

  it('is written after its setting, the root as /, and left out for a problem of a whole setting', () => {
    expect([
      settingProblemText(problem('EXAMPLE', '/graph/url', 'Expected string')),
      settingProblemText(problem('EXAMPLE', '', 'Expected an object')),
      settingProblemText({ setting: 'EXAMPLE', detail: 'Expected text' }),
    ]).toEqual(['EXAMPLE: /graph/url: Expected string', 'EXAMPLE: /: Expected an object', 'EXAMPLE: Expected text']);
  });
});

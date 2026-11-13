import { SlackBlockError } from '@chat-adapter/slack/blocks';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { attempted } from './render-failures.ts';

describe('an attempt to build a message', () => {
  it('succeeds with what it built', () => {
    expect(attempted(() => 7)).toEqual(Result.succeed(7));
  });

  it('fails with the issues of a card the card cannot make', () => {
    expect(
      attempted(() => {
        throw Object.assign(new Error('one\ntwo'), { issues: ['one', 'two'] });
      }),
    ).toEqual(Result.fail(['one', 'two']));
  });

  it('fails with the words of a block Slack cannot hold', () => {
    expect(
      attempted(() => {
        throw new SlackBlockError('too many');
      }),
    ).toEqual(Result.fail(['too many']));
  });

  it('lets a failure whose issues are not texts through, for it is a defect', () => {
    expect(() =>
      attempted(() => {
        throw Object.assign(new Error('odd'), { issues: [1] });
      }),
    ).toThrow('odd');
  });

  it('lets any other failure through, for it is a defect', () => {
    expect(() =>
      attempted(() => {
        throw new RangeError('defect');
      }),
    ).toThrow('defect');
  });
});

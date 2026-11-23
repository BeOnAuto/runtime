import { describe, expect, it } from 'vitest';

import { chatRenderingOf } from './render-targets.ts';
import {
  answerOf,
  conversationOf,
  cutBefore,
  earlierIn,
  lineWithALinkButton,
  MOST_MARKDOWN_CHARACTERS,
  mentionedIn,
  neutralized,
  slackChat,
  THREAD_HEADING,
  withoutTheApp,
} from './slack-chat.ts';

const fence = '```';

const fencesIn = (text: string): number => text.split(fence).length - 1;

describe("a model's answer, made safe for Slack", () => {
  it.each([
    ['a ping of the whole channel', '<!channel> look', '<!'],
    ['a ping of whoever is here, named', '<!here|here> look', '<!'],
    ['a ping of a group', '<!subteam^S1|team> look', '<!'],
    ['a stranger named', '<@U9STRANGER> look', '<@U9STRANGER'],
    ['a stranger named with a label', '<@U9STRANGER|eve> look', '<@U9STRANGER'],
    ['the plain words that ping', '@here and @Everyone and @channel', '@h'],
  ])('pings nobody for %s', (_, written, ping) => {
    expect(neutralized(written, new Set(['U1ADA']))).not.toContain(ping);
  });

  it('keeps a person the conversation already holds, and names whom a text mentions', () => {
    expect([
      neutralized('thanks <@U1ADA>', new Set(['U1ADA'])),
      [...mentionedIn(['<@U1ADA> and <@U2BOB|bob>', 'none here'])],
    ]).toEqual(['thanks <@U1ADA>', ['U1ADA', 'U2BOB']]);
  });

  it('is made safe and trimmed the same way it is remembered', () => {
    expect(slackChat.madeSafe(' <!here> hi ', new Set())).toBe(neutralized('<!here> hi', new Set()));
  });
});

describe("a model's answer, fitted to one Slack message", () => {
  const bounds = { characters: 200 };

  it('is posted whole where it fits, and says so where the turn stopped at its bound', () => {
    const whole = answerOf('A short answer.', false, new Set(), bounds);
    const bounded = answerOf('A short answer.', true, new Set(), bounds);

    expect([whole, bounded.startsWith(whole), bounded.length > whole.length]).toEqual(['A short answer.', true, true]);
  });

  it.each([
    ['at a paragraph', `${'a'.repeat(30)}\n\n${'b'.repeat(400)}`, false],
    ['inside a fence it then closes', `${fence}\n${'c'.repeat(20)}\n${'d'.repeat(400)}`, false],
    ['and says where the turn stopped at its bound', 'e'.repeat(400), true],
  ])('is shortened %s, within the length of the block', (_, written, isBounded) => {
    const posted = answerOf(written, isBounded, new Set(), { characters: 200 });

    expect([posted.length <= 200, fencesIn(posted) % 2, posted.startsWith(written)]).toEqual([true, 0, false]);
  });

  it('holds at most the characters of a markdown block by default', () => {
    expect(answerOf('f'.repeat(MOST_MARKDOWN_CHARACTERS + 10), false, new Set()).length).toBeLessThanOrEqual(
      MOST_MARKDOWN_CHARACTERS,
    );
  });
});

describe('a text cut before a bound', () => {
  it.each([
    ['that fits', 'abc', 5, 'abc'],
    ['at its last paragraph', 'ab\n\ncd\n\nef', 8, 'ab\n\ncd'],
    ['at its last line', 'ab\ncd ef', 6, 'ab'],
    ['before an entity it would break', 'abcdefgh &amp', 12, 'abcdefgh '],
    ['through an entity it keeps whole', 'abcdefg &amp; more', 13, 'abcdefg &amp;'],
    ['far after an entity', 'a&b cdefghijkl', 12, 'a&b cdefghij'],
    ['before half a character', 'abc😀', 4, 'abc'],
  ])('is cut %s', (_, text, bound, cut) => {
    expect(cutBefore(text, bound)).toBe(cut);
  });
});

describe('the earlier messages of a thread, read once', () => {
  const thread = [
    { id: '1', sender: 'U1ADA', text: 'Can someone\ncheck the run?' },
    { id: '2', sender: 'U0AUTO', text: 'I checked it.' },
    { id: '3', automatic: 'B0OTHER', text: 'A note from another app' },
    { id: '4', text: 'Nobody named' },
    { id: '5', sender: 'U2BOB', text: 'Thanks' },
  ];

  it("keeps the app's own as its answers and everyone else's as one message under the heading, without the one asked", () => {
    const [assistant, context] = earlierIn(thread, { id: '5', app: 'U0AUTO' }, 15);

    expect([assistant, context?.author, context?.text.startsWith(THREAD_HEADING), context?.text.split('\n')]).toEqual([
      { author: 'assistant', sender: undefined, text: 'I checked it.' },
      'context',
      true,
      [THREAD_HEADING, '<@U1ADA>: Can someone check the run?', '<@B0OTHER>: A note from another app'],
    ]);
  });

  it('keeps the newest it may, and takes every message as someone else’s where the app is not named', () => {
    expect([
      earlierIn(thread, { id: '9', app: 'U0AUTO' }, 1),
      earlierIn(thread, { id: '9', app: undefined }, 2).map(({ author }) => author),
      earlierIn([{ id: '1', text: 'alone' }], { id: '9', app: undefined }, 5),
    ]).toEqual([
      [{ author: 'context', sender: undefined, text: `${THREAD_HEADING}\n<@U2BOB>: Thanks` }],
      ['context'],
      [],
    ]);
  });
});

describe('the conversation a turn tells the model', () => {
  it('names nobody where one person asked, and merges what one side said in a row', () => {
    const told = conversationOf(
      [
        { author: 'person', sender: 'U1ADA', text: 'First' },
        { author: 'person', sender: 'U1ADA', text: 'Second' },
        { author: 'assistant', sender: undefined, text: 'Answer' },
        { author: 'context', sender: undefined, text: 'Heading and lines' },
      ],
      { sender: 'U1ADA', text: 'Third' },
    );

    expect(told).toEqual({
      messages: [
        { role: 'user', text: 'First\n\nSecond' },
        { role: 'assistant', text: 'Answer' },
        { role: 'user', text: 'Heading and lines' },
        { role: 'user', text: 'Third' },
      ],
      people: new Set(['U1ADA']),
    });
  });

  it('names each writer where several asked, and keeps the newest replies not meant for Auto under the heading', () => {
    const told = conversationOf(
      [
        { author: 'overheard', sender: 'U3CAL', text: 'too old' },
        { author: 'person', sender: 'U2BOB', text: 'Hi' },
        { author: 'overheard', sender: 'U3CAL', text: 'lunch?' },
        { author: 'overheard', sender: undefined, text: 'later\nmaybe' },
        { author: 'person', sender: undefined, text: 'Unnamed' },
      ],
      { sender: 'U1ADA', text: 'Go on' },
      { lines: 2, characters: 5 },
    );

    expect(told).toEqual({
      messages: [
        { role: 'user', text: '<@U2BOB>: Hi' },
        { role: 'user', text: `${THREAD_HEADING}\n<@U3CAL>: lunch\n<@unknown>: later` },
        { role: 'user', text: 'Unnamed' },
        { role: 'user', text: '<@U1ADA>: Go on' },
      ],
      people: new Set(['U1ADA', 'U2BOB', 'U3CAL']),
    });
  });
});

describe('what Slack holds of the app beside the words', () => {
  it("drops the app's own mention from what a person wrote, and keeps the words as they are where no app is named", () => {
    expect([withoutTheApp('<@U0AUTO>  help ', 'U0AUTO'), withoutTheApp(' <@U0AUTO> help')]).toEqual([
      'help',
      '<@U0AUTO> help',
    ]);
  });

  it('names the account and the person a code connected', () => {
    const told = slackChat.words.connected({ account: 'Acme Sales', person: 'Ada Lovelace' });

    expect([told.includes('Acme Sales'), told.includes('Ada Lovelace')]).toEqual([true, true]);
  });

  it('lays a line out above a link button, with the line alone as the text where blocks are not shown', () => {
    expect(lineWithALinkButton('line', 'label', 'https://runtime.example.com/l/1')).toEqual({
      text: 'line',
      payload: [
        { type: 'section', text: { type: 'mrkdwn', text: 'line' } },
        {
          type: 'actions',
          elements: [
            { type: 'button', text: { type: 'plain_text', text: 'label' }, url: 'https://runtime.example.com/l/1' },
          ],
        },
      ],
    });
  });

  it('is the chat of the render target an entry selects, and none for a name no target has', () => {
    expect([chatRenderingOf('slack'), chatRenderingOf('teams'), chatRenderingOf()]).toEqual([
      slackChat,
      undefined,
      undefined,
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { loopbackNames, namesTheLoopback } from '../index.ts';

describe('the names of the loopback', () => {
  it('are written as localhost, 127.0.0.1 and [::1]', () => {
    expect(loopbackNames).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  it('take every way a URL may write the loopback', () => {
    expect(
      [
        'localhost',
        '127.0.0.1',
        '[::1]',
        new URL('http://LocalHost:5555/').hostname,
        'localhost.',
        'studio.localhost',
        '127.0.0.2',
        '127.255.255.254',
        '::1',
        '[0:0:0:0:0:0:0:1]',
        '[::ffff:127.0.0.1]',
        new URL('http://2130706433/').hostname,
        new URL('http://0x7f.1/').hostname,
        new URL('http://0177.0.0.1/').hostname,
      ].map((hostname) => namesTheLoopback(hostname)),
    ).toEqual(Array.from({ length: 14 }, () => true));
  });

  it('leave out every other host', () => {
    expect(
      [
        'evil.example',
        'localhost.example',
        '128.0.0.1',
        '10.0.0.1',
        '[::2]',
        '[::ffff:10.0.0.1]',
        '[2001:db8:1:2:3:4:5:6]',
        '',
        'exa mple',
      ].map((hostname) => namesTheLoopback(hostname)),
    ).toEqual(Array.from({ length: 9 }, () => false));
  });
});

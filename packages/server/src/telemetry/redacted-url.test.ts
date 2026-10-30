import { describe, expect, it } from 'vitest';

import { redactedUrlAttributes, withoutTheTokenOfALink } from './redacted-url.ts';

describe('the URL of an outbound request on its span', () => {
  it('keeps the origin and the path, and redacts every value of the query and the credentials', () => {
    expect(
      redactedUrlAttributes({
        origin: 'https://user:secret@gateway.example.com',
        path: '/v1/chat?api-key=sk-123&api-key=sk-456&model=x',
      }),
    ).toEqual({
      'url.full': 'https://gateway.example.com/v1/chat?api-key=REDACTED&model=REDACTED',
      'url.query': '?api-key=REDACTED&model=REDACTED',
    });
  });

  it('is left to the instrumentation when the request names no URL', () => {
    expect(redactedUrlAttributes({ origin: 'not a url', path: 'nor this' })).toEqual({});
  });
});

describe('the URL of an inbound request on its span', () => {
  it('masks the token of a link, after /connections/<id>/link/, and leaves every other URL as it is', () => {
    expect(
      [
        'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm/link/kQ2_x-9?view=1',
        'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm/link/kQ2_x-9',
        'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm',
        'http://127.0.0.1:5555/v1/orgs/acme/playbooks/link/definitions/reasoning/link/run',
      ].map((url) => withoutTheTokenOfALink(url)),
    ).toEqual([
      'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm/link/REDACTED?view=1',
      'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm/link/REDACTED',
      'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm',
      'http://127.0.0.1:5555/v1/orgs/acme/playbooks/link/definitions/reasoning/link/run',
    ]);
  });
});

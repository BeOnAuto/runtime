import { describe, expect, it } from 'vitest';

import { contentLocationOf, type ContentLocation } from './content-location.ts';

const located: readonly (readonly [string, ContentLocation])[] = [
  ['s3://playbook-content', { bucket: 'playbook-content', prefix: '' }],
  ['s3://playbook-content/', { bucket: 'playbook-content', prefix: '' }],
  [
    ' s3://playbook.content.eu/production/playbooks/ ',
    { bucket: 'playbook.content.eu', prefix: 'production/playbooks' },
  ],
  ['s3://playbook-content//a//b', { bucket: 'playbook-content', prefix: 'a/b' }],
  ['s3://playbook-content/content%20of%20playbooks', { bucket: 'playbook-content', prefix: 'content of playbooks' }],
];

describe('the location of the content on object storage', () => {
  it.each(located)('is the bucket and the prefix of %s', (url, location) => {
    expect(contentLocationOf(url)).toEqual(location);
  });

  it.each([
    'playbook-content',
    'https://playbook-content/prefix',
    's3://',
    's3://ab',
    's3://Playbook-Content',
    's3://-playbook-content',
    's3://access:secret@playbook-content',
    's3://playbook-content:9000',
    's3://playbook-content/prefix?versioning=on',
    's3://playbook-content/prefix#part',
    's3://playbook-content/%E0%A4%A',
  ])('is nothing for %s, which is not an S3 URL of a bucket alone and its prefix', (url) => {
    expect(contentLocationOf(url)).toBeUndefined();
  });
});

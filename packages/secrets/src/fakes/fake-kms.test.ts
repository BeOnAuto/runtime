import { Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { serveFakeKms } from './fake-kms.ts';

const key = 'arn:aws:kms:eu-west-1:111122223333:key/0f0e0d0c-0b0a-4908-8706-050403020100';

const alias = 'arn:aws:kms:eu-west-1:111122223333:alias/auto-runtime';

const fake = await serveFakeKms({ keys: [key], aliases: { [alias]: key } });

afterAll(fake.close);

async function asked(operation: string, body: Readonly<Record<string, unknown>>) {
  const answer = await fetch(fake.url, {
    method: 'POST',
    headers: { 'x-amz-target': `TrentService.${operation}`, 'content-type': 'application/x-amz-json-1.1' },
    body: JSON.stringify(body),
  });
  return { status: answer.status, body: await answer.json() };
}

const context = { 'on.auto/runtime': 'secret data key' };

const blobOf = (body: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ CiphertextBlob: Schema.String }))(body).CiphertextBlob;

describe('the fake KMS', () => {
  it('answers Encrypt with a blob that opens only under the key and the context it was made with, recording each call', async () => {
    const plaintext = Buffer.alloc(32, 7).toString('base64');
    const before = fake.calls().length;

    const encrypted = await asked('Encrypt', { KeyId: key, Plaintext: plaintext, EncryptionContext: context });
    const blob = blobOf(encrypted.body);
    const decrypted = await asked('Decrypt', { KeyId: key, CiphertextBlob: blob, EncryptionContext: context });
    const otherwise = await asked('Decrypt', { KeyId: key, CiphertextBlob: blob, EncryptionContext: {} });

    expect(encrypted).toMatchObject({ status: 200, body: { KeyId: key, EncryptionAlgorithm: 'SYMMETRIC_DEFAULT' } });
    expect(Buffer.from(blob, 'base64').includes(Buffer.alloc(32, 7))).toBe(false);
    expect(blob.includes(plaintext)).toBe(false);
    expect(decrypted).toEqual({
      status: 200,
      body: { Plaintext: plaintext, KeyId: key, EncryptionAlgorithm: 'SYMMETRIC_DEFAULT' },
    });
    expect(otherwise).toEqual({
      status: 400,
      body: {
        __type: 'InvalidCiphertextException',
        message: 'The encryption context is not the one the ciphertext was made with',
      },
    });
    expect(fake.calls().slice(before)).toEqual([
      { operation: 'Encrypt', keyId: key, context },
      { operation: 'Decrypt', keyId: key, context },
      { operation: 'Decrypt', keyId: key, context: {} },
    ]);
  });
});

describe('the context of a blob of the fake KMS', () => {
  it('opens the blob under its entries in any order', async () => {
    const written = { purpose: 'secret data key', runtime: 'on.auto' };
    const encrypted = await asked('Encrypt', { KeyId: key, Plaintext: 'AAAA', EncryptionContext: written });

    const decrypted = await asked('Decrypt', {
      KeyId: key,
      CiphertextBlob: blobOf(encrypted.body),
      EncryptionContext: { runtime: 'on.auto', purpose: 'secret data key' },
    });

    expect(decrypted).toMatchObject({ status: 200, body: { Plaintext: 'AAAA' } });
  });
});

const described = { status: 200, body: { KeyMetadata: { KeyId: '0f0e0d0c-0b0a-4908-8706-050403020100', Arn: key } } };

describe('the keys the fake KMS describes', () => {
  it('describes a key by its ARN or by an alias that names it, enabled, disabled or pending deletion, and records each call', async () => {
    const before = fake.calls().length;

    const answers = [await asked('DescribeKey', { KeyId: alias })];
    fake.tell(key, 'disabled');
    answers.push(await asked('DescribeKey', { KeyId: key }));
    fake.tell(key, 'pending_deletion');
    answers.push(await asked('DescribeKey', { KeyId: key }));
    fake.tell(key, 'enabled');

    expect(answers).toEqual([described, described, described]);
    expect(fake.calls().slice(before)).toEqual([
      { operation: 'DescribeKey', keyId: alias },
      { operation: 'DescribeKey', keyId: key },
      { operation: 'DescribeKey', keyId: key },
    ]);
  });

  it('refuses to describe an alias or a key it does not know, a body it cannot read, and a key it is told to fail', async () => {
    const unknownAlias = 'arn:aws:kms:eu-west-1:111122223333:alias/unknown';
    const unknownKey = 'arn:aws:kms:eu-west-1:111122223333:key/0a0b0c0d-0e0f-4000-8000-000000000000';
    fake.failWith(key, { type: 'ThrottlingException', status: 400 });

    const failed = await asked('DescribeKey', { KeyId: alias });
    fake.tell(key, 'enabled');

    expect([
      await asked('DescribeKey', { KeyId: unknownAlias }),
      await asked('DescribeKey', { KeyId: unknownKey }),
      await asked('DescribeKey', {}),
      failed,
    ]).toEqual([
      { status: 400, body: { __type: 'NotFoundException', message: `Alias ${unknownAlias} is not found.` } },
      { status: 400, body: { __type: 'NotFoundException', message: `Key '${unknownKey}' does not exist` } },
      { status: 400, body: { __type: 'SerializationException', message: 'The request is not one the fake KMS reads' } },
      { status: 400, body: { __type: 'ThrottlingException', message: 'Rate exceeded' } },
    ]);
  });
});

describe('a request the fake KMS does not take', () => {
  it('is an operation it does not answer, or one it cannot read, refused as KMS refuses them', async () => {
    expect([
      await asked('CreateKey', {}),
      await asked('Encrypt', { KeyId: key }),
      await asked('Decrypt', { KeyId: key }),
    ]).toEqual([
      { status: 400, body: { __type: 'UnknownOperationException', message: 'The fake KMS does not answer CreateKey' } },
      { status: 400, body: { __type: 'SerializationException', message: 'The request is not one the fake KMS reads' } },
      { status: 400, body: { __type: 'SerializationException', message: 'The request is not one the fake KMS reads' } },
    ]);
  });
});

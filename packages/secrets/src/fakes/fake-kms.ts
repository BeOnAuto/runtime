import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Option, Schema } from 'effect';

export type FakeKeyState = 'enabled' | 'disabled' | 'pending_deletion' | 'denied' | 'stalling';

export type FakeKmsOperation = 'Encrypt' | 'Decrypt' | 'DescribeKey';

export interface FakeKmsCall {
  readonly operation: FakeKmsOperation;
  readonly keyId: string;
  readonly context?: Readonly<Record<string, string>>;
}

export interface FakeKmsError {
  readonly type: string;
  readonly status: number;
}

export interface FakeKms {
  readonly url: string;
  readonly tell: (keyId: string, state: FakeKeyState) => void;
  readonly failWith: (keyId: string, error: FakeKmsError) => void;
  readonly point: (aliasArn: string, keyArn: string) => void;
  readonly calls: () => readonly FakeKmsCall[];
  readonly close: () => Promise<void>;
}

export interface FakeKmsOptions {
  readonly keys: readonly string[];
  readonly aliases?: Readonly<Record<string, string>>;
}

interface Answer {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

type Answering = Answer | 'stalled';

const ContextSchema = Schema.Record(Schema.String, Schema.String);

const EncryptSchema = Schema.Struct({
  KeyId: Schema.String,
  Plaintext: Schema.String,
  EncryptionContext: ContextSchema,
});

const DecryptSchema = Schema.Struct({
  KeyId: Schema.String,
  CiphertextBlob: Schema.String,
  EncryptionContext: ContextSchema,
});

const DescribeSchema = Schema.Struct({ KeyId: Schema.String });

const SealedSchema = Schema.fromJsonString(
  Schema.Struct({ keyId: Schema.String, context: ContextSchema, plaintext: Schema.String }),
);

type Sealed = typeof SealedSchema.Type;

type Context = Readonly<Record<string, string>>;

const decodeEncrypt = Schema.decodeUnknownOption(Schema.fromJsonString(EncryptSchema));

const decodeDecrypt = Schema.decodeUnknownOption(Schema.fromJsonString(DecryptSchema));

const decodeDescribe = Schema.decodeUnknownOption(Schema.fromJsonString(DescribeSchema));

const decodeSealed = Schema.decodeUnknownOption(SealedSchema);

const encodeSealed = Schema.encodeSync(SealedSchema);

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const targetPrefix = 'TrentService.';

const ivBytes = 12;

const tagBytes = 16;

const unread: Answer = refusal('SerializationException', 'The request is not one the fake KMS reads');

const aliasResource = ':alias/';

function refusal(type: string, message: string): Answer {
  return { status: 400, body: { __type: type, message } };
}

function stateRefusal(keyId: string, state: FakeKeyState, operation: FakeKmsOperation): Answering | undefined {
  const account = String(keyId.split(':')[4]);
  const refusals: Readonly<Record<FakeKeyState, Answering | undefined>> = {
    enabled: undefined,
    stalling: 'stalled',
    disabled: refusal('DisabledException', `${keyId} is disabled.`),
    pending_deletion: refusal('KMSInvalidStateException', `${keyId} is pending deletion.`),
    denied: refusal(
      'AccessDeniedException',
      `User: arn:aws:iam::${account}:user/runtime is not authorized to perform: kms:${operation} on resource: ${keyId} because no identity-based policy allows the kms:${operation} action`,
    ),
  };
  return refusals[state];
}

function writtenOf(context: Context): string {
  const names = Object.keys(context).toSorted((one, other) => one.localeCompare(other));
  return JSON.stringify(names.map((name) => [name, context[name]]));
}

function sealedUnder(seal: Readonly<Uint8Array>, content: Sealed): string {
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv('aes-256-gcm', seal, iv);
  const text = Buffer.concat([cipher.update(encodeSealed(content)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), text]).toString('base64');
}

function openedUnder(seal: Readonly<Uint8Array>, blob: string): Option.Option<Sealed> {
  const bytes = Buffer.from(blob, 'base64');
  try {
    const decipher = createDecipheriv('aes-256-gcm', seal, bytes.subarray(0, ivBytes));
    decipher.setAuthTag(bytes.subarray(ivBytes, ivBytes + tagBytes));
    const text = Buffer.concat([decipher.update(bytes.subarray(ivBytes + tagBytes)), decipher.final()]);
    return decodeSealed(text.toString());
  } catch {
    return Option.none();
  }
}

function openedFor(keyId: string, context: Context, { keyId: sealedBy, context: sealedWith, plaintext }: Sealed) {
  if (sealedBy !== keyId) {
    return refusal('IncorrectKeyException', 'The key in the request is not the key that encrypted the ciphertext');
  }
  return writtenOf(context) === writtenOf(sealedWith)
    ? { status: 200, body: { Plaintext: plaintext, KeyId: keyId, EncryptionAlgorithm: 'SYMMETRIC_DEFAULT' } }
    : refusal('InvalidCiphertextException', 'The encryption context is not the one the ciphertext was made with');
}

interface Kept {
  readonly seal: Readonly<Uint8Array>;
  readonly states: ReadonlyMap<string, FakeKeyState>;
  readonly errors: ReadonlyMap<string, FakeKmsError>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly noted: (call: FakeKmsCall) => void;
}

function errorOf({ type, status }: FakeKmsError): Answer {
  return { status, body: { __type: type, message: 'Rate exceeded' } };
}

function failedAs(kept: Kept, keyId: string): Answer | undefined {
  return Option.getOrUndefined(Option.map(Option.fromNullishOr(kept.errors.get(keyId)), errorOf));
}

function heard(kept: Kept, call: FakeKmsCall, answer: () => Answer): Answering {
  kept.noted(call);
  const state = kept.states.get(call.keyId);
  if (state === undefined) {
    return refusal('NotFoundException', `Key '${call.keyId}' does not exist`);
  }
  return failedAs(kept, call.keyId) ?? stateRefusal(call.keyId, state, call.operation) ?? answer();
}

function describingRefusal(keyArn: string, state: FakeKeyState): Answering | undefined {
  return state === 'disabled' || state === 'pending_deletion' ? undefined : stateRefusal(keyArn, state, 'DescribeKey');
}

function unknownToDescribe(keyId: string): Answer {
  return keyId.includes(aliasResource)
    ? refusal('NotFoundException', `Alias ${keyId} is not found.`)
    : refusal('NotFoundException', `Key '${keyId}' does not exist`);
}

function describedAs(keyId: string, kept: Kept): Answering {
  kept.noted({ operation: 'DescribeKey', keyId });
  const keyArn = kept.aliases.get(keyId) ?? keyId;
  const state = kept.states.get(keyArn);
  if (state === undefined) {
    return unknownToDescribe(keyId);
  }
  const keyMetadata = { KeyId: keyArn.slice(keyArn.lastIndexOf('/') + 1), Arn: keyArn };
  return (
    failedAs(kept, keyArn) ?? describingRefusal(keyArn, state) ?? { status: 200, body: { KeyMetadata: keyMetadata } }
  );
}

function encrypted(body: string, kept: Kept): Answering {
  return Option.match(decodeEncrypt(body), {
    onNone: () => unread,
    onSome: ({ KeyId, Plaintext, EncryptionContext }) =>
      heard(kept, { operation: 'Encrypt', keyId: KeyId, context: EncryptionContext }, () => ({
        status: 200,
        body: {
          CiphertextBlob: sealedUnder(kept.seal, { keyId: KeyId, context: EncryptionContext, plaintext: Plaintext }),
          KeyId,
          EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
        },
      })),
  });
}

function decrypted(body: string, kept: Kept): Answering {
  return Option.match(decodeDecrypt(body), {
    onNone: () => unread,
    onSome: ({ KeyId, CiphertextBlob, EncryptionContext }) =>
      heard(kept, { operation: 'Decrypt', keyId: KeyId, context: EncryptionContext }, () =>
        Option.match(openedUnder(kept.seal, CiphertextBlob), {
          onNone: () => refusal('InvalidCiphertextException', 'The ciphertext is not one this KMS made'),
          onSome: (sealed) => openedFor(KeyId, EncryptionContext, sealed),
        }),
      ),
  });
}

function described(body: string, kept: Kept): Answering {
  return Option.match(decodeDescribe(body), {
    onNone: () => unread,
    onSome: ({ KeyId }) => describedAs(KeyId, kept),
  });
}

function answerTo(operation: string, body: string, kept: Kept): Answering {
  switch (operation) {
    case 'Encrypt':
      return encrypted(body, kept);
    case 'Decrypt':
      return decrypted(body, kept);
    case 'DescribeKey':
      return described(body, kept);
    default:
      return refusal('UnknownOperationException', `The fake KMS does not answer ${operation}`);
  }
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  request.setEncoding('utf8');
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
  }
  return text;
}

async function respond(request: IncomingMessage, response: ServerResponse, kept: Kept): Promise<void> {
  const operation = String(request.headers['x-amz-target']).replace(targetPrefix, '');
  const answer = answerTo(operation, await bodyOf(request), kept);
  if (answer !== 'stalled') {
    response
      .writeHead(answer.status, { 'content-type': 'application/x-amz-json-1.1' })
      .end(JSON.stringify(answer.body));
  }
}

export async function serveFakeKms({ keys, aliases = {} }: FakeKmsOptions): Promise<FakeKms> {
  const states = new Map<string, FakeKeyState>(keys.map((key) => [key, 'enabled']));
  const errors = new Map<string, FakeKmsError>();
  const pointed = new Map<string, string>(Object.entries(aliases));
  const calls: FakeKmsCall[] = [];
  const kept: Kept = {
    seal: randomBytes(32),
    states,
    errors,
    aliases: pointed,
    noted: (call) => {
      calls.push(call);
    },
  };
  const server = createServer();
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    void respond(request, response, kept);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${String(decodeAddress(server.address()).port)}`,
    tell: (keyId, state) => {
      states.set(keyId, state);
      errors.delete(keyId);
    },
    failWith: (keyId, error) => {
      errors.set(keyId, error);
    },
    point: (aliasArn, keyArn) => {
      pointed.set(aliasArn, keyArn);
    },
    calls: () => [...calls],
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

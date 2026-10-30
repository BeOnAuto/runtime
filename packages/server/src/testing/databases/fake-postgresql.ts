import { once } from 'node:events';
import { createServer, Socket } from 'node:net';
import { TLSSocket } from 'node:tls';

import { Function, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import type { LoopbackCertificate } from './loopback-certificate.ts';

export interface FakePostgreSQL {
  readonly port: number;
  readonly askedForTls: () => number;
  readonly passwords: () => readonly string[];
}

interface Wire {
  readonly read: (size: number) => unknown;
  readonly readable: () => Promise<unknown>;
  readonly write: (bytes: string | Readonly<Uint8Array>) => void;
}

const sslRequestBytes = 8;

const askingForAPassword = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 3]);

const signedInAndReady = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]);

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function bytesFrom(wire: Wire, size: number): Promise<Buffer> {
  const chunk = wire.read(size);
  if (chunk instanceof Buffer) {
    return chunk;
  }
  await wire.readable();
  return bytesFrom(wire, size);
}

async function passwordOver(wire: Wire): Promise<string> {
  const startup = await bytesFrom(wire, 4);
  await bytesFrom(wire, startup.readInt32BE(0) - 4);
  wire.write(askingForAPassword);
  const header = await bytesFrom(wire, 5);
  const password = await bytesFrom(wire, header.readInt32BE(1) - 4);
  wire.write(signedInAndReady);
  return password.subarray(0, -1).toString();
}

export async function aFakePostgreSQL(certificate?: LoopbackCertificate): Promise<FakePostgreSQL> {
  const heard = { tlsRequests: 0, passwords: new Array<string>() };
  const accepted = new Set<Socket>();
  const served = async (wire: Wire, secured: (tls: LoopbackCertificate) => void): Promise<void> => {
    await bytesFrom(wire, sslRequestBytes);
    heard.tlsRequests += 1;
    if (certificate === undefined) {
      wire.write('N');
      return;
    }
    wire.write('S');
    secured(certificate);
    heard.passwords.push(await passwordOver(wire));
  };
  const server = createServer((...connections: readonly unknown[]) => {
    for (const socket of connections.filter((connection) => connection instanceof Socket)) {
      accepted.add(socket);
      const flowing = { stream: socket };
      const wire: Wire = {
        read: (size) => {
          const chunk: unknown = flowing.stream.read(size);
          return chunk;
        },
        readable: () => once(flowing.stream, 'readable'),
        write: (bytes) => {
          flowing.stream.write(bytes);
        },
      };
      served(wire, (tls) => {
        flowing.stream = new TLSSocket(socket, { isServer: true, ...tls });
        flowing.stream.on('error', Function.constVoid);
      }).catch(Function.constVoid);
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(async () => {
    for (const socket of accepted) {
      socket.destroy();
    }
    server.close();
    await once(server, 'close');
  });
  return {
    port: decodeAddress(server.address()).port,
    askedForTls: () => heard.tlsRequests,
    passwords: () => heard.passwords,
  };
}

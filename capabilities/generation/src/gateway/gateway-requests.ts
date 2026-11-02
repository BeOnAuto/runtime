import { Redacted } from 'effect';

import type { GenerationGateway, GenerationRequest, ReferenceContent } from './generation-gateway.ts';

const gatewayPaths = {
  image: '/images/generations',
  imageWithReferences: '/images/edits',
  audio: '/audio/speech',
} as const;

type Body = Readonly<Record<string, string | number>>;

function revealed(values: ReadonlyMap<string, Redacted.Redacted>): ReadonlyMap<string, string> {
  return new Map(
    [...values].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

function addressOf({ base_url: baseUrl, query_params: queryParams }: GenerationGateway, path: string): string {
  const address = new URL(`${baseUrl}${path}`);
  for (const [name, value] of revealed(queryParams)) {
    address.searchParams.set(name, value);
  }
  return address.href;
}

function headersOf({ api_key: apiKey, headers }: GenerationGateway): Headers {
  const sent = new Headers(Object.fromEntries(revealed(headers)));
  if (apiKey !== null) {
    sent.set('authorization', `Bearer ${Redacted.value(apiKey)}`);
  }
  return sent;
}

function given(fields: Readonly<Record<string, string | number | undefined>>): Body {
  const body: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      body[name] = value;
    }
  }
  return body;
}

function imageFields({ model, prompt, parameters }: GenerationRequest): Body {
  return given({
    model,
    prompt,
    n: 1,
    size: parameters.size,
    quality: parameters.quality,
    aspect_ratio: parameters.aspect,
  });
}

function audioFields({ model, prompt, parameters }: GenerationRequest): Body {
  return given({
    model,
    input: prompt,
    voice: parameters.voice,
    response_format: parameters.format,
    duration: parameters.duration,
  });
}

const extensions: ReadonlyMap<string, string> = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

function referenceFile({ mediaType, bytes }: ReferenceContent, index: number): File {
  return new File([bytes], `reference-${index + 1}.${extensions.get(mediaType) ?? 'bin'}`, {
    type: mediaType,
  });
}

function formOf(fields: Body, references: readonly ReferenceContent[]): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, String(value));
  }
  references.forEach((reference, index) => {
    form.append('image[]', referenceFile(reference, index));
  });
  return form;
}

function jsonRequest(gateway: GenerationGateway, path: string, body: Body, signal: Readonly<AbortSignal>): Request {
  const headers = headersOf(gateway);
  headers.set('content-type', 'application/json');
  return new Request(addressOf(gateway, path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'manual',
    signal,
  });
}

export function gatewayRequestOf(
  gateway: GenerationGateway,
  request: GenerationRequest,
  signal: Readonly<AbortSignal>,
): Request {
  if (request.kind === 'audio') {
    return jsonRequest(gateway, gatewayPaths.audio, audioFields(request), signal);
  }
  if (request.references.length === 0) {
    return jsonRequest(gateway, gatewayPaths.image, imageFields(request), signal);
  }
  return new Request(addressOf(gateway, gatewayPaths.imageWithReferences), {
    method: 'POST',
    headers: headersOf(gateway),
    body: formOf(imageFields(request), request.references),
    redirect: 'manual',
    signal,
  });
}

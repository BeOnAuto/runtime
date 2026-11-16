import {
  componentReferenceOf,
  type DiscoveryDocument,
  type DiscoveryMethod,
  type JsonObject,
} from './discovery-document.ts';
import type { Description } from './discovery-parameters.ts';

export interface UploadPlace {
  readonly path: string;
  readonly request: string;
  readonly accept: readonly string[] | undefined;
}

const uploadTypeName = 'uploadType';

const multipartUpload = 'multipart';

const metadataType = 'application/json';

export function uploadIdOf(methodId: string): string {
  return `${methodId}.upload`;
}

export function uploadPlaceOf({ id, mediaUpload, request }: DiscoveryMethod): UploadPlace {
  const simple = mediaUpload?.protocols?.simple;
  if (simple === undefined) {
    throw new Error(
      `The method ${id} of the Discovery document uploads no media in one request, which the upload kept sends`,
    );
  }
  if (simple.multipart !== true || request === undefined) {
    throw new Error(
      `The method ${id} of the Discovery document takes no metadata beside its media, which the upload kept sends first`,
    );
  }
  return { path: simple.path, request: request.$ref, accept: mediaUpload?.accept };
}

export function uploadTypeOf(discovery: DiscoveryDocument): Readonly<Record<string, JsonObject>> {
  const written = discovery.parameters?.[uploadTypeName];
  if (written === undefined) {
    throw new Error(`The Discovery document has no global parameter ${uploadTypeName}, which an upload sends`);
  }
  return { [uploadTypeName]: { ...written, required: true, enum: [multipartUpload] } };
}

export function uploadBodyOf({ request, accept }: UploadPlace): JsonObject {
  return {
    required: true,
    content: {
      'multipart/related': {
        schema: {
          type: 'array',
          prefixItems: [{ $ref: componentReferenceOf(request) }, {}],
          minItems: 2,
          items: false,
        },
        prefixEncoding: [{ contentType: metadataType }, accept === undefined ? {} : { contentType: accept.join(', ') }],
      },
    },
  };
}

export function describedOperations(
  descriptions: readonly Description[],
  operationIds: readonly string[],
): ReadonlyMap<string, string> {
  const unheld = descriptions
    .filter(({ operation }) => !operationIds.includes(operation))
    .map(({ operation }) => operation);
  if (unheld.length > 0) {
    throw new Error(`The manifest describes the operation ${unheld.join(', ')}, which the document does not hold`);
  }
  return new Map(descriptions.map(({ operation, says }) => [operation, says]));
}

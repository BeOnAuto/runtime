import { isJsonPointer } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const notAPointer = 'Expected a JSON Pointer into the key file, such as /private_key';

const PointerSchema = Schema.String.check(
  Schema.makeFilter((pointer: string) => (isJsonPointer(pointer) ? undefined : notAPointer)),
);

const KeyFileSchema = Schema.Struct({
  client_id: PointerSchema.annotate({
    description: "The JSON Pointer to the client's ID in the key file, which the assertion names as its issuer",
  }),
  private_key: PointerSchema.annotate({
    description: 'The JSON Pointer to the private key in the key file, in PEM, which signs the assertion',
  }),
}).annotate({
  description:
    "For jwt_bearer, where the two values sit in the key file the service gives, each as a JSON Pointer. Auto keeps the private key, sealed, and records the client's ID; it keeps nothing else of the file",
});

export const assertionFields = {
  subject: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        'For jwt_bearer, the account the token is asked for, such as a mailbox, each {name} in it a placeholder of the way or of the provider. Leave it out where the service account acts as itself: Auto then asks for a token for the service account, and the JWT names no subject',
    }),
  ),
  key_file: Schema.optionalKey(KeyFileSchema),
};

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { trackerAuthorizationServer } from '../testing/discovery-documents.ts';
import {
  aboutManifest,
  aboutSource,
  aboutTranslated,
  issuesSource,
  peopleSource,
  trackerOpenApiManifest,
  trackerOpenApiTranslated,
} from '../testing/openapi-documents.ts';
import { OpenApiTranslationSchema, type OpenApiTranslation } from './openapi-operations.ts';
import { curatedOpenApiOf } from './translate-openapi.ts';

const decodeTranslation = Schema.decodeUnknownSync(OpenApiTranslationSchema);

const server = trackerAuthorizationServer;

const sources = [peopleSource, issuesSource];

const oneOperationAlone = { left_out_parameters: [], single_strings: [] };

function translationWith(changes: Readonly<Record<string, unknown>>): OpenApiTranslation {
  return decodeTranslation({ ...trackerOpenApiManifest, ...changes });
}

function translatedWith(changes: Readonly<Record<string, unknown>>, documents: readonly unknown[] = sources) {
  return () => curatedOpenApiOf(documents, translationWith(changes), server);
}

function issuesServedAt(url: string) {
  return { ...issuesSource, servers: [{ url }] };
}

function issuesHolding(components: Readonly<Record<string, unknown>>) {
  return { ...issuesSource, components };
}

function leavingOut(operation: string, parameters: readonly string[]) {
  return translatedWith({ left_out_parameters: [{ operation, parameters, because: 'It is not wanted' }] });
}

function writingAsOneString(operation: string, at: string) {
  return translatedWith({ single_strings: [{ operation, at, because: 'It is one string' }] });
}

function scopesReadAt(...keys: readonly string[]) {
  return translatedWith({ scheme: { ...trackerOpenApiManifest.scheme, scopes_at: keys } });
}

describe('a curated document translated from the OpenAPI documents a vendor publishes', () => {
  it('keeps each operation named whole, but its extensions and its scheme, at its path with each value in its place, requiring the oauth2 scheme at its root and once for each scope it keeps, with the components it reaches', () => {
    expect(curatedOpenApiOf(sources, translationWith({}), server)).toEqual(trackerOpenApiTranslated);
  });

  it('says only that an operation answers where it keeps no answer, and names no server or component where its documents name none', () => {
    expect(curatedOpenApiOf([aboutSource], decodeTranslation(aboutManifest), server)).toEqual(aboutTranslated);
  });
});

describe('a translation of operations refused', () => {
  it('names no document, an operation no document holds, or one two documents hold', () => {
    expect(() => curatedOpenApiOf([], translationWith({}), server)).toThrow('The translation is made from no document');
    expect(translatedWith({ operations: ['person', 'nowhere'] })).toThrow(
      'The documents the translation is made from have no operation nowhere',
    );
    expect(translatedWith({}, [peopleSource, peopleSource, issuesSource])).toThrow(
      'The documents the translation is made from hold the operation person 2 times',
    );
  });

  it('is made from documents that name different servers or versions of OpenAPI', () => {
    expect(translatedWith({}, [peopleSource, issuesServedAt('https://api-eu.tracker.example.com/v2')])).toThrow(
      'The documents the translation is made from name the servers [{"url":"https://api.tracker.example.com/v2"}] or [{"url":"https://api-eu.tracker.example.com/v2"}], where the document made from them names one',
    );
    expect(translatedWith({}, [peopleSource, { ...issuesSource, openapi: '3.1.0' }])).toThrow(
      'The documents the translation is made from name the versions of OpenAPI 3.0.0 or 3.1.0, where the document made from them names one',
    );
  });

  it('keeps an operation that lists no scope but those it leaves out, or lists none where the translation reads them', () => {
    expect(translatedWith({ operations: ['person', 'people'], ...oneOperationAlone })).toThrow(
      'The operation people lists no scope under x-extensions x-granular-scopes that the translation keeps',
    );
    expect(scopesReadAt('x-extensions', 'x-macro-scopes')).toThrow(
      'The operation person lists no scope under x-extensions x-macro-scopes that the translation keeps',
    );
    expect(scopesReadAt('x-scopes', 'granular')).toThrow(
      'The operation person lists no scope under x-scopes granular that the translation keeps',
    );
  });
});

const expandedElsewhere = {
  openapi: '3.0.0',
  servers: issuesSource.servers,
  paths: {
    '/expanded': {
      get: {
        operationId: 'expanded',
        parameters: [{ $ref: '#/components/parameters/expand' }],
        'x-extensions': { 'x-granular-scopes': ['issue:read:expanded'] },
      },
    },
  },
  components: { parameters: { expand: { name: 'expand', in: 'query', schema: { type: 'string' } } } },
};

const { parameters, schemas, securitySchemes } = issuesSource.components;

describe('the components of a translation refused', () => {
  it('are a reference to a component the document of the operation does not hold, or one two documents hold each their own way', () => {
    const expanding = { operations: [...trackerOpenApiManifest.operations, 'expanded'] };

    expect(translatedWith({}, [peopleSource, issuesHolding({ parameters, securitySchemes })])).toThrow(
      'The operation issues refers to #/components/schemas/Expansion, which is no component its document holds',
    );
    expect(translatedWith({}, [peopleSource, issuesHolding({ schemas, securitySchemes })])).toThrow(
      'The operation issues refers to #/components/parameters/expand, which is no component its document holds',
    );
    expect(translatedWith(expanding, [peopleSource, issuesSource, expandedElsewhere])).toThrow(
      'The documents the translation is made from hold #/components/parameters/expand each its own way',
    );
  });
});

describe('a translation of parameters and schemas refused', () => {
  it('leaves out a parameter an operation does not have, or of an operation the document does not keep', () => {
    const aboutLeavingOut = {
      ...aboutManifest,
      left_out_parameters: [{ operation: 'about', parameters: ['fields'], because: 'It is not wanted' }],
    };

    expect(leavingOut('issue', ['include_fields', 'expand', 'fields'])).toThrow(
      'The operation issue has no parameter expand and fields, which the translation leaves out',
    );
    expect(leavingOut('issueDelete', ['issueId'])).toThrow(
      'The translation leaves out parameters of the operation issueDelete, which the document does not keep',
    );
    expect(translatedWith(aboutLeavingOut, [aboutSource])).toThrow(
      'The operation about has no parameter fields, which the translation leaves out',
    );
  });

  it('writes as one string a schema the body of a request does not hold, or of an operation the document does not keep', () => {
    expect(writingAsOneString('issueCreate', '/properties/reviewer')).toThrow(
      'The operation issueCreate has no /properties/reviewer under the JSON schema of its request body',
    );
    expect(writingAsOneString('issue', '/properties/assignee')).toThrow(
      'The operation issue has no /properties/assignee under the JSON schema of its request body',
    );
    expect(writingAsOneString('issueDelete', '/properties/assignee')).toThrow(
      'The translation writes a schema as one string in the operation issueDelete, which the document does not keep',
    );
    expect(writingAsOneString('issueCreate', 'properties/assignee')).toThrow(
      String.raw`Expected a string matching the RegExp ^(?:\/[^/]+)+$`,
    );
  });

  it('writes a value for a parameter no path it keeps holds', () => {
    expect(
      translatedWith({ path_values: [{ parameter: 'accountId', value: 'me', because: 'It is the account' }] }),
    ).toThrow('No path the document keeps holds {accountId}, which the translation writes as its value');
  });
});

const answeredWithAll = { 200: { description: 'The campaigns' } };

const campaignsSource = {
  openapi: '3.0.0',
  servers: issuesSource.servers,
  paths: {
    '/campaigns': {
      post: {
        operationId: 'campaigns',
        security: [{ ApiKey: [] }, { OAuth2: ['campaigns:read', 'campaigns:admin'] }],
        responses: answeredWithAll,
      },
      get: { operationId: 'campaign', security: [{ OAuth2: ['campaigns:read'] }], responses: answeredWithAll },
      delete: { operationId: 'uncampaign', responses: answeredWithAll },
    },
  },
};

const schemeOfTheCampaigns = {
  name: 'campaigns_oauth',
  leaving_out: [':admin'],
  because: 'Each operation requires the scheme of the vendor with the scopes it needs',
};

const fromTheVendorsScheme = { ...schemeOfTheCampaigns, scopes_from_scheme: 'OAuth2' };

function campaignsTranslatedWith(scheme: unknown, operations: readonly string[] = ['campaigns', 'campaign']) {
  return () =>
    curatedOpenApiOf(
      [campaignsSource],
      decodeTranslation({ ...aboutManifest, operations, scheme, keeps_responses: true }),
      server,
    );
}

describe('the scopes of a translation read from the requirement of a scheme of the vendor', () => {
  it('are those the operation requires of that scheme but those it leaves out, each a requirement of the scheme it writes', () => {
    expect(campaignsTranslatedWith(fromTheVendorsScheme)()).toMatchObject({
      security: [{ campaigns_oauth: [] }],
      paths: {
        '/campaigns': {
          post: { operationId: 'campaigns', security: [{ campaigns_oauth: ['campaigns:read'] }] },
          get: { operationId: 'campaign', security: [{ campaigns_oauth: ['campaigns:read'] }] },
        },
      },
      components: {
        securitySchemes: {
          campaigns_oauth: { flows: { authorizationCode: { scopes: { 'campaigns:read': 'campaigns:read' } } } },
        },
      },
    });
  });

  it('are refused for an operation that requires no scope of that scheme, and where the scheme names both places or neither', () => {
    expect(campaignsTranslatedWith(fromTheVendorsScheme, ['uncampaign'])).toThrow(
      'The operation uncampaign lists no scope in its requirement of the scheme OAuth2 that the translation keeps',
    );
    expect(campaignsTranslatedWith({ ...fromTheVendorsScheme, scopes_at: ['x-scopes'] })).toThrow('Expected never');
    expect(campaignsTranslatedWith(schemeOfTheCampaigns)).toThrow('Missing key');
  });
});

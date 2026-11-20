---
description: 'For a connection added without a provider, the events argument of add_connection tells Auto how the service sends webhooks when someone replies. This page says when to give it, shows its form and describes each key.'
---

<div v-pre>

# How a connection's service sends events

When a connection is added without a provider, the `events` argument of add_connection tells Auto how the service sends webhooks when someone replies to a request sent through the connection. Auto then registers its webhook URL, the address the service sends webhooks to, while a request waits there, and removes the registration when no request is waiting. Nobody copies an address or a secret, because Auto fills in both. On this page, a delivery is one webhook the service sends. These are the events a service sends to Auto, not [the playbook's own events](events.md).

A delivery from the service never answers a request by itself. It makes Auto read the replies now, through the function's own `replies`.

## When to give it

Give `events` only where the service's documentation gives all three:

- a call that registers an address;
- a call that removes that registration;
- a way to verify each delivery with a secret that the first call takes or returns: a signature made with the secret, a token signed with it, or the secret itself in a header.

Where it lacks one, or the address or the secret can only be set in the service's own settings, leave `events` out. The playbook still reads the replies on a timer.

## The form

```yaml
events:
  destinations:
    - type: webhook
      per: subscription
      topic: '{{ with.<the argument that names what one registration covers> }}'
      subscribe:
        tool: <the tool that registers an address>
        with:
          <its argument for the address>: '{{ webhook_url }}'
          <its argument for the secret>: '{{ secret }}'
          <its argument for what the registration covers>: '{{ topic }}'
        subscribed:
          id: /<pointer to the id in its answer>
      unsubscribe:
        tool: <the tool that removes it>
        with:
          <its argument for the id>: '{{ subscription.id }}'
      verify:
        scheme: hmac
        secret: subscription
        hash: sha256
        signed_payload: '{payload}'
        signature: $request.header.<the signature's header>
        encoding: hex
      filter:
        when:
          $request.header.<a header>: [<each value that means a reply>]
        conversation: $request.body#/<pointer to the conversation>
```

## A destination

`destinations` holds one destination. Its keys call one registration a subscription.

| Key             | Required | What it is                                                                        |
| --------------- | -------- | --------------------------------------------------------------------------------- |
| `type`          | Yes      | `webhook`                                                                         |
| `per`           | Yes      | `subscription`                                                                    |
| `topic`         | Yes      | What one registration covers; see [`topic`](#topic)                               |
| `subscribe`     | Yes      | The call that registers Auto's address; see [The calls](#the-calls)               |
| `unsubscribe`   | Yes      | The call that removes the registration                                            |
| `renew`         | No       | The call that extends a registration before it expires                            |
| `lease_seconds` | No       | The most seconds a registration lasts, where the documentation states it          |
| `verify`        | Yes      | How Auto verifies a delivery; see [`verify`](#verify)                             |
| `handshake`     | No       | How the service checks the address before it sends; see [`handshake`](#handshake) |
| `filter`        | Yes      | Which deliveries mean someone replied; see [`filter`](#filter)                    |

## `topic`

`topic` is a template that renders what one registration covers, such as one conversation or one project. Requests that render the same topic share one registration. It reads:

- `with`, the arguments of the tool that sent the request, as `{{ with.<argument> }}`;
- `sent.conversation` and `sent.id`, as the function's `deliver.sent` reads them.

Where one registration covers the whole account, write a text that is the same for every request.

## The calls

`subscribe`, `unsubscribe` and `renew` each take:

| Key    | Required | What it is                                                                                                                                                      |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool` | Yes      | A tool of this connection: one the server lists, or for an HTTP API an operation its document declares. Where the entry gives `allowed`, `allowed` names it too |
| `with` | No       | The tool's arguments, each a template                                                                                                                           |

`subscribe` also takes `subscribed`, and `renew` may take `renewed`. Each key is a JSON Pointer into what the call answers:

| Key                     | Required | Points to                                                                 |
| ----------------------- | -------- | ------------------------------------------------------------------------- |
| `subscribed.id`         | Yes      | The id of the registration                                                |
| `subscribed.expires_at` | No       | When the registration expires, as an RFC 3339 date-time                   |
| `subscribed.secret`     | No       | The secret, where the service makes it                                    |
| `renewed.expires_at`    | No       | When the registration expires after the renewal, as an RFC 3339 date-time |

The templates of `with` read:

| Name                                | In                     | What it is                                                                            |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `topic`                             | Every call             | What `topic` rendered                                                                 |
| `webhook_url`                       | `subscribe`            | The address Auto gives the service                                                    |
| `secret`                            | `subscribe`            | The secret Auto makes for the registration                                            |
| `subscription.id`                   | `unsubscribe`, `renew` | The id `subscribed.id` read                                                           |
| `subscription.expires_at`           | `unsubscribe`, `renew` | When the registration expires, where it is known                                      |
| `lease.seconds`, `lease.expires_at` | `subscribe`, `renew`   | `lease_seconds`, and when it ends as an RFC 3339 date-time; only with `lease_seconds` |

Write `{{ secret }}` in the `with` of `subscribe`, or point `subscribed.secret` at the secret the service makes. Give one of the two, never both.

Where the documentation says a registration expires:

- give `subscribed.expires_at` where the call answers when, as an RFC 3339 date-time, and `lease_seconds` otherwise;
- give `renew` where the service has a call that extends a registration. Without `renew`, Auto registers again before the registration expires.

`renew` is refused without `lease_seconds` or `subscribed.expires_at`.

## `verify`

| Key      | Required | What it is                                     |
| -------- | -------- | ---------------------------------------------- |
| `scheme` | Yes      | `hmac`, `standard-webhooks`, `bearer` or `jwt` |
| `secret` | Yes      | `subscription`                                 |

Each scheme takes keys of its own:

| Scheme              | Where the service                                          | Takes                                                                                                  |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `hmac`              | signs each delivery with the secret                        | `hash`, `signed_payload`, `signature` and `encoding`; `prefix`, `timestamp` and `id` where it has them |
| `standard-webhooks` | signs as the Standard Webhooks specification does          | Nothing more                                                                                           |
| `bearer`            | sends the secret itself in a header                        | `token`; `prefix` where it has one                                                                     |
| `jwt`               | sends a JSON Web Token signed with the secret, in a header | `token` and `alg`; `prefix` where it has one                                                           |

| Key               | What it is                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hash`            | `sha256`, `sha384` or `sha512`                                                                                                                                |
| `signed_payload`  | What the service signs: `{payload}`, the body as sent, once, joined to `{timestamp}` or `{id}` where the service signs them, as in `v0:{timestamp}:{payload}` |
| `signature`       | The header that holds the signature, as `$request.header.<name>`                                                                                              |
| `encoding`        | How the signature is written: `hex` or `base64`                                                                                                               |
| `prefix`          | What comes before the signature or the token in its header, such as `sha256=`                                                                                 |
| `timestamp`, `id` | The header or the field of the body that holds each. Required where `signed_payload` names it                                                                 |
| `token`           | The header that holds the secret or the token, as `$request.header.<name>`                                                                                    |
| `alg`             | `HS256`, `HS384` or `HS512`                                                                                                                                   |

## `handshake`

Give `handshake` only where the service checks the address before it sends.

| Key         | Required | What it is                                                                                                   |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `when`      | Yes      | The values that mark the checking request, written as `filter.when` is                                       |
| `challenge` | Yes      | Where that request holds the challenge                                                                       |
| `signed`    | Yes      | `true` where that request can be verified as a delivery is; `false` where it comes before any secret exists  |
| `response`  | No       | The fields of a JSON answer, each `challenge` or `hmac`. Left out, Auto answers the challenge alone, as text |

`hmac` answers the challenge signed with the secret, by the `hash` and `encoding` of `verify`. It is taken only where `scheme` is `hmac`.

## `filter`

| Key            | Required | What it is                                                                                                                                                                                                                                        |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `when`         | Yes      | What a delivery holds when someone replied: each header, query parameter or field with the values it may equal. Every one must match. A value is compared as text, so a field whose value is a number or `true` never matches                     |
| `conversation` | No       | Where a delivery names the conversation, as the function's delivery names it in `sent.conversation`. With it, Auto reads only the requests that wait in that conversation. Without it, Auto reads every request that waits through the connection |
| `subscription` | No       | Where a delivery names the registration's id. It does not narrow what Auto reads                                                                                                                                                                  |
| `automatic`    | No       | Where a delivery holds something only when an app, not a person, posted the message it is about. Auto then reads nothing                                                                                                                          |

## Where a delivery holds a value

A header or a field of a delivery is written as a runtime expression of OpenAPI:

| Written                    | Reads                                         |
| -------------------------- | --------------------------------------------- |
| `$request.header.<name>`   | A header                                      |
| `$request.query.<name>`    | A parameter of the query                      |
| `$request.body#/<pointer>` | A field of the JSON body, by its JSON Pointer |

`signature` and `token` are read from a header alone.

## What add_connection refuses

add_connection refuses `events` at the key that is wrong and says what it expects there. It refuses a value that looks like a secret or a key: write `{{ secret }}`, never a secret.

</div>

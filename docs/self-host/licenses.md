# Licenses

Auto Runtime counts the actions it runs: each run of a workflow or a function is one action, counted once by its run id however often it is asked again, retried or resumed. Nothing else is counted, neither a model call nor the compute a function takes. The count comes from the runtime's own ledger, and the runtime keeps it there.

A runtime runs 100 actions before it is registered. After them it needs a license: a key Studio gives the org that registers the runtime's installation. A licensed runtime asks the org's account at Auto to admit each new action, which charges one credit for it. Every org has a free allowance, so a key costs nothing.

## Register the installation in Studio

The 101st action of a runtime nobody registered is refused with `license_required`, and the refusal links the page of Studio that registers it:

```text
This runtime has run the 100 actions it may before it is registered. Register it at https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a, where an org gets its key for free, and activate it with that key
```

The link names the runtime's installation, its id in the ledger. Open it while signed in to Studio as an owner of the org whose account the runtime should use, and register the installation under a name. Studio shows the key once, `alk.<org>.<installation>.<secret>`. Keep it where you keep your other secrets; an owner can rotate it, which retires the old key, or revoke the installation, which stops it.

You can register an installation before its 100 actions run out, from Studio's Licenses page. A runtime whose ledger is new takes the installation of the first key it activates.

## Activate the key

Give the runtime its key in one of four ways. A key in the environment or the configuration file is activated each time the runtime starts and wins over one activated by the command or through the API.

- **The environment.** Set `AUTO_RUNTIME_LICENSE_KEY` to the key, in the `.env` the runtime reads or the environment of its container, and restart the runtime.
- **The configuration file.** Write a reference to the variable that holds the key under `license.key`, since the file never holds a secret itself:

  ```yaml
  license:
    key: ${ACME_LICENSE_KEY}
  ```

- **The command.** With Auto Runtime running on your computer, started by `npx @on.auto/runtime`, run:

  ```sh
  npx -y @on.auto/runtime license activate alk.<org>.<installation>.<secret>
  ```

  It asks the runtime running on this computer to activate the key, and says what the runtime is licensed to.

- **Studio, or any client of the API.** `POST /v1/orgs/{org}/license` with `{ "key": "<the key>" }`, or the MCP tool `activate_license`, activates the key for the whole runtime. It takes the permission to change the org, as adding a connection does.

A key activated by the command or through the API is kept in the runtime's secret store, as the credentials of connections are, so it stands after a restart.

The runtime activates a key by asking Auto's account service at `https://accounts.on.auto`, which answers an entitlement Auto signs. The runtime ships Auto's public key and checks every answer against it; no setting adds or replaces a key. The entitlement lasts seven days, and the runtime renews it as it starts and every day after. Every hour, and as it stops, the runtime counts its ledger again from the first event and reports its count of actions to the account, which compares it with what it charged.

The runtime reaches `accounts.on.auto` over HTTPS; allow it in your egress rules beside `studio.on.auto`.

## When a run is refused

Each refusal is a problem document with the status `409`, the reason `conflict` and one of these kinds, or with `503` and the kind `meter_unavailable`:

| Kind                | Means                                                                                                         | What to do                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `license_required`  | The runtime has run its 100 actions and holds no license                                                      | [Register the installation](#register-the-installation-in-studio) and [activate the key](#activate-the-key)               |
| `license_invalid`   | The key was rotated away or revoked, is for another installation, or its entitlement expired or is not Auto's | Activate a current key of this installation; its words link the installation's page in Studio                             |
| `credits_exhausted` | The org's account has no credit left for the action, or an offline installation has spent its allocation      | An owner adds credit in Studio, under Billing, or asks Auto for another allocation; the run starts when it is asked again |
| `metering_fault`    | The runtime found its ledger changed under its count                                                          | [Ask Auto for a repair](#faults-and-repairs)                                                                              |
| `meter_unavailable` | The runtime could not read its ledger, or reach the account service, to admit the run                         | Ask again shortly; check that the runtime reaches `accounts.on.auto`                                                      |

A run asked again under the run id of one that already started is never refused, and counts nothing more. Reading runs and events, editing definitions and exporting go on whatever the license says.

## Offline installations

An installation that never reaches Auto, behind an air gap or a network that lets nothing out, cannot ask its account to admit each action. For it, an operator of Auto issues an allocation: credits moved out of the org's account for that installation alone, which the runtime spends itself, signed by Auto like every answer the runtime takes. Ask for one through [Studio's support page](https://studio.on.auto/support), naming the installation.

Give the runtime its allocation, and the key of its installation, which signs its reports, in any of these ways. None of them needs Auto: the runtime checks the allocation against Auto's public key, which it ships, and keeps it in its ledger.

- **The environment.** Set `AUTO_RUNTIME_ALLOCATION` to the allocation's JSON, `{"payload":"…","signature":"…","kid":"…"}`, and `AUTO_RUNTIME_LICENSE_KEY` to the key.
- **The configuration file.** Write references to the variables that hold them:

  ```yaml
  license:
    key: ${ACME_LICENSE_KEY}
    allocation: ${ACME_ALLOCATION}
  ```

- **The command.** With Auto Runtime running on your computer, `npx -y @on.auto/runtime license allocation '<the allocation's JSON>'`.
- **The API.** `POST /v1/orgs/{org}/license/allocation` with `{ "allocation": { "payload": "…", "signature": "…", "kid": "…" } }`.

While an allocation stands, the runtime admits each new action against it and asks Auto nothing. It counts what it spent from its ledger, as it counts every action, and admits while fewer actions than the allocation's credits were counted since it took it; replicas of one ledger admit exactly that many between them. The allocation has seven days of grace from when it was last refreshed. Past that day the runtime refuses new runs as `license_invalid`, and once its credits are spent as `credits_exhausted`.

A runtime that does reach Auto now and then refreshes its allocation every day, which gives it seven more days of grace, and sends Auto a report of what it spent every hour. One that never does needs an owner to carry its reports to Studio:

1. Make the next report on the runtime: `npx -y @on.auto/runtime license report`, or `POST /v1/orgs/{org}/license/allocation/report`. It prints `{"report":{"allocation":…,"installation":…,"sequence":…,"spent":…,"at":…},"signature":…}`: all the runtime spent under the allocation so far, under the next number, signed with the key of its installation.
2. Upload it in Studio, on the installation's page under Licenses.

Each report counts everything spent, so a later report replaces an earlier one, and a lost report costs nothing. Auto freezes an allocation whose report counts fewer actions than one before it, or comes under a number it already took, as a ledger restored from an older copy does; reach Auto through support to have it looked at. When Auto closes the allocation, the runtime gives it up at its next refresh and asks its account to admit each action from then on.

## Faults and repairs

The runtime keeps its count as a checkpoint in its ledger, with the point and the id of the last event it counted. When an event it counted is gone, when another stands where it counted its last, or when it cannot read one, it records a fault and refuses every new run as `metering_fault`, through restarts, until Auto repairs it. Restoring an older backup of the ledger under a newer count does the same.

Reach Auto at [Studio's support page](https://studio.on.auto/support) with the installation's id. An operator issues a repair, which Auto signs for that installation alone; the runtime receives it when it next renews its license, at its start or within a day, counts its ledger again from the first event and goes on from that count. A faulted runtime still activates and renews its license, so it can receive its repair; a runtime nobody registered is registered first.

---
description: Connect your Slack account to Auto, use your messages, channels and threads in a playbook, and remove the connection when you no longer want it.
---

# Connect Slack

Connect your Slack account to Auto, so that the functions in your playbooks can read your messages, channels and threads, look up people, and send messages and add reactions as you. Your agent does the setup. You sign in to Slack and allow access.

## What you need

- Your agent connected to Auto and signed in as you, with permission to change your org. Follow the [quick start](../get-started/cloud.md) if you have not connected yet. An agent connected with an API key cannot add a connection.
- A Slack account in the workspace you want to connect. Auto reaches Slack at `slack.com`, and reads how to sign you in to Slack at `mcp.slack.com`, where Slack publishes it.
- If your workspace takes only the apps its owners approve, Slack asks you to request the app, and you allow access once a workspace owner or app manager approves it.

You connect as yourself, through the Slack Web API. The connection has your access to the workspace: it reads the channels, conversations and people you can see, and a message it sends is from you. The connection belongs to your org, so a function in a playbook it is for acts in Slack as you, whoever in your org runs it.

This page is about the `slack` provider, which acts as you, the person who connects. The `slack-bot` provider acts instead as the bot of a Slack app installed in your workspace, and connects with that app's bot token, as [the providers Auto ships](../self-host/connections.md#the-providers-auto-ships) lists. [Use your own Slack app](#use-your-own-slack-app) shows how to connect it.

## Add Slack

1. Ask your agent to connect Slack as you:

   ```text
   Connect my own Slack account to Auto, so that the functions in my
   "<playbook name>" playbook can read my Slack messages.
   ```

   Your agent may ask which playbook the connection is for. Name the playbooks that may use it, or say that every playbook of your org may. A connection that names no playbook is for every playbook of the org.

2. Your agent asks you to open a page of Studio, or gives you its link. The link works for 24 hours. On an Auto that signs people in, only you can use it, signed in as yourself.
3. Check what the page says you are connecting, and press Continue.
4. Slack asks you to sign in, if you are not signed in already, and shows the workspace you are connecting; you can switch to another there. Check that it is the workspace you mean, and allow access.
5. Slack sends you back to Studio, which finishes the connection and shows Slack as connected. Your agent sees it connected too.

If the link runs out before Slack is connected, ask your agent to reconnect it, for a new link.

### What you see when you allow access

The Slack app you allow depends on how your Auto is set up:

| How your Auto is set up                                                                                  | What you see                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whoever runs your Auto registered a Slack app of their own                                               | Slack asks you to allow their app, and then sends you back to Studio. Their app comes first, even where consent through Auto is on                                                                          |
| They registered none, and [consent through Auto](../self-host/connections.md#consent-through-auto) is on | Slack asks you to allow Auto, under Auto's name. It then sends you to the hosted Studio, `https://studio.on.auto`, where you sign in to Auto if you have not already, and on to the Studio you started from |
| Neither                                                                                                  | Your agent cannot add Slack, and says that Slack takes a client whoever runs Auto registers, which is not set up here. Ask whoever runs your Auto to set one up                                             |

## Use your own Slack app

Most people don't need this, and add Slack as [Add Slack](#add-slack) shows. Your own Slack app is for a workspace on Slack's free plan, or a company that wants playbooks to use an app it owns.

Auto's Slack app works only in workspaces on a paid Slack plan, as Slack requires of [apps that connect Slack to an automation platform](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements#automation-platform-apps). In a workspace on the free plan, Auto says "A paid Slack plan is required" and isn't added. You then have two choices:

- Upgrade the workspace in Slack, then connect again.
- Create a Slack app of your own, as below. It counts toward the free plan's limit on apps. [Slack's help](https://slack.com/help/articles/27204752526611-Feature-limitations-on-the-free-plan) says: "On the free version of Slack, you'll be limited to 10 third-party or custom app installations."

### How your own app differs from Auto's

Your company creates the app at Slack and owns it. Auto connects to it as Slack Bot, with the app's bot token, a code Slack gives the app when it is installed. A playbook can then do what [Use Slack in a playbook](#use-slack-in-a-playbook) lists, with these differences:

- Your app reads and posts only in the channels you add it to.
- Messages come from your app, under the name you give it.
- You can't talk to Auto in Slack through your app. That takes Auto's Slack app.
- Slack doesn't tell Auto when someone replies to a request. Auto checks instead: every few seconds at first, and every five minutes at most, as [Answering by reply](../reference/interaction-format.md#answering-by-reply) sets out.
- Slack's limit on reading a conversation, 15 messages a read and one read a minute, doesn't apply to your app.

### Create your app in Slack

You need a Slack account in the workspace, and no code. Where your workspace takes only the apps its owners approve, a workspace owner or app manager approves your app once.

1. Open [api.slack.com/apps](https://api.slack.com/apps), signed in to Slack, and select **Create New App**.
2. Select **Pick features**, then **Continue**. Enter an **App Name**, the name people see in Slack, and select your **Workspace**. Select **Continue** until you reach **Review your app**, then select **Create**. If Slack says the app can't do anything until you add scopes, select **Create Anyway**.
3. In the menu on the left, select **OAuth & Permissions** and scroll down to **Scopes**. Under **Bot Token Scopes**, select **Add an OAuth Scope** and add each scope below. A scope is a permission the app asks for.
   - `channels:read`, `channels:history`, `users:read`, `chat:write`, `reactions:read` and `reactions:write`
   - `groups:read` and `groups:history`, for private channels
4. Scroll back to the top of **OAuth & Permissions**. Select **Install to Workspace**, then **Allow**. Where your workspace takes only approved apps, Slack asks you to request the app instead, and you install it once it is approved.
5. Under **OAuth Tokens**, copy the token that starts with `xoxb-`. This is the app's bot token. Keep it private: anyone who has it can act as your app.
6. In Slack, add your app to each channel your playbooks use. In the channel, send `/invite @` followed by your app's name.

### Connect your app to Auto

Someone with permission to change your org in Auto does these steps.

1. Ask your agent:

   ```text
   Connect my own Slack app to Auto as Slack Bot, for my "<playbook name>" playbook.
   ```

   Or, in Studio, open **Settings**, then **Connections**, select **Slack Bot** under **Add a connection**, and select **Connect**.

2. Open the page of Studio your agent gives you. If you started in Studio, it opens by itself. Paste the bot token under **Slack bot token**, and select **Approve**. Studio then shows the connection as connected.

Auto keeps the token in its secret store, and your agent never sees it. Give a function in your playbook the Slack Bot tools as [Use Slack in a playbook](#use-slack-in-a-playbook) shows. To stop using your app, remove the Slack Bot connection as [In Auto](#in-auto) shows, and remove the app at Slack as [At Slack](#at-slack) shows. For help, see [Get help](#get-help).

## Use Slack in a playbook

Once Slack is connected, ask your agent to give a function in your playbook the Slack tools it needs, as [Give a function tools](../guides/tools.md) shows. Say what you want done, in your own words:

| A playbook can                                                                                           | You might ask                                                                             |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Read the history of a channel, a direct message or a group direct message, and a thread                  | "Summarize yesterday's thread in the support channel about the delayed order."            |
| Look up people and channels                                                                              | "Find the channel about the trade show, and the job titles of the people who post there." |
| Send a message, and change one it sent                                                                   | "Post the weekly summary in the marketing channel."                                       |
| Add a reaction, and see the reactions on a message                                                       | "Add a check mark to each question in the support channel we answered today."             |
| Ask someone to approve in a channel. Auto marks their reply when it is taken, and says so when it is not | "Ask the campaign owner in the marketing channel to approve the brief."                   |

The `slack` row of [the providers Auto ships](../self-host/connections.md#the-providers-auto-ships) is the full list of what a function may do with Slack.

Searching Slack messages is not available yet.

[Slack limits](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps) how an app distributed outside the Slack Marketplace reads a conversation, and Auto's Slack app is distributed outside it. Through it, a function gets at most 15 messages of the history of a channel, or of a thread, in each call, however many it asks for, and reads more by calling again with the cursor Slack returned. Slack also allows such an app one of these reads a minute in each workspace. It answers a read past that limit with how long to wait, and the call fails as rate limited where the wait is longer than Auto waits for one call. An app your workspace builds for itself has no such limit, and whoever runs your Auto can register one, as [The providers Auto ships that take consent](../self-host/connections.md#the-providers-auto-ships-that-take-consent) sets out.

What Slack answers each call, the messages a function reads among it, is kept in the playbook's history, for anyone who may read the playbook, as [the configuration reference](../self-host/configuration.md#fields-of-an-entry) says of every tool server. Someone who may read the playbook can then read messages from your private channels and direct messages that Slack would not show them. If you would rather the history keep only the size of each answer, ask your agent to add Slack that way.

## Remove Slack

You can remove Slack in Auto or at Slack.

### In Auto

In Studio, find Slack among your org's connections, press Remove and confirm. Or ask your agent:

```text
Remove my Slack connection from Auto.
```

Auto then forgets the connection's tokens, and no playbook may use the connection any more. What Slack publishes for signing in names no address that revokes a token, so Auto does not ask Slack to revoke them, and your authorization of the app stands at Slack until you revoke it there, as below.

### At Slack

To revoke your own authorization, in Slack on your desktop:

1. Click your workspace name in the sidebar.
2. Select Tools & settings, then Manage apps.
3. Select Installed apps, find the app you allowed and click App details.
4. Open the Configuration tab. Under Authorizations, find Authorized members, click See all and Revoke.

To remove the app for the whole workspace instead, choose Remove app on the same Configuration tab. Where app approval is on, only workspace owners and app managers can remove apps. Slack's help on [removing apps](https://slack.com/help/articles/360003125231-Remove-apps-and-custom-integrations-from-your-workspace) has the steps.

Either way, Slack then refuses the connection's tokens, and the functions that use the connection can no longer reach Slack. To use Slack again, ask your agent to reconnect it, or press Sign in again on its row where Studio shows it as Broken, and allow access again. If you no longer want it, remove it in Auto too, as above, so that Auto forgets its tokens.

### What remains

Removing Slack does not remove what Slack answered before. The playbook's history keeps what earlier calls answered, for anyone who may read the playbook, for as long as whoever runs your Auto keeps it. Where you allowed Auto's own app, Auto's consent service keeps a line for each time you allowed access, each renewal and each removal, naming you, Slack and the Studio you went back to, and no token. It also keeps a line for each notice Slack sends it that the app was removed or its tokens revoked, naming the workspace, the Slack members and the time Slack gives.

## Get help

- For help with Slack in Auto, use Auto's [support page](https://on.auto/contact-us).
- Read Auto's [privacy policy](https://on.auto/privacy) and [terms](https://on.auto/terms).

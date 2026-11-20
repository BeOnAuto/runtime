---
description: Connect Slack to Auto, use messages, channels and threads in a playbook, and remove the connection when you no longer want it.
---

# Connect Slack

Connect Slack to Auto, so that the functions in your playbooks can read messages, channels and threads, look up people, and send messages and add reactions. Your agent does the setup, and you allow access at Slack.

On Auto Cloud, Slack connects through Auto's own Slack app, and a playbook reads and posts as @Auto, as [On Auto Cloud](#on-auto-cloud) shows. On an Auto that you or your company runs, a playbook uses a Slack app of your own, as [Use your own Slack app](#use-your-own-slack-app) shows.

## On Auto Cloud

Slack connects through Auto's own Slack app. A function in your playbook reads public channels, private channels @Auto has been added to and @Auto's direct messages with people, and sends messages and adds reactions as @Auto. It doesn't read your own direct messages or channels @Auto isn't in, and its messages aren't sent under your name. Only an admin or an editor of your organization can connect Slack or remove it.

To connect it, ask your agent to connect Slack, or open **Settings**, then **Connections** in Studio, select **Slack** under **Add a connection**, and select **Connect**. Allow access at Slack. In a private channel a playbook uses, send `/invite @Auto`.

People of your organization can then write to @Auto in Slack. @Auto recognizes a member by the email address they use in Slack, when it's the one they use in Auto, and asks anyone else to connect their Auto account. Auto reads that address only to compare it.

### A Slack connection made before

A Slack connection made as yourself, before Slack connected through @Auto, stops working: playbooks can't use it. Its row in Studio's Connections shows **Needs attention** and says "Slack now connects through @Auto. Connect again to keep your playbooks working."

1. Select **Connect again** on its row. The person who made the connection can, and so can an admin or an editor of your organization.
2. Allow access at Slack.

Auto removes the old connection and adds the new one under the same name, for the same playbooks, so your playbooks keep their Slack steps. As soon as you select **Connect again**, Auto forgets the old connection's tokens and stops renewing them, so it can never use them again. Nothing needs doing at Slack.

## Use your own Slack app

On Auto Cloud most people don't need this, and connect Slack as [On Auto Cloud](#on-auto-cloud) shows. Your own Slack app is for an Auto that you or your company runs, a workspace on Slack's free plan, or a company that wants playbooks to use an app it owns.

Auto's Slack app works only in workspaces on a paid Slack plan, as Slack requires of [apps that connect Slack to an automation platform](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements#automation-platform-apps). In a workspace on the free plan, Auto says "A paid Slack plan is required" and isn't added. You then have two choices:

- Upgrade the workspace in Slack, then connect again.
- Create a Slack app of your own, as below. It counts toward the free plan's limit on apps. [Slack's help](https://slack.com/help/articles/27204752526611-Feature-limitations-on-the-free-plan) says: "On the free version of Slack, you'll be limited to 10 third-party or custom app installations."

### How your own app differs from Auto's

Your company creates the app at Slack and owns it. Auto connects to it as Slack Bot, with the app's bot token, a code Slack gives the app when it is installed. A playbook can then do what [Use Slack in a playbook](#use-slack-in-a-playbook) lists, with these differences:

- Your app reads and posts only in the channels you add it to.
- Messages come from your app, under its name. An app made from the link is named Auto.
- You can't talk to Auto in Slack through your app. That takes Auto's Slack app.
- Slack doesn't tell Auto when someone replies to a request. Auto checks instead: every few seconds at first, and every five minutes at most, as [Answering by reply](../reference/interaction-format.md#answering-by-reply) sets out.
- Slack's limit on reading a conversation, 15 messages a read and one read a minute, doesn't apply to your app.

### Create your app and connect it

One person does these steps: someone with permission to change your organization in Auto, who also has a Slack account in the workspace. No code is needed. Where your workspace takes only the apps its owners approve, a workspace owner or app manager approves your app once.

1. Ask your agent:

   ```text
   Connect my own Slack app to Auto as Slack Bot, for my "<playbook name>" playbook.
   ```

   Or, in Studio, open **Settings**, then **Connections**, select **Slack Bot** under **Add a connection**, and select **Connect**.

2. Open the page of Studio your agent gives you. If you started in Studio, it opens by itself.
3. On that page, select **Get a key at api.slack.com**, signed in to Slack. Slack opens with a new app filled in, named Auto: choose your workspace and select **Create**. If you made your app before, skip this step: open it at [api.slack.com/apps](https://api.slack.com/apps), select **OAuth & Permissions** and go on from step 5.
4. In the app's settings, select **OAuth & Permissions**, then **Install to Workspace** and **Allow**. Where your workspace takes only approved apps, Slack asks you to request the app instead, and you install it once it is approved.
5. Under **OAuth Tokens**, copy the token that starts with `xoxb-`. This is the app's bot token. Keep it private: anyone who has it can act as your app.
6. Back on the page of Studio, paste the bot token under **Slack bot token**, and select **Approve**. Auto checks the token with Slack before it saves it, and Studio then shows the connection as connected. If Slack refuses the token, the page says so under the field, and nothing is saved.
7. In Slack, add your app to each channel your playbooks use. In the channel, send `/invite @` followed by your app's name.

Auto keeps the token in its secret store, and your agent never sees it. Give a function in your playbook the Slack Bot tools as [Use Slack in a playbook](#use-slack-in-a-playbook) shows. To stop using your app, remove the Slack Bot connection as [In Auto](#in-auto) shows, and remove the app at Slack as [At Slack](#at-slack) shows. For help, see [Get help](#get-help).

## Use Slack in a playbook

Once Slack is connected, ask your agent to give a function in your playbook the Slack tools it needs, as [Give a function tools](../guides/tools.md) shows. Say what you want done, in your own words:

| A playbook can                                                                                           | You might ask                                                                             |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Read the history of a channel and a thread                                                               | "Summarize yesterday's thread in the support channel about the delayed order."            |
| Look up people and channels                                                                              | "Find the channel about the trade show, and the job titles of the people who post there." |
| Send a message, and change one it sent                                                                   | "Post the weekly summary in the marketing channel."                                       |
| Add a reaction, and see the reactions on a message                                                       | "Add a check mark to each question in the support channel we answered today."             |
| Ask someone to approve in a channel. Auto marks their reply when it is taken, and says so when it is not | "Ask the campaign owner in the marketing channel to approve the brief."                   |

A request in Slack is answered by a reply in the thread of its message. When it asks a channel and your agent didn't name who answers, anyone who replies in that thread can answer it. To have one person answer, ask your agent to name them, and replies from others are then not taken. See [Answering by reply](../reference/interaction-format.md#answering-by-reply).

The `slack-bot` row of [the providers Auto ships](../self-host/connections.md#the-providers-auto-ships) is the full list of what a function may do with Slack, through @Auto or your own app.

Searching Slack messages is not available yet.

[Slack limits](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps) how an app distributed outside the Slack Marketplace reads a conversation, and Auto's Slack app is distributed outside it. Through it, a function gets at most 15 messages of the history of a channel, or of a thread, in each call, however many it asks for, and reads more by calling again with the cursor Slack returned. Slack also allows such an app one of these reads a minute in each workspace. It answers a read past that limit with how long to wait, and the call fails as rate limited where the wait is longer than Auto waits for one call. An app your workspace builds for itself has no such limit, as [How your own app differs from Auto's](#how-your-own-app-differs-from-auto-s) says.

What Slack answers each call, the messages a function reads among it, is kept in the playbook's history, for anyone who may read the playbook, as [the configuration reference](../self-host/configuration.md#fields-of-an-entry) says of every tool server. Someone who may read the playbook can then read messages from private channels that Slack would not show them. If you would rather the history keep only the size of each answer, ask your agent to add Slack that way.

## Remove Slack

You can remove Slack in Auto or at Slack.

### In Auto

In Studio, find Slack among your org's connections, press Remove and confirm. Or ask your agent:

```text
Remove my Slack connection from Auto.
```

Auto then ends the connection, and no playbook may use it any more. The app stays in your Slack workspace, @Auto or your own, until someone removes it there, as below.

### At Slack

To remove the app from the whole workspace, in Slack on your desktop:

1. Click your workspace name in the sidebar.
2. Select Tools & settings, then Manage apps.
3. Select Installed apps, find the app and click App details.
4. Open the Configuration tab and choose Remove app.

Where app approval is on, only workspace owners and app managers can remove apps. Slack's help on [removing apps](https://slack.com/help/articles/360003125231-Remove-apps-and-custom-integrations-from-your-workspace) has the steps.

Slack then refuses the app's tokens, and the functions that use a connection of it can no longer reach Slack. To use Slack again, add the app again and ask your agent to reconnect the connection. If you no longer want it, remove it in Auto too, as above.

### What remains

Removing Slack does not remove what Slack answered before. The playbook's history keeps what earlier calls answered, for anyone who may read the playbook, for as long as whoever runs your Auto keeps it. Auto keeps a line for each notice Slack sends that Auto's app was removed or its tokens revoked, naming the workspace, the Slack members and the time Slack gives.

## Get help

- For help with Slack in Auto, use Auto's [support page](https://on.auto/contact-us).
- Read Auto's [privacy policy](https://on.auto/privacy) and [terms](https://on.auto/terms).

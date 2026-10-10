---
title: "Privacy policy"
description: "How the hosted Undercroft service collects, uses, stores, shares and deletes your data, including data it reads from Gmail and Google Drive."
updated: 2026-10-10
---

This policy covers the hosted Undercroft service at [undercroft.lowbit.link](https://undercroft.lowbit.link) and this blog. The service is operated by multnelis ("we", "us"). You can reach us at [contact@multnelis.org](mailto:contact@multnelis.org).

Undercroft is also open-source software that anyone can install on their own servers. A copy you or your organisation runs yourselves is not operated by us, and this policy does not cover it.

## Who uses the service

Undercroft is a data platform for organisations. Each organisation is a separate workspace (a "tenant"). Its administrators invite members and decide which sources the workspace reads: for example Gmail, Google Drive, Xero or HubSpot. Sign-in is by invitation only.

## What we collect

**Your account.** When you sign in we receive your email address. If you sign in with Google we also receive your name and profile picture, which Google shares through its basic sign-in permissions. We keep a record of the workspaces you belong to and your role in each.

**Data from Google, when an administrator connects it.** An administrator of a workspace may connect a Gmail mailbox or a Google Drive account. Google shows them a consent screen listing what we ask for, and nothing is read until they approve it.

- **Gmail (read-only).** We read the messages in the labels the administrator chooses, and only those labels. For each message we keep the sender, recipients, subject, date and message identifiers, the message body, and attachments of the file types the administrator chooses.
- **Google Drive (read-only).** We read the files in the folders the administrator chooses in Google's file picker, and the text inside those files. Scanned documents and images are converted to text by software running on our own servers.
- **The connected account.** We record which Google account gave consent, its email address and Google's account identifier, so that a later reconnection stays tied to the same account.

We never send, modify, label or delete email, and we never create, modify or delete files in Google Drive.

**Data from other sources** an administrator connects, such as Xero or HubSpot, is read the same way: read-only, and limited to what the administrator chooses.

**Technical data.** Our servers keep request logs and traces, which may include your IP address, browser user agent, the page or action requested, the time and the outcome. We use them to keep the service running and secure, and to investigate errors.

The blog sets no cookies and runs no analytics or advertising scripts. The service uses only the cookies it needs to keep you signed in.

## How we use it

We use your data only to provide the service to the workspace it belongs to:

- to keep a copy of what each connected source holds in that workspace's own data store, so the workspace can build models and reports on it;
- to extract and index the text of messages and documents, so the workspace's members can search it;
- to show that workspace's members its data, models, reports and run history;
- to email administrators about the workspace, for example a failed sync or an access grant about to expire;
- to keep the service secure, to prevent abuse, and to meet legal obligations.

We do not sell your data. We do not use it for advertising, and we do not build profiles of you.

## Optional features that use other providers

Two features send content to an outside provider. Both are off until the operator configures them, and the second also needs an administrator of the workspace to act.

- **The assistant.** A chat assistant inside the service answers questions about the workspace's data using a language model provided by Anthropic. When a member asks it a question, the question and the data the assistant reads to answer it, which may include email or document text, are sent to Anthropic to produce the answer. A second check, provided by TypeSafe, receives only the member's own words, never the data, to confirm the member asked for any change the assistant would make.
- **Document classification.** When an administrator publishes a list of document kinds for their workspace, the text of each document, which may include email and file text, is sent to TypeSafe to decide which kind it is.

These providers receive content only to return that result to the workspace. We do not use Google user data, and do not allow these providers to use it, to develop, improve or train generalised artificial intelligence or machine learning models.

## Google user data and Limited Use

Undercroft's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

In particular:

- we use Google user data only to provide and improve the features described above, which the workspace's administrator chose to use;
- we transfer it to others only as needed to provide those features, as described above, to comply with the law, or as part of a merger or acquisition with notice to you;
- we do not use or transfer it for advertising, and we do not sell it;
- no person at multnelis reads it unless you ask us to in writing (for example, to investigate a support request), it is necessary for security purposes such as investigating abuse, it is required by law, or it has been aggregated and anonymised for running the service.

## Who else can see your data

- **Members of your workspace**, according to the role an administrator gives them. Members of other workspaces cannot see it.
- **The providers above**, only when their feature is used.
- **Our email provider**, which receives the addresses and the text of the emails we send you, such as sign-in codes and invitations.
- **Authorities**, if the law requires us to disclose data.

## How we protect it

- All traffic to the service is encrypted with HTTPS.
- Access tokens from Google and other sources are encrypted before they are stored, with a key held only by the background service that reads the sources. The web application itself cannot decrypt them.
- Each workspace's data is kept separate from every other workspace's, and every request is checked against the member's role in that workspace.
- The reporting part of the service cannot read the raw copies of email and documents. They are reachable only through models the workspace itself writes.

## How long we keep it, and how to delete it

- **Disconnecting a source** removes our access straight away: we revoke the access token with Google and delete our stored copy of it. If we cannot reach Google to revoke it, the service tells the administrator so they can revoke it themselves.
- **Data already read** stays in the workspace's data store while the workspace exists, because it is the workspace's record of what each source held. An administrator can ask us to delete it, or to delete the whole workspace, by writing to [contact@multnelis.org](mailto:contact@multnelis.org). We delete it within 30 days of the request.
- **Your account** can be deleted the same way.

You can also remove Undercroft's access to your Google account at any time from your [Google Account permissions page](https://myaccount.google.com/permissions).

## Your rights

You can ask us for a copy of the personal data we hold about you, to correct it, or to delete it, by writing to [contact@multnelis.org](mailto:contact@multnelis.org). If your data was brought into the service by your organisation's workspace, we may ask that organisation's administrator to confirm the request.

## Children

The service is for organisations and is not directed at children. We do not knowingly collect data from anyone under 16.

## Changes to this policy

When this policy changes we update the date at the top of this page. If a change affects how we use Google user data, we will tell workspace administrators before it takes effect.

## Contact

Questions about this policy: [contact@multnelis.org](mailto:contact@multnelis.org).

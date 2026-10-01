# Document kinds

Every readable document of a customer -- a file, a mail attachment, a mail's body -- is
classified into exactly one **kind** from that customer's own **catalogue**: `invoice`,
`contract`, `kyc_form`, `bank_statement`, `other` and so on. A classifier does it in the
background; nobody writes a rule or a keyword list. This page covers reading and changing the
catalogue, and reading the answers.

Reach for it when a person asks what kinds of documents they have, asks to find documents of a
kind ("the KYC forms", "every invoice we were mailed"), or wants a kind added, renamed or
removed.

## The catalogue

- `documentKinds.list` (any member) answers with:
  - `kinds`: the catalogue's DRAFT. Each kind has its `description` (the one sentence the
    classifier reads), its `origin` (`initialised`, `generic` or `admin`) and its
    `sampleShare`, the share of the sample it was seen in when the catalogue was initialised.
  - `available`: generic kinds the customer does not have yet, to add from.
  - `published`: the version the classifier is using, or `null` when nothing is published and
    so nothing is classified.
  - `unpublishedChanges`: whether the draft differs from that version.
  - `readableDocuments`: how many documents a publish would send to the classifier.
- `documentKinds.initialise` (admin) draws a first catalogue for a customer that has none. It
  starts a run and answers with its `runId`; follow it with `runs.get`. It samples about 450
  texts, and keeps every generic kind seen in at least 1% of the sample, plus `other`. Nothing
  is published. It is refused with `CONFLICT` when a catalogue already exists.
- `documentKinds.add`, `documentKinds.update` and `documentKinds.remove` (admin) edit the
  draft. A generic kind needs only its name; a kind of the customer's own also needs a
  description that says what sets it apart from the others. `other` cannot be removed. Edits
  cost nothing until they are published.
- `documentKinds.publish` (admin) makes the draft the version the classifier uses, and **sends
  every readable document to the classifier again**, billed to the platform. Before you call
  it, tell the person how many documents it will send (`readableDocuments` from
  `documentKinds.list`) and wait for their yes to that number. A publish whose draft is
  unchanged makes no new version and answers `changed: false`.

Classifying runs every half hour, at most 500 documents per source per run. `runs.list` shows
those runs with the kind `semantic`; a first classification, or one after a publish, takes
hours to days depending on how many documents there are.

The web UI has the same catalogue on the Lake division's **Document kinds** page.

## Reading the answers

An admin reads them with `lake.query`, from the view `document_kinds`, one row per live
document that has been answered:

| Column               | What it says                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`             | The source the document came from, such as `drive` or `gmail.3fa9c1d2e0ab`.                                                                                           |
| `document_id`        | The document, as `documents` names it. A mail's body is `<messageId>:body`; a HubSpot note's, call's or task's text is `<entity>:<id>:body`, such as `notes:51:body`. |
| `kind`, `confidence` | The classifier's answer and how sure it was, 0 to 1, whatever the confidence.                                                                                         |
| `accepted_kind`      | The kind at 0.90 or above under the CURRENT catalogue, else NULL. Count with this when only confirmed answers may count.                                              |
| `last_accepted_kind` | The kind at 0.90 or above under whichever catalogue gave the answer. Use this for a list or dashboard that must not go blank while a new catalogue is asked.          |
| `current`            | `true` when the answer was given under the current catalogue. `false` means it is an old answer, still waiting to be asked again.                                     |
| `version`            | The catalogue version that gave the answer.                                                                                                                           |
| `status`, `reason`   | `classified`, `too-short` (under 60 characters, never sent), `invalid-response` or `provider-error`, with why.                                                        |

What the answers do not say:

- **A kind below 0.90 is a guess.** Never report `kind` as what a document is unless it is also
  the accepted kind; say the classifier was unsure.
- **A document missing from the view has not been classified yet.** It is not `other`, and it
  is not "none". Say how many are still waiting.
- **An answer with `current = false` belongs to an earlier catalogue.** Show it, and say it is
  from version N.

How many documents of each kind, confirmed under the current catalogue:

```postgresql
SELECT accepted_kind, count(*) AS documents
FROM document_kinds
WHERE accepted_kind IS NOT NULL
GROUP BY accepted_kind
ORDER BY documents DESC
```

The mail a kind arrived in. An attachment's `documents.metadata` carries its `messageId`, and
the message's headers are a record of the same source. One message read from two connected
mailboxes is two records, so fold them by the `Message-ID` header:

```postgresql
WITH attached AS (
  SELECT k.source, d.metadata ->> 'messageId' AS message_id, max(k.confidence) AS confidence
  FROM document_kinds k
  JOIN documents d
    ON d.source = k.source AND d.document_id = k.document_id AND d.deleted_at IS NULL
  WHERE k.source LIKE 'gmail%' AND k.last_accepted_kind = 'kyc_form'
  GROUP BY 1, 2
)
SELECT DISTINCT ON (r.payload -> 'headers' ->> 'Message-ID')
  r.payload -> 'headers' ->> 'Date' AS sent,
  r.payload -> 'headers' ->> 'From' AS sender,
  r.payload -> 'headers' ->> 'Subject' AS subject,
  a.confidence
FROM attached a
JOIN records r
  ON r.source = a.source AND r.entity = 'messages'
 AND r.source_record_id = a.message_id AND r.deleted_at IS NULL
ORDER BY r.payload -> 'headers' ->> 'Message-ID', a.confidence DESC
LIMIT 20
```

A query over `document_text` reads every document's text and can be cut by the server's time
limit. Filter on `document_kinds` first, as above, and join the text last.

For a table that reports and dashboards can read, build a model: the `undercroft-model-builder`
skill shows how a model reads the kinds.

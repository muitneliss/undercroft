-- The assistant's transcripts: what a reader asked, and what was proposed or done.
--
-- One thread per (reader, customer), so switching customers switches the conversation the way
-- switching customers switches every other division. Turns are rows rather than one array on
-- the thread, because a turn is appended far more often than a transcript is read, and an
-- ordinal column makes the order a stored fact instead of a property of a JSON array nobody
-- can index into.
--
-- WHY THE SERVER KEEPS THIS AT ALL, rather than letting the browser hold the conversation. Two
-- reasons, and the second is the load-bearing one. A reader gets their history back across a
-- reload -- and the endpoint rebuilds the prompt from THIS table rather than from the array the
-- browser posted, so a tampered transcript cannot put words in the reader's mouth and talk the
-- model into proposing something they never asked for. The browser sends one message; the rest
-- comes from here.
--
-- WHY A TOOL'S OUTPUT IS NOT IN IT. This is the one rule in this file a later reader is most
-- likely to relax, so it is written down twice: once here, and once as a CHECK.
--
-- The line is BULK versus CONVERSATION, and it is worth being exact about why, because the
-- obvious reading -- "nothing a person typed may be stored" -- is not the rule and would forbid
-- keeping the answer the reader asked for.
--
-- What protects a transcript is reachability. These two tables are granted to `undercroft_app`
-- alone, and no dbt or BI role has USAGE on `app` at all (040), so a conversation is strictly
-- LESS reachable than `raw.document_text`, which ADR 0024 grants to `undercroft_dbt` outright.
-- A transcript therefore cannot reach a dashboard or a customer-authored model by any path.
--
-- So the question is not whether a row could hold a name; it is whether the thing earns its
-- place. The reader's question and the assistant's answer do: they ARE the conversation, the
-- reader expects them back after a reload, and a sentence is not a corpus. A tool's RESULT does
-- not: it can be a whole document or several hundred rows, the reader already saw it live, and
-- the next turn needs the gist rather than the payload. Keeping it would make `app` a second
-- copy of the lake -- reachable from every control-plane handler rather than from the one column
-- scope 180 drew -- and that is the thing worth refusing.
--
-- So `parts` holds what the reader said, what the assistant answered, which tool was proposed,
-- the arguments it was proposed with, and whether the reader struck it -- and in place of each
-- result, a DIGEST: a one-line summary the tool itself declared safe (a row count, a status, an
-- id), or nothing at all when it declared none. Nothing is guessed to fill the gap: an absent
-- summary renders as absent, because an invented one would read exactly like a real one. Rule 2.
--
-- The live conversation is unaffected -- results stream to the reader in full, and the model
-- sees them in full for the rest of that conversation. It is only what SURVIVES the turn that is
-- reduced. `services/assistant/transcript.ts` is the one place that decides, and
-- `transcript.test.ts` pins it from both sides.

CREATE TABLE IF NOT EXISTS app.assistant_thread (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    -- The `app_user`, not the Better Auth user: `app.app_user` is the authority for what a
    -- person may do, and `auth_user` only proves who they are (060_auth.sql).
    user_id    uuid        NOT NULL REFERENCES app.app_user(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- One open thread per reader per customer. A reader who wants a clean page gets the same
    -- thread cleared rather than a second one, so "which conversation am I in?" is never a
    -- question the interleaf has to answer.
    UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.assistant_turn (
    thread_id  uuid        NOT NULL REFERENCES app.assistant_thread(id) ON DELETE CASCADE,
    -- The AI SDK's own message id. It is the key rather than a surrogate so that re-saving a
    -- transcript is idempotent: the same exchange written twice updates one row instead of
    -- appending a duplicate the reader would see twice.
    message_id text        NOT NULL CHECK (length(message_id) BETWEEN 1 AND 128),
    ordinal    integer     NOT NULL,
    role       text        NOT NULL CHECK (role IN ('user', 'assistant')),
    -- `UIMessage.parts`, digested per the docstring above. jsonb rather than a column per part
    -- kind, because the part vocabulary is the SDK's and grows with it; a new part kind must
    -- not be a migration.
    parts      jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, message_id),

    -- The check that makes the rule above mechanical rather than a habit.
    --
    -- A tool part carries its result under `output`. Nothing in `parts` may have that key, at
    -- any depth, so a handler that forgets to digest gets a constraint violation in the gate
    -- rather than a customer's contract in `app` and no symptom at all. `jsonb_path_exists`
    -- with `$.**` walks every node, which is what makes this cover a shape the SDK has not
    -- invented yet -- the case a hand-written list of part kinds would miss.
    --
    -- `errorText` is held to the same rule. A Postgres error embeds the offending value
    -- ("(name)=(...)"), so a refusal's text is as much a leak as a result is; the digest keeps
    -- the failure's SHAPE and drops its words.
    CONSTRAINT assistant_turn_no_payloads CHECK (
        NOT jsonb_path_exists(parts, '$.**.output')
        AND NOT jsonb_path_exists(parts, '$.**.errorText')
    )
);

-- Read in ordinal order, always, and only ever for one thread.
CREATE INDEX IF NOT EXISTS assistant_turn_thread_idx ON app.assistant_turn (thread_id, ordinal);

-- -- grants -------------------------------------------------------------------------------
-- The control plane owns both. 040's `GRANT ... ON ALL TABLES IN SCHEMA app` was expanded
-- against the tables that existed when it ran and the ledger means it never runs again, so a
-- table added later has NO grants at all and the symptom is "permission denied for table" at
-- runtime with the whole suite green. Hence the grant here, in the file that creates the table
-- (`privileges.md`, and 060_auth.sql for the precedent).
GRANT SELECT, INSERT, UPDATE, DELETE ON app.assistant_thread, app.assistant_turn
    TO undercroft_app;

-- Nothing for `undercroft_worker`: it neither reads nor writes a conversation. Nothing for any
-- dbt or BI role either -- they have no USAGE on `app` at all (040), which is the layer that
-- keeps a transcript off a dashboard even if the digest rule above were ever weakened. Stated
-- rather than omitted, so that adding a grant here means contradicting a sentence.

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).

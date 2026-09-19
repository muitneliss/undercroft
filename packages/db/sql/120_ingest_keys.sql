-- Ingest keys are managed from the product, and the worker records when one was last used.
--
-- The rows have existed since 020 and were only ever written by hand. The control plane now
-- mints, lists and revokes them (it holds every privilege on `app` already), and the worker
-- -- which reads a key by digest to admit a caller -- may write ONE column back: when the key
-- was last used. A column-level grant, so the worker cannot revoke, relabel or rescope a key;
-- admitting callers is its business, managing their keys is not.

GRANT UPDATE (last_used_at) ON app.ingest_key TO undercroft_worker;

-- raw.sync_cursor.watermark may be NULL: a list read WHOLE that held nothing to stamp. ADR 0082.
--
-- A cursor used to be written only when a read carried a stamp, because the watermark is what
-- the next read sends and a read with no stamp has nothing to send. That left a list that holds
-- no records -- a Xero organisation with no purchase orders or no prepayments -- with no row at
-- all, so nothing recorded that it had been read whole, when, or what that cost, and a card that
-- asks "when was every list last re-synced" answered "never" for as long as the list stayed
-- empty. Found on production after v1.48.0.
--
-- NULL is that fact: read whole, nothing stamped, nothing to send. The worker reads it as a
-- cursor to read whole from again, exactly as it treated a missing row; what changes is that
-- `whole_read_at` and `whole_read_requests` now have a row to live on.

ALTER TABLE raw.sync_cursor ALTER COLUMN watermark DROP NOT NULL;

-- NO NEW GRANT: the worker's and the app's grants (220, 380) cover the column already.

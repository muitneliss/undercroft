-- A row may name nobody. ADR 0120.
--
-- The audit log now records a bearer credential refused at the door (`auth.tokenRefused`), and
-- some of those name no one: a token this server never issued, or one too mangled to read. Every
-- row before this file named an address in `actor`, and the column said so with NOT NULL. For
-- these rows there is no address to name, and a placeholder -- an empty string, the token's id,
-- "unknown" -- would sit in the "who" column reading as somebody (CLAUDE.md, rule 2). NULL is
-- the honest value, and the readers already print NULL as missing.
--
-- Only the constraint changes. No grant moves: the control plane keeps INSERT and SELECT on the
-- table and still has no UPDATE, DELETE or TRUNCATE (510_audit_log_read.sql), so the log stays
-- append-only.

ALTER TABLE ops.audit_log ALTER COLUMN actor DROP NOT NULL;

-- app.model_context goes: a model no longer carries a business context. ADR 0112, which
-- supersedes ADR 0105.
--
-- WHY A DROP AND NOT A DELETED 460. `460_model_context.sql` stays exactly as it was applied.
-- The ledger keys on a file's name (packages/db/src/migrate.ts), so a database that already ran
-- 460 would never notice the file had gone and would keep the table; a numbered migration is a
-- change, and a change is undone by a later one (ADR 0036). A fresh database therefore creates
-- the table at 460 and drops it here, which is two statements and loses nothing.
--
-- NOTHING IS LOST. A row was an approval a person wrote by hand, and none was ever written:
-- every model in production read `incomplete`, so the table is empty wherever it exists.
--
-- NO GRANT TO REVOKE. Dropping the table drops `undercroft_app`'s grant on it with it, and no
-- other role was ever granted anything here.

DROP TABLE IF EXISTS app.model_context;

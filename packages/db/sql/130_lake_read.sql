-- The raw lake is browsable from the product: an admin pages through what actually landed.
--
-- 040 granted the control plane SELECT on raw.records "so the UI previews a record" and
-- withheld raw.documents, because nothing read the catalogue then. The Lake division now
-- prints both: counts and freshness per source and entity for every member, and the rows
-- themselves for an admin. The control plane reads the catalogue row -- content type, byte
-- length, when it was observed -- and never the bytes, which stay in the object store.
--
-- SELECT only. The control plane projects nothing into raw; the worker is the one writer.
-- The BI role is untouched: `raw` stays outside every dashboard's reach, as 040 says.

GRANT SELECT ON raw.documents TO undercroft_app;

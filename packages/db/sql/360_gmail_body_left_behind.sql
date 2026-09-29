-- List every held Gmail message's body as left behind, so the next harvest lands it. ADR 0080.
--
-- Until this release a harvest landed a message's headers and chosen attachments and never its
-- body. Now the body lands as a document of its own (`<messageId>:body`), but a message is read
-- only when it is new or when its mark lists something it left behind that a run would now land
-- (`planReads`, ADR 0076). Every message already held says it left nothing behind, so without
-- this every body in every mailbox already harvested would stay out of the lake for good while
-- each run reported success -- the shape of loss ADR 0076 exists to prevent.
--
-- So each mark with a recorded list gains one entry for its body, in the shape the list already
-- holds: `{documentId, mimeType, extension, declaredBytes}`, no name a person wrote (`pii.md`).
-- `planReads` treats a body entry as wanted whatever the file-type choice, reads the message
-- once more, and looks only at what the list names -- so an attachment already landed is not
-- fetched again. When the body lands it leaves the list, and the message is not read again.
-- `declaredBytes` is '0' because the size is not known until the read; the read records the
-- real one if the body is over the ceiling.
--
-- A mark whose list is NULL is left alone: "the harvest did not say" is already read in full,
-- body included. A number in a file on purpose, as `320_xero_reread.sql` argues: it must happen
-- exactly once, at the deploy that brings the reader that lands bodies. It costs one paced
-- `messages.get` per held message -- a mailbox of ~16,000 at 334 ms is about ninety minutes, once.

UPDATE raw.records
   SET documents_left_behind = documents_left_behind || jsonb_build_array(jsonb_build_object(
         'documentId', source_record_id || ':body',
         'mimeType', 'text/plain',
         'extension', NULL,
         'declaredBytes', '0'))
 WHERE (source = 'gmail' OR source LIKE 'gmail.%')
   AND entity = 'messages'
   AND jsonb_typeof(documents_left_behind) = 'array'
   AND NOT documents_left_behind @> jsonb_build_array(
         jsonb_build_object('documentId', source_record_id || ':body'));

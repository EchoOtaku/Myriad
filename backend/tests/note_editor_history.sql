-- Run with: psql -X -v ON_ERROR_STOP=1 -d <disposable database> -f backend/tests/note_editor_history.sql
-- Everything, including the isolated schema, is rolled back.
BEGIN;
CREATE SCHEMA note_editor_history_test;
SET LOCAL search_path = note_editor_history_test;
CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE phantasi_note_docs (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
 content_md TEXT NOT NULL DEFAULT '', topic TEXT, image TEXT, published_at TIMESTAMPTZ,
 revision BIGINT NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
\if :{?with_feature}
\ir ../migrations/note_editor.sql
\endif
INSERT INTO users(id) VALUES (1), (2);
INSERT INTO phantasi_note_docs(id, user_id, content_md) VALUES (1, 1, 'original'), (2, 2, 'other');
DO $$
DECLARE i INTEGER;
BEGIN
 ASSERT (SELECT note_editor_view = 'visual' FROM users WHERE id = 1), 'new users default to rich text';
 UPDATE users SET note_editor_view = 'write' WHERE id = 1;
 ASSERT (SELECT note_editor_view = 'visual' FROM users WHERE id = 2), 'preference is user scoped';
 FOR i IN 1..12 LOOP
  UPDATE phantasi_note_docs SET content_md = 'edit-' || i, revision = revision + 1, last_edited_by = 1 WHERE id = 1;
 END LOOP;
 ASSERT (SELECT count(*) = 10 FROM phantasi_note_history WHERE doc_id = 1), 'retain ten previous versions';
 ASSERT (SELECT min(revision) = 3 AND max(revision) = 12 FROM phantasi_note_history WHERE doc_id = 1), 'discard oldest first';
 ASSERT (SELECT count(*) = 0 FROM phantasi_note_history WHERE doc_id = 2), 'history is document scoped';
 UPDATE phantasi_note_docs SET revision = revision + 1 WHERE id = 1;
 ASSERT (SELECT max(revision) = 12 FROM phantasi_note_history WHERE doc_id = 1), 'skip unchanged content';
 UPDATE phantasi_note_docs SET content_md = (SELECT snapshot->>'content_md' FROM phantasi_note_history WHERE doc_id = 1 AND revision = 5), revision = revision + 1, last_edited_by = 2 WHERE id = 1;
 ASSERT (SELECT content_md = 'edit-4' FROM phantasi_note_docs WHERE id = 1), 'restore historical content';
 ASSERT (SELECT snapshot->>'content_md' = 'edit-12' FROM phantasi_note_history WHERE doc_id = 1 AND revision = 14), 'preserve pre-restore content';
 ASSERT (SELECT actor_id = 1 FROM phantasi_note_history WHERE doc_id = 1 AND revision = 14), 'preserve actual previous editor';
 DELETE FROM phantasi_note_docs WHERE id = 1;
 ASSERT (SELECT count(*) = 0 FROM phantasi_note_history WHERE doc_id = 1), 'delete history with document';
END $$;
ROLLBACK;

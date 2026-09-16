ALTER TABLE users ADD COLUMN IF NOT EXISTS note_editor_view VARCHAR NOT NULL DEFAULT 'visual';
ALTER TABLE phantasi_note_docs ADD COLUMN IF NOT EXISTS last_edited_by INTEGER;
CREATE TABLE IF NOT EXISTS phantasi_note_history (
    doc_id INTEGER NOT NULL REFERENCES phantasi_note_docs(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL,
    actor_id INTEGER,
    snapshot JSONB NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (doc_id, revision)
);
-- Runs under the document row lock and in the same transaction as every write,
-- including scheduled publishing and legacy note endpoints.
CREATE OR REPLACE FUNCTION phantasi_capture_note_history() RETURNS trigger AS $$
BEGIN
    IF ROW(OLD.title, OLD.content_md, OLD.topic, OLD.image, OLD.published_at)
       IS DISTINCT FROM ROW(NEW.title, NEW.content_md, NEW.topic, NEW.image, NEW.published_at) THEN
        INSERT INTO phantasi_note_history (doc_id, revision, actor_id, snapshot, saved_at)
        VALUES (OLD.id, OLD.revision, OLD.last_edited_by,
            jsonb_build_object('title', OLD.title, 'content_md', OLD.content_md,
                'topic', OLD.topic, 'image', OLD.image,
                'published_at', (EXTRACT(EPOCH FROM OLD.published_at) * 1000)::bigint),
            OLD.updated_at)
        ON CONFLICT (doc_id, revision) DO NOTHING;
        DELETE FROM phantasi_note_history WHERE doc_id = OLD.id AND revision IN (
            SELECT revision FROM phantasi_note_history WHERE doc_id = OLD.id
            ORDER BY revision DESC OFFSET 10
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER phantasi_note_history_capture
    BEFORE UPDATE ON phantasi_note_docs
    FOR EACH ROW EXECUTE FUNCTION phantasi_capture_note_history();

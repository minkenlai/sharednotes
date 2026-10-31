# Future Features & Edge Cases

This document details future architectural expansions, storage limits, and design considerations for SharedNotes.

---

## 1. Photos & File Attachments

### Storage Limits & Constraints
- **Cloudflare D1 (SQLite)**:
  - 1 MB maximum statement/query size.
  - 500 MB free storage limit (10 GB on paid).
  - SQLite BLOBs are not suitable for media files at the edge due to query memory overhead and row size limits.
- **Solution: Cloudflare R2 Object Storage**:
  - Native integration with Cloudflare Workers via R2 bindings.
  - 10 GB free storage per month with zero egress charges.
  - High performance file streaming for images, documents, and audio.

### Recommended Architecture
1. **D1 Table (`attachments`)**:
   ```sql
   CREATE TABLE IF NOT EXISTS attachments (
     id TEXT PRIMARY KEY,
     note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
     filename TEXT NOT NULL,
     content_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     r2_key TEXT NOT NULL,
     uploaded_by TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
   ```
2. **Endpoints**:
   - `POST /notes/:id/attachments`: Upload attachment (multipart or binary stream).
   - `GET /notes/:id/attachments/:attachment_id`: Serve/stream attachment with appropriate `Content-Type`.
   - `DELETE /notes/:id/attachments/:attachment_id`: Delete attachment from R2 and D1.

---

## 2. Dynamic Content-Type Support

### Concept
Allow notes to store structured JSON, code, or plaintext in addition to Markdown.

### Schema Addition
```sql
ALTER TABLE notes ADD COLUMN content_type TEXT NOT NULL DEFAULT 'text/markdown';
```

### Supported Types
- `text/markdown` (default)
- `text/plain`
- `application/json` (allows agents to persist structured state or key-value data)
- `text/csv` / `text/html` / `text/x-code`

---

## 3. Audit Logging

### Purpose
Track who took what action, providing accountability between users and automated agents.

### Schema (`audit_logs`)
```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  note_id TEXT,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL, -- create, update, archive, unarchive, soft_delete, restore, hard_delete
  details TEXT,         -- JSON payload with relevant metadata (e.g. changed fields)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_note ON audit_logs(note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor, created_at DESC);
```

---

## 4. Historical Versioning & Revisions

### Concept
Track revisions to prevent accidental data loss, see agent vs human modifications, and allow rolling back changes.

### Schema (`note_revisions`)
```sql
CREATE TABLE IF NOT EXISTS note_revisions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/markdown',
  edited_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_note_ver ON note_revisions(note_id, version_number DESC);
```

### Design Considerations
- **Retention / Pruning**: Cap revisions to the last 10–20 edits per note to prevent SQLite database bloat.
- **Rollback API**: `POST /notes/:id/revisions/:version/revert` to restore a previous revision cleanly.

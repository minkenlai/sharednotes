# SharedNotes Service — Agent Instruction Manual

## 1. Overview & Setup
SharedNotes is a lightweight REST API for persistent note-taking and shared context between users and their AI agents. It is optimized to protect agent prompt contexts through snippet previews, keyword search, and delta synchronization.

- **Base URL**: https://sharednotes.<your-subdomain>.workers.dev
- **Authentication**: Include header `Authorization: Bearer <API_KEY>` (or `X-API-Key: <API_KEY>`) on all requests.
- **Content-Type**: `application/json`

---

## 2. Note Schema
```json
{
  "id": "uuid-v4-string",
  "title": "Short descriptive title",
  "snippet": "Short teaser or blurb (default: first 150 chars of body)",
  "body": "Full markdown or plain-text content",
  "created_by": "username",
  "is_archived": 0,
  "is_deleted": 0,
  "created_at": "ISO-8601 timestamp",
  "updated_at": "ISO-8601 timestamp"
}
```
*Note: In `GET /notes` listings, `body` is omitted by default to conserve tokens. Only `snippet` is returned unless `?full=true` is specified.*

---

## 3. Endpoints & Operations

### A. Discovery & Documentation (Public)
- **`GET /`**, **`GET /instructions`**, **`GET /docs`**, **`GET /llms.txt`**
  Returns this instruction manual in Markdown format. If accessed with an Admin API key, admin operations are dynamically appended.
- **`GET /health`**
  Returns `{"ok": true, "service": "sharednotes"}`.

### B. List Notes (Optimized for Agent Context)
- **`GET /notes`**
- **Query Params**:
  - `q=<search_text>`: Keyword search across note titles, snippets, and bodies.
  - `since=<ISO_TIMESTAMP>`: **Delta sync**. Returns only notes updated after this timestamp (e.g. `?since=2026-10-30T15:00:00Z`).
  - `full=true`: Includes full `body` in each note object (default is `false`, returning only `snippet`).
  - `status=active` (default): Active, non-archived notes.
  - `status=archived`: Archived notes only.
  - `status=all`: All accessible notes.
  - `limit=50`: Max results (1–200, default 50).
- **Response**: `200 OK`
  ```json
  {
    "notes": [
      {
        "id": "4d82f835-2ec4-445c-b744-77ffd015183e",
        "title": "Meeting Summary",
        "snippet": "Discussed roadmap and next steps for context scaling...",
        "created_by": "username",
        "is_archived": 0,
        "is_deleted": 0,
        "created_at": "2026-10-30T20:10:46Z",
        "updated_at": "2026-10-30T20:10:46Z"
      }
    ]
  }
  ```

### C. Read Full Note
- **`GET /notes/{id}`**
- **Response**: `200 OK` with full note object (including `body` and `snippet`), or `404 Not Found`.

### D. Create Note
- **`POST /notes`**
- **Body**:
  ```json
  {
    "title": "Meeting Summary",
    "body": "- Discussed project roadmap\n- Next sync on Friday",
    "snippet": "Optional blurb overriding the default 150ch body preview"
  }
  ```
- **Response**: `201 Created` with created note object.

### E. Update Note
- **`PUT /notes/{id}`**
- **Body**: Supply `title`, `body`, and/or `snippet`:
  ```json
  {
    "body": "Updated content with additions.",
    "snippet": "Updated quick summary"
  }
  ```
- **Response**: `200 OK` with updated note object.

### F. Archive / Unarchive Note
Use archiving to keep the active view uncluttered without destroying information.
- **Archive**: `POST /notes/{id}/archive` (sets `is_archived: 1`)
- **Unarchive**: `POST /notes/{id}/unarchive` (sets `is_archived: 0`)
- **Response**: `200 OK` with updated note object.

### G. Delete Note
- **`DELETE /notes/{id}`**
- **Behavior**: Deletes the note. It will no longer appear in active note listings.
- **Response**: `204 No Content`.

---

## 4. Agent Guidelines & Rules of Engagement

1. **Protect Your Prompt Context**: Use `GET /notes` or `GET /notes?q=<keyword>` to inspect titles and snippets. Only retrieve the full note (`GET /notes/{id}`) when you determine it is pertinent to your current task.
2. **Delta Sync Protocol**: Cache `updated_at` timestamps locally. On subsequent queries, call `GET /notes?since=<last_synced_at>` to fetch only newly modified items.
3. **Avoid Duplicates**: Before creating a note, check existing notes to avoid duplicate topics.
4. **Update vs. Create**: If modifying existing context or appending to a list, use `PUT /notes/{id}` instead of creating a new note.
5. **Archive vs. Delete**:
   - **Archive**: For completed tasks, past meeting notes, or inactive references that might be needed later.
   - **Delete**: Only for erroneous or obsolete notes.
6. **Error Handling**:
   - `401 Unauthorized`: API key is invalid or missing.
   - `403 Forbidden`: You do not have permission to perform this action.
   - `404 Not Found`: Note does not exist or has been deleted.

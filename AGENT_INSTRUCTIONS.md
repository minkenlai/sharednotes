# SharedNotes Service — Agent Instruction Manual

## 1. Overview & Setup
SharedNotes is a lightweight REST API for persistent note-taking and shared context between users and their AI agents.

- **Base URL**: `https://sharednotes.<your-subdomain>.workers.dev`
- **Authentication**: Include header `Authorization: Bearer <API_KEY>` (or `X-API-Key: <API_KEY>`) on all requests.
- **Content-Type**: `application/json`

---

## 2. Note Schema
```json
{
  "id": "uuid-v4-string",
  "title": "Short descriptive title",
  "body": "Markdown or plain-text content",
  "created_by": "username",
  "is_archived": 0,
  "is_deleted": 0,
  "created_at": "ISO-8601 timestamp",
  "updated_at": "ISO-8601 timestamp"
}
```
*Note: `id`, `created_by`, `created_at`, and `updated_at` are managed automatically by the service.*

---

## 3. Endpoints & Operations

### A. List Notes
- **`GET /notes`**
- **Query Params**:
  - `status=active` (default): Active, non-archived, non-deleted notes.
  - `status=archived`: Archived notes only.
  - `status=all`: All accessible notes.
  - `limit=50`: Max results (1–200, default 50).
- **Response**: `200 OK`
  ```json
  { "notes": [ { "id": "...", "title": "...", ... } ] }
  ```

### B. Read Note
- **`GET /notes/{id}`**
- **Response**: `200 OK` with full note object, or `404 Not Found`.

### C. Create Note
- **`POST /notes`**
- **Body**:
  ```json
  {
    "title": "Meeting Summary",
    "body": "- Discussed project roadmap\n- Next sync on Friday"
  }
  ```
- **Response**: `201 Created` with created note object.

### D. Update Note
- **`PUT /notes/{id}`**
- **Body**: Supply `title`, `body`, or both:
  ```json
  {
    "body": "Updated content with additions."
  }
  ```
- **Response**: `200 OK` with updated note object.

### E. Archive / Unarchive Note
Use archiving to keep the active view uncluttered without destroying information.
- **Archive**: `POST /notes/{id}/archive` (sets `is_archived: 1`)
- **Unarchive**: `POST /notes/{id/unarchive` (sets `is_archived: 0`)
- **Response**: `200 OK` with updated note object.

### F. Delete Note
- **`DELETE /notes/{id}`**
- **Behavior**: Soft-deletes the note (`is_deleted: 1`). Note becomes invisible to regular users.
- **Response**: `204 No Content`.

---

## 4. Agent Guidelines & Rules of Engagement

1. **Avoid Duplicates**: Before creating a note, call `GET /notes` to check if a relevant note already exists.
2. **Update vs. Create**: If information evolves (e.g. todo list, status update), update existing note (`PUT /notes/{id}`) rather than creating duplicate entries.
3. **Archive vs. Delete**:
   - **Archive**: For completed tasks, past meeting notes, or inactive references that might be needed later.
   - **Delete**: Only for erroneous or obsolete notes.
4. **Format**: Store note bodies in standard Markdown for readability.
5. **Error Handling**:
   - `401 Unauthorized`: API key is missing or invalid. Alert user to verify credentials.
   - `403 Forbidden`: Action requires admin privileges (e.g., viewing or restoring deleted notes).
   - `404 Not Found`: Note ID does not exist or has been deleted.

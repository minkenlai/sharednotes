-- Migration 0002: Add snippet column to notes table
ALTER TABLE notes ADD COLUMN snippet TEXT NOT NULL DEFAULT '';

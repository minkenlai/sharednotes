-- Migration 0003: Add content_type column to notes table
ALTER TABLE notes ADD COLUMN content_type TEXT NOT NULL DEFAULT 'text/markdown';

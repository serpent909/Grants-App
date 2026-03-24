-- Document management and interactive checklists
-- Run after existing storage tables are in place

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  notes TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS application_checklist_items (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  required BOOLEAN NOT NULL DEFAULT false,
  checked BOOLEAN NOT NULL DEFAULT false,
  checked_at TIMESTAMPTZ,
  UNIQUE(grant_id, item_index)
);

CREATE INDEX IF NOT EXISTS idx_checklist_grant
  ON application_checklist_items(grant_id);

CREATE TABLE IF NOT EXISTS checklist_documents (
  id TEXT PRIMARY KEY,
  checklist_item_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(checklist_item_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_cd_checklist
  ON checklist_documents(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_cd_document
  ON checklist_documents(document_id);

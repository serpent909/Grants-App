-- 007: Integrity constraints and indexes for tenant-scoped tables.
--
-- OPTIONAL but recommended. The application does not depend on this migration;
-- it moves guarantees the code already enforces into the database as well.
-- Idempotent — safe to run more than once.
--
-- Constraints are added NOT VALID so existing rows are not checked (and nothing
-- is deleted). New and updated rows are enforced immediately. To also verify
-- historical rows, run the VALIDATE statements at the bottom once you have
-- confirmed there are no orphans.

BEGIN;

-- ─── Checklist links must point at real rows ────────────────────────────────
-- Deleting a document or a checklist item now removes its links automatically.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_documents_document_fk') THEN
    ALTER TABLE checklist_documents
      ADD CONSTRAINT checklist_documents_document_fk
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_documents_item_fk') THEN
    ALTER TABLE checklist_documents
      ADD CONSTRAINT checklist_documents_item_fk
      FOREIGN KEY (checklist_item_id) REFERENCES application_checklist_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- ─── Application status is one of the known values ──────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grant_applications_status_check') THEN
    ALTER TABLE grant_applications
      ADD CONSTRAINT grant_applications_status_check
      CHECK (status IN ('preparing', 'submitted', 'under-review', 'approved', 'declined', 'withdrawn')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grant_applications_amounts_check') THEN
    ALTER TABLE grant_applications
      ADD CONSTRAINT grant_applications_amounts_check
      CHECK ((amount_requested IS NULL OR amount_requested >= 0)
         AND (amount_awarded IS NULL OR amount_awarded >= 0)) NOT VALID;
  END IF;
END $$;

-- ─── Indexes for the queries the app actually runs ──────────────────────────

-- Applications list: WHERE org_id = $1 ORDER BY updated_at DESC
CREATE INDEX IF NOT EXISTS idx_grant_applications_org_updated
  ON grant_applications (org_id, updated_at DESC);

-- Saved searches list: WHERE org_id = $1 ORDER BY saved_at DESC
CREATE INDEX IF NOT EXISTS idx_saved_searches_org_saved
  ON saved_searches (org_id, saved_at DESC);

-- Shortlist: WHERE org_id = $1 ORDER BY shortlisted_at DESC
CREATE INDEX IF NOT EXISTS idx_shortlisted_grants_org_time
  ON shortlisted_grants (org_id, shortlisted_at DESC);

-- Documents list: WHERE org_id = $1 ORDER BY uploaded_at DESC
CREATE INDEX IF NOT EXISTS idx_documents_org_uploaded
  ON documents (org_id, uploaded_at DESC);

-- Checklist for one application: WHERE org_id = $1 AND grant_id = $2
CREATE INDEX IF NOT EXISTS idx_checklist_org_grant
  ON application_checklist_items (org_id, grant_id);

-- Removing a member deletes the invitations they sent
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by
  ON invitations (invited_by);

-- Pending-invite check: WHERE org_id = $1 AND email = $2
CREATE INDEX IF NOT EXISTS idx_invitations_org_email
  ON invitations (org_id, email);

-- Saved-search URL refresh matches orphaned grants by (funder, name)
CREATE INDEX IF NOT EXISTS idx_grants_funder_name_lower
  ON grants (lower(funder_name), lower(name));

COMMIT;

-- ─── Optional: validate existing rows ───────────────────────────────────────
-- Check for orphans first (both should return 0):
--
--   SELECT count(*) FROM checklist_documents cd
--   WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = cd.document_id);
--
--   SELECT count(*) FROM checklist_documents cd
--   WHERE NOT EXISTS (SELECT 1 FROM application_checklist_items i WHERE i.id = cd.checklist_item_id);
--
-- Then:
--
--   ALTER TABLE checklist_documents VALIDATE CONSTRAINT checklist_documents_document_fk;
--   ALTER TABLE checklist_documents VALIDATE CONSTRAINT checklist_documents_item_fk;
--   ALTER TABLE grant_applications  VALIDATE CONSTRAINT grant_applications_status_check;
--   ALTER TABLE grant_applications  VALIDATE CONSTRAINT grant_applications_amounts_check;

-- Rollback 005: Remove multi-tenancy tables and org_id columns

-- Remove org_id from tenant tables (reverse order of addition)
ALTER TABLE checklist_documents DROP COLUMN IF EXISTS org_id;
ALTER TABLE application_checklist_items DROP COLUMN IF EXISTS org_id;
ALTER TABLE documents DROP COLUMN IF EXISTS org_id;
ALTER TABLE grant_applications DROP COLUMN IF EXISTS org_id;
ALTER TABLE deep_searches DROP COLUMN IF EXISTS org_id;
ALTER TABLE shortlisted_grants DROP COLUMN IF EXISTS org_id;
ALTER TABLE saved_searches DROP COLUMN IF EXISTS org_id;

-- Restore original primary keys (if they were changed to composite)
-- Note: This is destructive if multiple orgs have data for the same grant
-- ALTER TABLE shortlisted_grants DROP CONSTRAINT IF EXISTS shortlisted_grants_pkey;
-- ALTER TABLE shortlisted_grants ADD PRIMARY KEY (grant_id);
-- (similar for deep_searches, grant_applications)

-- Drop auth tables
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organisations;

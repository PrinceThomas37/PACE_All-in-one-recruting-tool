-- minimal faithful copy of the columns the lead list reads (types taken from the live database on 3 Nov 2026)
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid NOT NULL, name text NOT NULL);
CREATE TABLE companies (id uuid PRIMARY KEY, org_id uuid NOT NULL, name text NOT NULL, industry text);
CREATE TABLE jobs (id uuid PRIMARY KEY, org_id uuid NOT NULL, company_id uuid NOT NULL, position text NOT NULL, location text, source text, industry text,
  stage text NOT NULL DEFAULT 'Unassigned', created_by uuid, assigned_to uuid, assigned_to_bd uuid, assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, is_duplicate boolean);
CREATE TABLE contacts (id uuid PRIMARY KEY, org_id uuid NOT NULL, job_id uuid NOT NULL, first_name text NOT NULL, last_name text, email text, is_primary boolean NOT NULL DEFAULT false);
-- indexes that exist today (from the live database)
CREATE INDEX idx_jobs_org ON jobs(org_id); CREATE INDEX idx_jobs_stage ON jobs(stage); CREATE INDEX idx_jobs_created_by ON jobs(created_by);
CREATE INDEX idx_jobs_assigned ON jobs(assigned_to); CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_contacts_job ON contacts(job_id); CREATE INDEX idx_contacts_org ON contacts(org_id); CREATE INDEX idx_contacts_email ON contacts(email);

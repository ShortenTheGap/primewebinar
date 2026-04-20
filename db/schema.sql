-- Prime Elite Workshop Funnel — Database Schema
-- This file runs automatically on server startup (see server/lib/db.ts).
-- It is idempotent — safe to run multiple times.

-- Enum for call dispositions
DO $$ BEGIN
  CREATE TYPE call_disposition_type AS ENUM ('sold', 'follow_up', 'not_a_fit', 'no_show');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Cohorts table — one row per workshop date
CREATE TABLE IF NOT EXISTS cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_date DATE NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contacts table — one row per GHL contact
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_contact_id TEXT UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  workshop_cohort DATE,
  lead_source TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_medium TEXT,
  referral_partner TEXT,
  is_workshop_buyer BOOLEAN NOT NULL DEFAULT false,
  attended_workshop BOOLEAN,
  deposit_paid BOOLEAN NOT NULL DEFAULT false,
  deposit_paid_at TIMESTAMPTZ,
  deposit_refunded BOOLEAN NOT NULL DEFAULT false,
  call_booked BOOLEAN NOT NULL DEFAULT false,
  call_booked_at TIMESTAMPTZ,
  call_completed BOOLEAN NOT NULL DEFAULT false,
  call_completed_at TIMESTAMPTZ,
  call_disposition call_disposition_type,
  converted_to_pe BOOLEAN NOT NULL DEFAULT false,
  converted_at TIMESTAMPTZ,
  assigned_rep TEXT,
  mrr_value INTEGER DEFAULT 0
);

-- Ad spend table — one row per day per campaign
CREATE TABLE IF NOT EXISTS ad_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  adset_id TEXT,
  creative_id TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  spend NUMERIC(10,2) NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, campaign_id)
);

-- Zoom attendance table — one row per attendee per session
CREATE TABLE IF NOT EXISTS zoom_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id TEXT NOT NULL,
  email TEXT NOT NULL,
  join_time TIMESTAMPTZ,
  leave_time TIMESTAMPTZ,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  workshop_cohort DATE,
  matched_contact_id UUID REFERENCES contacts(id),
  UNIQUE (webinar_id, email)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_workshop_cohort ON contacts(workshop_cohort);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_source ON contacts(lead_source);
CREATE INDEX IF NOT EXISTS idx_contacts_call_disposition ON contacts(call_disposition);
CREATE INDEX IF NOT EXISTS idx_ad_spend_date ON ad_spend(date);
CREATE INDEX IF NOT EXISTS idx_zoom_attendance_workshop_cohort ON zoom_attendance(workshop_cohort);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_zoom_attendance_email ON zoom_attendance(email);

-- Migrations (idempotent ALTERs for fields added after initial schema)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attended_full_session BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attended_minutes INTEGER;
ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS zoom_webinar_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cohorts_zoom_webinar_id ON cohorts(zoom_webinar_id) WHERE zoom_webinar_id IS NOT NULL;

-- Prime Elite payment plan tracking. Monthly subscribers pay $2000 first
-- month (deposit $500 already collected → $2500 total first month) then 11
-- payments of $2500. Paid-in-full pays $30000 upfront. Both have $2500 MRR.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pe_payment_plan TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pe_initial_payment NUMERIC(10,2);

-- Guest tickets: free passes given to friends / partners / existing community.
-- Counted in attendance metrics but not revenue.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;

-- Per-cohort Meta Ads attribution: which ad campaigns drove this workshop,
-- and over what date window. Only ads matching a cohort's rules count
-- toward its ROAS / Cost-per-Buy / etc.
ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS ad_campaign_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS ad_attribution_start DATE;
ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS include_all_ad_spend BOOLEAN NOT NULL DEFAULT false;

-- One person can buy multiple workshops. Drop the unique-ghl_contact_id
-- constraint in favor of a composite unique on (email, workshop_cohort) so
-- a contact gets one row per cohort they're in.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_ghl_contact_id_key;
DROP INDEX IF EXISTS contacts_ghl_contact_id_key;
-- Drop any earlier (partial) version of the index so we can recreate it without
-- a WHERE predicate (simpler ON CONFLICT inference).
DROP INDEX IF EXISTS contacts_email_cohort_unique;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_cohort_unique
  ON contacts (LOWER(email), workshop_cohort);

-- Attribution columns. Raw utm_source is stored alongside the normalized
-- lead_source so we can debug mis-normalizations and rerun attribution logic
-- without losing the original value. First-touch columns capture the UTMs
-- the FIRST time we see a contact in a cohort — populated only if NULL, so
-- subsequent webhooks (e.g. a later contact.purchased) don't overwrite the
-- original attribution. fbclid is the Meta click ID when the visitor arrived
-- from a Facebook or Instagram ad click.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_utm_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_utm_campaign TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_utm_content TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_utm_medium TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_lead_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_touch_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fbclid TEXT;

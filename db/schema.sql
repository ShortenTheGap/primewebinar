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

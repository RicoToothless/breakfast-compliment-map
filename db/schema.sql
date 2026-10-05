-- Store Google place IDs, not a permanent copy of Google's restaurant content.
CREATE TABLE IF NOT EXISTS restaurants (
  place_id text PRIMARY KEY,
  discovered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  place_id text NOT NULL REFERENCES restaurants(place_id),
  visitor_id uuid NOT NULL,
  taipei_day date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (place_id, visitor_id, taipei_day)
);
CREATE INDEX IF NOT EXISTS compliments_place_idx ON compliments(place_id);

-- Legacy anonymous and demo votes stay intact. New votes belong to an account.
ALTER TABLE compliments ALTER COLUMN visitor_id DROP NOT NULL;
ALTER TABLE compliments ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth_user(id);
CREATE UNIQUE INDEX IF NOT EXISTS compliments_user_day_idx ON compliments(user_id, taipei_day);

-- Retain the previous daily counters for historical usage and migration.
CREATE TABLE IF NOT EXISTS api_usage (
  usage_key text NOT NULL,
  usage_day date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (usage_key, usage_day)
);

-- Each billed operation has its own calendar-month budget. Google resets its
-- monthly allowance in Pacific US time, including daylight saving changes.
CREATE TABLE IF NOT EXISTS google_monthly_usage (
  usage_key text NOT NULL,
  usage_month date NOT NULL DEFAULT
    date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date,
  requests integer NOT NULL CHECK (requests >= 0),
  PRIMARY KEY (usage_key, usage_month)
);

-- Old Places counters combined search and detail calls. Conservatively charge
-- their total to BOTH new budgets for this month; splitting it is impossible.
-- Include both boundary Taipei dates because the old rows have no timestamp.
-- Re-running setup preserves counters already in use.
WITH current_month AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date AS month
), legacy AS (
  SELECT m.month, coalesce(sum(a.requests), 0)::integer AS requests
  FROM current_month m LEFT JOIN api_usage a ON a.usage_key = 'google-places'
    AND a.usage_day >= m.month
    AND a.usage_day <= (m.month + interval '1 month')::date
  GROUP BY m.month
)
INSERT INTO google_monthly_usage (usage_key, usage_month, requests)
SELECT key, month, requests FROM legacy
CROSS JOIN unnest(ARRAY['places-search', 'places-details']) AS key
ON CONFLICT DO NOTHING;

-- This visitor throttle is independent of monthly Google budgets.
CREATE TABLE IF NOT EXISTS visitor_requests (
  visitor_id uuid PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  requests integer NOT NULL CHECK (requests > 0)
);

-- A visitor may start one Places search every ten seconds, across processes.
CREATE TABLE IF NOT EXISTS restaurant_searches (
  visitor_id uuid PRIMARY KEY,
  searched_at timestamptz NOT NULL DEFAULT now()
);

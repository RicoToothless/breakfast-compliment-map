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

-- Both throttles work across processes and concurrent requests.
CREATE TABLE IF NOT EXISTS api_usage (
  usage_key text NOT NULL,
  usage_day date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (usage_key, usage_day)
);
CREATE TABLE IF NOT EXISTS visitor_requests (
  visitor_id uuid PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  requests integer NOT NULL CHECK (requests > 0)
);

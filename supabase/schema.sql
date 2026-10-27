-- ============================================================
--  YoGi Links - FULL DATABASE SETUP (v2)
--  Supabase -> SQL Editor -> paste ALL -> Run.  Safe to re-run any time.
-- ============================================================

-- ---------- links ----------
CREATE TABLE IF NOT EXISTS public.short_links (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL CHECK (original_url ~* '^https?://' AND length(original_url) <= 2048),
    short_code TEXT UNIQUE NOT NULL,
    total_clicks BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE public.short_links ADD COLUMN IF NOT EXISTS ad_pages SMALLINT NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'short_links_ad_pages_check') THEN
    ALTER TABLE public.short_links ADD CONSTRAINT short_links_ad_pages_check CHECK (ad_pages BETWEEN 1 AND 3);
  END IF;
END $$;

-- ---------- finished views (one row per completed visit) ----------
CREATE TABLE IF NOT EXISTS public.link_clicks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    short_link_id BIGINT NOT NULL REFERENCES public.short_links(id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ DEFAULT NOW(),
    user_agent TEXT,
    referrer TEXT
);
ALTER TABLE public.link_clicks ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.link_clicks ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE public.link_clicks ADD COLUMN IF NOT EXISTS is_unique BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.link_clicks ADD COLUMN IF NOT EXISTS earned NUMERIC(14,6) NOT NULL DEFAULT 0;
UPDATE public.link_clicks c SET user_id = s.user_id
  FROM public.short_links s WHERE s.id = c.short_link_id AND c.user_id IS NULL;

-- ---------- started visits (opened the 1st ad page) -> used for "left without finishing" ----------
CREATE TABLE IF NOT EXISTS public.link_starts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    short_link_id BIGINT NOT NULL REFERENCES public.short_links(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- profiles (wallet + API key) ----------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    api_key TEXT UNIQUE NOT NULL DEFAULT (replace(gen_random_uuid()::text,'-','') || substr(replace(gen_random_uuid()::text,'-',''),1,8)),
    balance NUMERIC(14,6) NOT NULL DEFAULT 0,
    total_earned NUMERIC(14,6) NOT NULL DEFAULT 0,
    total_withdrawn NUMERIC(14,6) NOT NULL DEFAULT 0,
    payment_method TEXT,
    payment_details TEXT,
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO public.profiles (id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;

-- ---------- withdrawals ----------
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount NUMERIC(14,6) NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- ---------- admin-editable settings ----------
CREATE TABLE IF NOT EXISTS public.app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO public.app_settings (key, value) VALUES
  ('rate_p1','0.50'), ('rate_p2','1.00'), ('rate_p3','1.50'),
  ('min_withdraw','5.00'), ('currency','$')
ON CONFLICT (key) DO NOTHING;

-- ---------- indexes ----------
CREATE INDEX IF NOT EXISTS short_links_user_idx ON public.short_links (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS link_clicks_link_idx ON public.link_clicks (short_link_id);
CREATE INDEX IF NOT EXISTS link_clicks_user_time_idx ON public.link_clicks (user_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS link_clicks_dedupe_idx ON public.link_clicks (short_link_id, ip_hash, clicked_at DESC);
CREATE INDEX IF NOT EXISTS link_starts_user_time_idx ON public.link_starts (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON public.withdrawals (status, created_at DESC);

-- ---------- security (RLS) ----------
ALTER TABLE public.short_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_clicks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_starts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own links" ON public.short_links;
DROP POLICY IF EXISTS "Users read own links" ON public.short_links;
DROP POLICY IF EXISTS "Users create own links" ON public.short_links;
DROP POLICY IF EXISTS "Users update own links" ON public.short_links;
DROP POLICY IF EXISTS "Users delete own links" ON public.short_links;
CREATE POLICY "Users read own links" ON public.short_links FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users create own links" ON public.short_links FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own links" ON public.short_links FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own links" ON public.short_links FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own click events" ON public.link_clicks;
CREATE POLICY "Users read own click events" ON public.link_clicks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.short_links s WHERE s.id = link_clicks.short_link_id AND s.user_id = auth.uid()));

-- Tables below are touched ONLY by the server (service role) - no policies for normal users.
REVOKE ALL ON public.short_links, public.link_clicks, public.link_starts,
              public.profiles, public.withdrawals, public.app_settings FROM anon, authenticated;
GRANT SELECT, DELETE ON public.short_links TO authenticated;
GRANT INSERT (user_id, original_url, short_code, ad_pages) ON public.short_links TO authenticated;
GRANT UPDATE (is_active) ON public.short_links TO authenticated;
GRANT SELECT ON public.link_clicks TO authenticated;
GRANT ALL ON public.short_links, public.link_clicks, public.link_starts,
             public.profiles, public.withdrawals, public.app_settings TO service_role;

-- ---------- record one finished view + pay the owner (atomic) ----------
CREATE OR REPLACE FUNCTION public.record_view(p_link_id BIGINT, p_ip_hash TEXT, p_ua TEXT, p_ref TEXT, p_is_bot BOOLEAN)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l RECORD; v_unique BOOLEAN := FALSE; v_rate NUMERIC; v_earn NUMERIC := 0; v_banned BOOLEAN;
BEGIN
  SELECT id, user_id, ad_pages INTO l FROM short_links WHERE id = p_link_id AND is_active;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT is_banned INTO v_banned FROM profiles WHERE id = l.user_id;
  -- Paid only if: not a bot, and this visitor (IP) has not been paid for this link in the last 24h
  v_unique := NOT p_is_bot AND NOT EXISTS (
    SELECT 1 FROM link_clicks WHERE short_link_id = l.id AND ip_hash = p_ip_hash
      AND is_unique AND clicked_at > now() - interval '24 hours');
  IF v_unique AND NOT COALESCE(v_banned, FALSE) THEN
    SELECT NULLIF(value,'')::NUMERIC INTO v_rate FROM app_settings WHERE key = 'rate_p' || l.ad_pages;
    v_earn := round(COALESCE(v_rate, 0) / 1000.0, 6);   -- rate is "per 1000 views"
  END IF;
  INSERT INTO link_clicks (short_link_id, user_id, user_agent, referrer, ip_hash, is_unique, earned)
  VALUES (l.id, l.user_id, p_ua, p_ref, p_ip_hash, v_unique, v_earn);
  UPDATE short_links SET total_clicks = total_clicks + 1 WHERE id = l.id;
  IF v_earn > 0 THEN
    UPDATE profiles SET balance = balance + v_earn, total_earned = total_earned + v_earn WHERE id = l.user_id;
  END IF;
  RETURN v_earn;
END $$;

-- ---------- withdrawals ----------
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_user UUID, p_amount NUMERIC, p_min NUMERIC)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p RECORD; new_id BIGINT;
BEGIN
  SELECT * INTO p FROM profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF p.is_banned THEN RAISE EXCEPTION 'Account suspended.'; END IF;
  IF p.payment_method IS NULL OR COALESCE(p.payment_details,'') = '' THEN RAISE EXCEPTION 'Save your payment method first.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter a valid amount.'; END IF;
  IF p_amount < p_min THEN RAISE EXCEPTION 'Minimum withdrawal is %.', p_min; END IF;
  IF p_amount > p.balance THEN RAISE EXCEPTION 'Not enough balance.'; END IF;
  UPDATE profiles SET balance = balance - p_amount WHERE id = p_user;
  INSERT INTO withdrawals (user_id, amount, method, details) VALUES (p_user, p_amount, p.payment_method, p.payment_details)
    RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.process_withdrawal(p_id BIGINT, p_status TEXT, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w RECORD;
BEGIN
  IF p_status NOT IN ('paid','rejected') THEN RAISE EXCEPTION 'Invalid status.'; END IF;
  SELECT * INTO w FROM withdrawals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.'; END IF;
  IF w.status <> 'pending' THEN RAISE EXCEPTION 'Already processed.'; END IF;
  IF p_status = 'paid' THEN
    UPDATE profiles SET total_withdrawn = total_withdrawn + w.amount WHERE id = w.user_id;
  ELSE
    UPDATE profiles SET balance = balance + w.amount WHERE id = w.user_id;   -- refund
  END IF;
  UPDATE withdrawals SET status = p_status, note = p_note, processed_at = now() WHERE id = p_id;
END $$;

-- ---------- dashboards (day boundaries use India time; change 'Asia/Kolkata' if you want) ----------
CREATE OR REPLACE FUNCTION public.user_stats(p_user UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT jsonb_build_object(
  'today_views',    (SELECT count(*) FROM link_clicks WHERE user_id = p_user AND (clicked_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'today_unique',   (SELECT count(*) FROM link_clicks WHERE user_id = p_user AND is_unique AND (clicked_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'today_earned',   (SELECT COALESCE(sum(earned),0) FROM link_clicks WHERE user_id = p_user AND (clicked_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'today_started',  (SELECT count(*) FROM link_starts WHERE user_id = p_user AND (started_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'total_views',    (SELECT count(*) FROM link_clicks WHERE user_id = p_user),
  'total_links',    (SELECT count(*) FROM short_links WHERE user_id = p_user),
  'days', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', x.d, 'views', x.v, 'earned', x.e) ORDER BY x.d), '[]'::jsonb) FROM (
      SELECT g::date AS d, count(c.id) AS v, COALESCE(sum(c.earned),0) AS e
      FROM generate_series(((now() AT TIME ZONE 'Asia/Kolkata')::date - 6)::timestamp, (now() AT TIME ZONE 'Asia/Kolkata')::date::timestamp, interval '1 day') g
      LEFT JOIN link_clicks c ON c.user_id = p_user AND (c.clicked_at AT TIME ZONE 'Asia/Kolkata')::date = g::date
      GROUP BY g) x),
  'top', (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT s.short_code, s.original_url, count(c.id) AS views
      FROM short_links s JOIN link_clicks c ON c.short_link_id = s.id
      WHERE s.user_id = p_user AND (c.clicked_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
      GROUP BY s.id ORDER BY views DESC LIMIT 5) t)
);
$$;

CREATE OR REPLACE FUNCTION public.admin_stats() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT jsonb_build_object(
  'users',          (SELECT count(*) FROM auth.users),
  'links',          (SELECT count(*) FROM short_links),
  'total_views',    (SELECT count(*) FROM link_clicks),
  'today_views',    (SELECT count(*) FROM link_clicks WHERE (clicked_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'today_unique',   (SELECT count(*) FROM link_clicks WHERE is_unique AND (clicked_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'today_started',  (SELECT count(*) FROM link_starts WHERE (started_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'today_owed',     (SELECT COALESCE(sum(earned),0) FROM link_clicks WHERE (clicked_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'total_owed',     (SELECT COALESCE(sum(total_earned),0) FROM profiles),
  'balances',       (SELECT COALESCE(sum(balance),0) FROM profiles),
  'total_paid',     (SELECT COALESCE(sum(total_withdrawn),0) FROM profiles),
  'pending_count',  (SELECT count(*) FROM withdrawals WHERE status = 'pending'),
  'pending_amount', (SELECT COALESCE(sum(amount),0) FROM withdrawals WHERE status = 'pending'),
  'days', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', x.d, 'views', x.v, 'earned', x.e) ORDER BY x.d), '[]'::jsonb) FROM (
      SELECT g::date AS d, count(c.id) AS v, COALESCE(sum(c.earned),0) AS e
      FROM generate_series(((now() AT TIME ZONE 'Asia/Kolkata')::date - 13)::timestamp, (now() AT TIME ZONE 'Asia/Kolkata')::date::timestamp, interval '1 day') g
      LEFT JOIN link_clicks c ON (c.clicked_at AT TIME ZONE 'Asia/Kolkata')::date = g::date
      GROUP BY g) x)
);
$$;

CREATE OR REPLACE FUNCTION public.admin_users() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
  SELECT u.id, u.email, u.created_at, COALESCE(p.balance,0) AS balance, COALESCE(p.total_earned,0) AS total_earned,
         COALESCE(p.is_banned,false) AS is_banned,
         (SELECT count(*) FROM short_links s WHERE s.user_id = u.id) AS links,
         (SELECT count(*) FROM link_clicks c WHERE c.user_id = u.id) AS views
  FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
  ORDER BY u.created_at DESC LIMIT 200) x;
$$;

CREATE OR REPLACE FUNCTION public.admin_withdrawals() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT COALESCE(jsonb_agg(x ORDER BY (x.status = 'pending') DESC, x.created_at DESC), '[]'::jsonb) FROM (
  SELECT w.id, w.amount, w.method, w.details, w.status, w.note, w.created_at, w.processed_at, u.email
  FROM withdrawals w LEFT JOIN auth.users u ON u.id = w.user_id
  ORDER BY w.created_at DESC LIMIT 100) x;
$$;

CREATE OR REPLACE FUNCTION public.admin_links() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
  SELECT s.id, s.short_code, s.original_url, s.ad_pages, s.total_clicks, s.is_active, s.created_at, u.email
  FROM short_links s LEFT JOIN auth.users u ON u.id = s.user_id
  ORDER BY s.created_at DESC LIMIT 100) x;
$$;

-- Only the server (service role) may call these
REVOKE ALL ON FUNCTION public.record_view(BIGINT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal(UUID, NUMERIC, NUMERIC)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_withdrawal(BIGINT, TEXT, TEXT)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_stats(UUID)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_stats()                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_users()                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_withdrawals()                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_links()                                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_view(BIGINT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, NUMERIC, NUMERIC)     TO service_role;
GRANT EXECUTE ON FUNCTION public.process_withdrawal(BIGINT, TEXT, TEXT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.user_stats(UUID)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_stats()                                  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_users()                                  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_withdrawals()                            TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_links()                                  TO service_role;

-- make the API see the new tables/columns immediately
NOTIFY pgrst, 'reload schema';

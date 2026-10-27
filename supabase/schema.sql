-- Run this ONCE in Supabase -> SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.short_links (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL CHECK (original_url ~* '^https?://' AND length(original_url) <= 2048),
    short_code TEXT UNIQUE NOT NULL,
    total_clicks BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.link_clicks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    short_link_id BIGINT NOT NULL REFERENCES public.short_links(id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ DEFAULT NOW(),
    user_agent TEXT,
    referrer TEXT
);

-- Ad pages shown before the real link (1, 2 or 3). Existing links get 1.
ALTER TABLE public.short_links ADD COLUMN IF NOT EXISTS ad_pages SMALLINT NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'short_links_ad_pages_check') THEN
    ALTER TABLE public.short_links ADD CONSTRAINT short_links_ad_pages_check CHECK (ad_pages BETWEEN 1 AND 3);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS short_links_user_idx ON public.short_links (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS link_clicks_link_idx ON public.link_clicks (short_link_id);

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_clicks ENABLE ROW LEVEL SECURITY;

-- Remove old policy from the first version (it let users edit total_clicks)
DROP POLICY IF EXISTS "Users manage own links" ON public.short_links;
DROP POLICY IF EXISTS "Users read own links" ON public.short_links;
DROP POLICY IF EXISTS "Users create own links" ON public.short_links;
DROP POLICY IF EXISTS "Users update own links" ON public.short_links;
DROP POLICY IF EXISTS "Users delete own links" ON public.short_links;

CREATE POLICY "Users read own links" ON public.short_links
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users create own links" ON public.short_links
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own links" ON public.short_links
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own links" ON public.short_links
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own click events" ON public.link_clicks;
CREATE POLICY "Users read own click events" ON public.link_clicks
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.short_links s
                 WHERE s.id = link_clicks.short_link_id AND s.user_id = auth.uid()));

-- Column-level permissions: users can NOT set/modify total_clicks themselves.
REVOKE ALL ON public.short_links FROM anon, authenticated;
REVOKE ALL ON public.link_clicks FROM anon, authenticated;
GRANT SELECT, DELETE ON public.short_links TO authenticated;
GRANT INSERT (user_id, original_url, short_code, ad_pages) ON public.short_links TO authenticated;
GRANT UPDATE (is_active) ON public.short_links TO authenticated;
GRANT SELECT ON public.link_clicks TO authenticated;
GRANT ALL ON public.short_links, public.link_clicks TO service_role;

CREATE OR REPLACE FUNCTION public.increment_short_link_clicks(link_id BIGINT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.short_links
    SET total_clicks = total_clicks + 1
    WHERE id = link_id AND is_active = TRUE;
$$;

REVOKE ALL ON FUNCTION public.increment_short_link_clicks(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_short_link_clicks(BIGINT) TO service_role;

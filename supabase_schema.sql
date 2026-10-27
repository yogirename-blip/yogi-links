CREATE TABLE IF NOT EXISTS public.short_links (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL,
    short_code TEXT UNIQUE NOT NULL,
    total_clicks BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.link_clicks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    short_link_id BIGINT NOT NULL REFERENCES public.short_links(id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ DEFAULT NOW(),
    user_agent TEXT,
    referrer TEXT
);

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_clicks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own links" ON public.short_links;

CREATE POLICY "Users manage own links"
ON public.short_links
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own click events" ON public.link_clicks;

CREATE POLICY "Users read own click events"
ON public.link_clicks
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.short_links s
        WHERE s.id = link_clicks.short_link_id
        AND s.user_id = auth.uid()
    )
);

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

REVOKE ALL ON FUNCTION public.increment_short_link_clicks(BIGINT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_short_link_clicks(BIGINT)
TO service_role;

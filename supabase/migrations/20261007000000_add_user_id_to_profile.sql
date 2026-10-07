-- Migration: Add user_id to profile and auto-create profile on auth signup

ALTER TABLE public.profile 
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_profile_user_id ON public.profile(user_id);

-- Create trigger function to auto-create profile for new signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile (
    user_id,
    email,
    full_name,
    preferred_name,
    university,
    program,
    current_semester,
    default_citation_style,
    updated_at
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'preferred_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'university', 'Academic Institution'),
    COALESCE(new.raw_user_meta_data->>'program', 'Undergraduate Degree'),
    COALESCE(new.raw_user_meta_data->>'current_semester', 'Semester 1'),
    'IEEE',
    now()
  );
  RETURN new;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

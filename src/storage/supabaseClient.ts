import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// We use the service role key to bypass RLS for the backend bot.
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

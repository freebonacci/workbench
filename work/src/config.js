// Public by design — the anon key only works together with the login + row-level security.
export const SUPABASE_URL = "https://unwlmrhlvcdpzusgcmlu.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVud2xtcmhsdmNkcHp1c2djbWx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MTk1NzcsImV4cCI6MjEwMjM5NTU3N30.W_eef_QcO767y3ky-RzKJZP9uZ8lh4DIHBfZ_DXImPA";

// The only two people who can log in (must match is_work_user() in supabase/work-setup.sql)
export const WORK_USERS = [
  { name: "Ben", email: "benjamin@taimaka.org" },
  { name: "Justin", email: "justin@taimaka.org" },
];
export const PASSWORD_HINT = "to help";

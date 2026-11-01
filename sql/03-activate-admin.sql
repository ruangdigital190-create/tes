-- First register the sholeh123 username using the public website with a REAL email.
-- Supabase Auth must store a password securely. Never put it in HTML or SQL.
-- Run this ONCE in Supabase Dashboard -> SQL Editor (as postgres).
update public.profiles
set role='admin'
where username='sholeh123'
returning username,display_name,email,role;
-- If no row was returned, you have not registered the account yet.

-- RUANGDIGITAL190 v2: NEW Supabase project only. Run once in SQL Editor.
-- Security: default deny via RLS. Never embed a service_role key in frontend.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique,
 display_name text not null default 'Pelanggan',
 email text not null,
 phone text,
 role text not null default 'customer' check(role in ('customer','admin')),
 created_at timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles(role);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role='admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon,authenticated;

-- Only user metadata is read from the newly created Supabase Auth account.
-- Never trust metadata for the admin role.
create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
 candidate := lower(trim(coalesce(new.raw_user_meta_data->>'username','')));
 if candidate !~ '^[a-z0-9_]{3,24}$' then
   candidate := 'user_' || substr(replace(new.id::text,'-',''),1,15);
 end if;
 insert into public.profiles(id,username,display_name,email,phone,role)
 values(new.id,candidate,left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Pelanggan'),100),lower(coalesce(new.email,'')),nullif(left(trim(coalesce(new.raw_user_meta_data->>'phone','')),25),''),'customer');
 return new;
end;
$$;
drop trigger if exists rd190_create_profile on auth.users;
create trigger rd190_create_profile after insert on auth.users
for each row execute function public.create_profile_for_user();

create table if not exists public.products (
 id text primary key,
 brand text not null,
 title text not null,
 group_name text not null default 'apps' check (group_name in ('apps','games')),
 category text not null default 'Lainnya',
 tag text,
 short_description text,
 description text,
 info text,
 image_url text,
 sort_order integer not null default 0,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists products_sort_idx on public.products(is_active,sort_order);

create table if not exists public.product_variants (
 id uuid primary key default gen_random_uuid(),
 product_id text not null references public.products(id) on delete cascade,
 name text not null,
 price bigint check(price is null or price >= 0),
 original_price bigint check(original_price is null or original_price >= 0),
 stock_status text not null default 'confirm' check(stock_status in ('available','limited','out_of_stock','confirm')),
 stock_quantity integer check(stock_quantity is null or stock_quantity >= 0),
 discount_enabled boolean not null default false,
 note text,
 sort_order integer not null default 0,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(product_id,name)
);
create index if not exists variants_product_idx on public.product_variants(product_id,sort_order);

create table if not exists public.store_assets (
 slug text primary key,
 title text not null,
 image_url text,
 updated_at timestamptz not null default now()
);

create table if not exists public.orders (
 id uuid primary key default gen_random_uuid(),
 order_number text not null unique,
 user_id uuid not null references auth.users(id),
 customer_name text not null,
 phone text not null,
 player_id text,
 zone_id text,
 note text,
 amount bigint not null default 0,
 quote_required boolean not null default false,
 status text not null default 'new' check(status in ('new','processing','completed','cancelled')),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','pending','paid','refunded')),
 admin_note text,
 created_at timestamptz not null default now()
);
create index if not exists orders_owner_idx on public.orders(user_id,created_at desc);

create table if not exists public.order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 product_id text references public.products(id) on delete set null,
 variant_id uuid references public.product_variants(id) on delete set null,
 product_name text not null,
 variant_name text not null,
 price bigint,
 quantity integer not null check(quantity between 1 and 50),
 subtotal bigint
);

create table if not exists public.device_sessions (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 device_label text not null,
 started_at timestamptz not null default now(),
 last_seen timestamptz not null default now(),
 is_active boolean not null default true
);
create index if not exists device_sessions_user_idx on public.device_sessions(user_id,last_seen desc);

create table if not exists public.support_tickets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 order_number text,
 ticket_type text not null check(ticket_type in ('pertanyaan','refund','garansi')),
 message text not null,
 status text not null default 'new' check(status in ('new','processing','closed')),
 admin_reply text,
 created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
 id bigint generated always as identity primary key,
 actor_id uuid,
 table_name text not null,
 action text not null,
 row_id text,
 changed_at timestamptz not null default now()
);

-- secure order creation: price/stock ALWAYS calculated from database, not from client.
create or replace function public.place_order(
 p_name text,p_phone text,p_player text,p_zone text,p_note text,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 owner_id uuid := auth.uid();
 line jsonb; prod_id text; var_id uuid; qty integer; price_value bigint;
 prod_title text; var_title text; stock_value text; group_val text; available_qty integer;
 result_id uuid; total_value bigint := 0; needs_quote boolean := false;
 order_no text := 'RD-' || to_char(now() at time zone 'Asia/Jakarta','YYMMDD') || '-' || upper(substr(encode(gen_random_bytes(5),'hex'),1,8));
begin
 if owner_id is null then raise exception 'LOGIN_REQUIRED'; end if;
 if length(trim(coalesce(p_name,''))) < 2 or length(trim(coalesce(p_phone,''))) < 9 then raise exception 'INVALID_CUSTOMER_DATA'; end if;
 if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'INVALID_CART'; end if;
 insert into public.orders(order_number,user_id,customer_name,phone,player_id,zone_id,note)
 values(order_no,owner_id,left(trim(p_name),120),left(trim(p_phone),40),left(trim(coalesce(p_player,'')),80),left(trim(coalesce(p_zone,'')),80),left(trim(coalesce(p_note,'')),1000)) returning id into result_id;
 for line in select value from jsonb_array_elements(p_items) loop
  prod_id := line->>'product_id';
  begin var_id := (line->>'variant_id')::uuid; exception when others then raise exception 'INVALID_VARIANT'; end;
  begin qty := (line->>'quantity')::integer; exception when others then raise exception 'INVALID_QUANTITY'; end;
  if qty is null or qty not between 1 and 50 then raise exception 'INVALID_QUANTITY'; end if;
  select p.title,v.name,v.price,v.stock_status,p.group_name,v.stock_quantity into prod_title,var_title,price_value,stock_value,group_val,available_qty
  from public.products p join public.product_variants v on v.product_id=p.id
  where p.id=prod_id and p.is_active=true and v.id=var_id and v.is_active=true;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if stock_value='out_of_stock' or (available_qty is not null and qty>available_qty) then raise exception 'OUT_OF_STOCK'; end if;
  if group_val='games' and length(trim(coalesce(p_player,'')))<3 then raise exception 'PLAYER_ID_REQUIRED'; end if;
  if prod_id='mlbb' and length(trim(coalesce(p_zone,'')))<2 then raise exception 'MLBB_ZONE_ID_REQUIRED'; end if;
  if price_value is null then needs_quote:=true; else total_value:=total_value+price_value*qty; end if;
  insert into public.order_items(order_id,product_id,variant_id,product_name,variant_name,price,quantity,subtotal)
  values(result_id,prod_id,var_id,prod_title,var_title,price_value,qty,case when price_value is null then null else price_value*qty end);
 end loop;
 update public.orders set amount=total_value,quote_required=needs_quote where id=result_id;
 return jsonb_build_object('id',result_id,'order_number',order_no,'amount',total_value,'quote_required',needs_quote);
end;
$$;
revoke all on function public.place_order(text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.place_order(text,text,text,text,text,jsonb) to authenticated;

-- Compatibility-free admin username login: resolve ONLY admin username to Auth email.
-- This permits discovery of an admin email. Use a dedicated admin mailbox if privacy matters.
create or replace function public.resolve_admin_login(p_username text)
returns text language sql stable security definer set search_path = '' as $$
 select email from public.profiles
 where username=lower(trim(p_username)) and role='admin' limit 1;
$$;
revoke all on function public.resolve_admin_login(text) from public;
grant execute on function public.resolve_admin_login(text) to anon,authenticated;

-- Admin activity log. Roles/ACL prevent a visitor from writing audit rows.
create or replace function public.log_store_edits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.audit_logs(actor_id,table_name,action,row_id)
 values(auth.uid(),tg_table_name,tg_op,coalesce(case when tg_op='DELETE' then old.id::text else new.id::text end,''));
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists rd190_audit_products on public.products;
create trigger rd190_audit_products after insert or update or delete on public.products for each row execute function public.log_store_edits();
drop trigger if exists rd190_audit_variants on public.product_variants;
create trigger rd190_audit_variants after insert or update or delete on public.product_variants for each row execute function public.log_store_edits();

-- Row Level Security: tables are not publicly writable.
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.store_assets enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.device_sessions enable row level security;
alter table public.support_tickets enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or public.is_admin());
create policy profiles_edit_self on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy products_read on public.products for select to anon,authenticated using(is_active or public.is_admin());
create policy products_admin_all on public.products for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy variants_read on public.product_variants for select to anon,authenticated using((is_active and exists(select 1 from public.products p where p.id=product_id and p.is_active)) or public.is_admin());
create policy variants_admin_all on public.product_variants for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy assets_read on public.store_assets for select to anon,authenticated using(true);
create policy assets_admin_all on public.store_assets for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy orders_read on public.orders for select to authenticated using(user_id=(select auth.uid()) or public.is_admin());
create policy orders_admin_edit on public.orders for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy items_read on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (o.user_id=(select auth.uid()) or public.is_admin())));
create policy devices_read on public.device_sessions for select to authenticated using(user_id=(select auth.uid()) or public.is_admin());
create policy devices_write on public.device_sessions for insert to authenticated with check(user_id=(select auth.uid()));
create policy devices_edit on public.device_sessions for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy tickets_read on public.support_tickets for select to authenticated using(user_id=(select auth.uid()) or public.is_admin());
create policy tickets_insert on public.support_tickets for insert to authenticated with check(user_id=(select auth.uid()));
create policy tickets_admin_update on public.support_tickets for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy audit_read on public.audit_logs for select to authenticated using(public.is_admin());

-- Column grants prevent changing own role or email via direct browser PATCH.
revoke all on public.profiles from anon,authenticated;
grant select on public.profiles to authenticated;
grant update(display_name,phone) on public.profiles to authenticated;
grant select on public.products,public.product_variants,public.store_assets to anon,authenticated;
grant insert,update,delete on public.products,public.product_variants,public.store_assets to authenticated;
grant select on public.orders,public.order_items,public.device_sessions,public.support_tickets,public.audit_logs to authenticated;
grant update(status,payment_status,admin_note) on public.orders to authenticated;
grant insert,update on public.device_sessions to authenticated;
grant insert on public.support_tickets to authenticated;
grant update(status,admin_reply) on public.support_tickets to authenticated;

-- Storage public bucket, upload and delete reserved for admin role.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rd190-images','rd190-images',true,5242880,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict(id) do nothing;
create policy rd190_admin_upload on storage.objects for insert to authenticated
with check(bucket_id='rd190-images' and public.is_admin());
create policy rd190_admin_replace on storage.objects for update to authenticated
using(bucket_id='rd190-images' and public.is_admin()) with check(bucket_id='rd190-images' and public.is_admin());
create policy rd190_admin_delete on storage.objects for delete to authenticated
using(bucket_id='rd190-images' and public.is_admin());
create policy rd190_admin_read_files on storage.objects for select to authenticated
using(bucket_id='rd190-images' and public.is_admin());

-- Realtime publications for catalog and media, only visible rows emitted under RLS.
do $$ begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  execute 'create publication supabase_realtime';
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='products') then
  execute 'alter publication supabase_realtime add table public.products';
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='product_variants') then
  execute 'alter publication supabase_realtime add table public.product_variants';
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='store_assets') then
  execute 'alter publication supabase_realtime add table public.store_assets';
 end if;
end $$;

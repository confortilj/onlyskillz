-- skillz.ai — consolidated production schema
-- Apply with: supabase db push   (or paste into the Supabase SQL editor)

create type product_type as enum ('skill','prompt','dataset','avatar','voice','model','mcp','workflow','rag','eval','assets');
create type plan_id as enum ('free','starter','pro','enterprise');
create type license_kind as enum ('subscription','credit_purchase','rental','buyout');
create type license_status as enum ('active','deactivated','perpetual');
create type scan_status as enum ('pass','warn','fail');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique, display_name text,
  is_designer boolean not null default false,
  plan plan_id not null default 'free',
  sub_active boolean not null default true,
  sub_renewal date,
  credits int not null default 0,
  revenue_share int not null default 60,
  stripe_customer_id text, stripe_connect_id text,
  connect_status text default 'none', payout_email text,
  created_at timestamptz not null default now()
);

create table public.products (
  id text primary key, type product_type not null, name text not null,
  icon text, description text, category text,
  tier plan_id not null default 'free', version text,
  designer_id uuid references public.profiles(id), designer_label text,
  llms text[] not null default '{}', format text,
  credits_price int, rent_price int, buyout_price int,
  score int, upvotes int not null default 0, downloads int not null default 0, rating numeric(2,1),
  featured boolean not null default false, trend_rank int,
  meta jsonb, docs jsonb, security jsonb, bundle_path text,
  published boolean not null default true,
  updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id text not null references public.products(id),
  kind license_kind not null, status license_status not null default 'active',
  license_key text not null unique, credits_spent int default 0,
  created_at timestamptz not null default now(), unique(user_id, product_id)
);

-- FORENSIC FINGERPRINT REGISTRY (service-role only; survives account deletion as evidence)
create table public.fingerprints (
  id uuid primary key default gen_random_uuid(),
  fingerprint_code text not null unique,
  user_id uuid not null references public.profiles(id),
  product_id text not null references public.products(id),
  license_id uuid references public.licenses(id),
  artifact_sha256 text, issued_at timestamptz not null default now(),
  ip_address text, user_agent text,
  method text default 'zero-width-text', artifact_format text
);
create index fingerprints_lookup on public.fingerprints (fingerprint_code);
create index fingerprints_by_user on public.fingerprints (user_id);

-- per-buyer dataset canary rows (service-role only)
create table public.canaries (
  id uuid primary key default gen_random_uuid(),
  fingerprint_code text not null references public.fingerprints(fingerprint_code),
  product_id text not null references public.products(id),
  user_id uuid not null references public.profiles(id),
  canary_signature text not null, row_positions int[] not null default '{}',
  created_at timestamptz not null default now()
);
create index canaries_sig on public.canaries (canary_signature);

create table public.upvotes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (user_id, product_id)
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta int not null, reason text not null, product_id text references public.products(id),
  stripe_payment_intent text, created_at timestamptz not null default now()
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.profiles(id),
  period text not null, gross_cents bigint not null default 0,
  share_pct int not null, net_cents bigint not null default 0,
  status text not null default 'pending', stripe_transfer_id text,
  created_at timestamptz not null default now()
);

create table public.download_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  product_id text not null references public.products(id),
  fingerprint_id uuid references public.fingerprints(id),
  created_at timestamptz not null default now()
);

create table public.scan_reports (
  id uuid primary key default gen_random_uuid(),
  product_id text references public.products(id),
  submitted_by uuid references public.profiles(id),
  score int not null, verdict text not null,
  findings jsonb not null default '[]',
  dynamic_scan_status text not null default 'queued',
  engine_version text not null default 'static-2.0',
  created_at timestamptz not null default now()
);

create table public.takedowns (
  id uuid primary key default gen_random_uuid(),
  source_url text not null, platform text, matched_marker text,
  fingerprint_code text, matched_user_id uuid references public.profiles(id),
  product_id text references public.products(id),
  status text not null default 'detected', evidence jsonb,
  detected_at timestamptz not null default now(), filed_at timestamptz
);

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id), to_email text not null,
  template text not null, subject text not null,
  status text not null default 'sent', provider_id text, meta jsonb,
  created_at timestamptz not null default now()
);

create table public.payout_runs (
  id uuid primary key default gen_random_uuid(),
  period text not null, designers_paid int not null default 0,
  total_net_cents bigint not null default 0, mode text not null default 'demo',
  created_at timestamptz not null default now()
);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.licenses enable row level security;
alter table public.fingerprints enable row level security;   -- no policy = service-role only (intentional)
alter table public.canaries enable row level security;       -- no policy = service-role only (intentional)
alter table public.upvotes enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.payouts enable row level security;
alter table public.download_events enable row level security;
alter table public.scan_reports enable row level security;
alter table public.takedowns enable row level security;      -- no policy = service-role only (intentional)
alter table public.email_log enable row level security;
alter table public.payout_runs enable row level security;    -- no policy = service-role only (intentional)

create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "catalog public" on public.products for select using (published = true);
create policy "own licenses" on public.licenses for select using (auth.uid() = user_id);
create policy "upvotes read" on public.upvotes for select using (true);
create policy "upvotes insert own" on public.upvotes for insert with check (auth.uid() = user_id);
create policy "upvotes delete own" on public.upvotes for delete using (auth.uid() = user_id);
create policy "own ledger" on public.credit_ledger for select using (auth.uid() = user_id);
create policy "own payouts" on public.payouts for select using (auth.uid() = designer_id);
create policy "own downloads" on public.download_events for select using (auth.uid() = user_id);
create policy "own scan reports" on public.scan_reports for select using (auth.uid() = submitted_by);
create policy "own emails" on public.email_log for select using (auth.uid() = user_id);

-- triggers: auto-profile on signup, upvote counter, welcome email
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, handle)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
          'user_' || substr(new.id::text,1,8));
  return new;
end; $$;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create function public.sync_upvotes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.products set upvotes = upvotes + 1 where id = new.product_id;
  elsif tg_op = 'DELETE' then update public.products set upvotes = greatest(upvotes - 1, 0) where id = old.product_id; end if;
  return coalesce(new, old);
end; $$;
revoke execute on function public.sync_upvotes() from anon, authenticated, public;
create trigger on_upvote_change after insert or delete on public.upvotes for each row execute procedure public.sync_upvotes();

-- storage bucket for raw designer bundles (private)
insert into storage.buckets (id, name, public) values ('bundles','bundles', false) on conflict (id) do nothing;

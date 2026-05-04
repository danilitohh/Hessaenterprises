create extension if not exists pgcrypto;

create table if not exists public.gmail_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  redirect_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  google_sub text,
  encrypted_refresh_token text not null,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id)
);

create table if not exists public.gmail_send_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_connection_id uuid references public.gmail_connections(id) on delete set null,
  recipient text not null,
  subject text not null,
  client_name text,
  contact_number integer,
  scheduled_for timestamptz,
  gmail_message_id text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

alter table public.gmail_oauth_states enable row level security;
alter table public.gmail_connections enable row level security;
alter table public.gmail_send_logs enable row level security;

drop policy if exists "Users can view their Gmail connection" on public.gmail_connections;
create policy "Users can view their Gmail connection"
on public.gmail_connections
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view their Gmail send logs" on public.gmail_send_logs;
create policy "Users can view their Gmail send logs"
on public.gmail_send_logs
for select
to authenticated
using (auth.uid() = user_id);

create index if not exists gmail_oauth_states_expires_at_idx
on public.gmail_oauth_states (expires_at);

create index if not exists gmail_connections_user_active_idx
on public.gmail_connections (user_id)
where revoked_at is null;

create index if not exists gmail_send_logs_user_created_idx
on public.gmail_send_logs (user_id, created_at desc);

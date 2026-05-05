create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'user_role'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.user_role as enum (
      'super_admin',
      'owner',
      'admin',
      'staff',
      'viewer'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'account_plan'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.account_plan as enum (
      'free',
      'basic',
      'pro',
      'business'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'subscription_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.subscription_status as enum (
      'free',
      'trial',
      'active',
      'past_due',
      'cancelled',
      'suspended'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'account_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.account_status as enum (
      'active',
      'suspended'
    );
  end if;
end $$;

create table if not exists public.platform_super_admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.platform_super_admin_emails (email)
values
  ('kevin.hessam@gmail.com'),
  ('danilitohhh@gmail.com')
on conflict (email) do nothing;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  plan public.account_plan not null default 'free',
  subscription_status public.subscription_status not null default 'free',
  status public.account_status not null default 'active',
  trial_ends_at timestamptz,
  subscription_started_at timestamptz,
  subscription_ends_at timestamptz,
  billing_provider text,
  billing_customer_id text,
  billing_subscription_id text,
  billing_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_users (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.user_role not null default 'owner',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id),
  unique (user_id)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_accounts_updated_at on public.accounts;
create trigger touch_accounts_updated_at
before update on public.accounts
for each row
execute function public.touch_updated_at();

drop trigger if exists touch_account_users_updated_at on public.account_users;
create trigger touch_account_users_updated_at
before update on public.account_users
for each row
execute function public.touch_updated_at();

create or replace function public.is_platform_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_users
    where user_id = auth.uid()
      and role = 'super_admin'::public.user_role
  );
$$;

create or replace function public.can_access_account(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_super_admin()
    or exists (
      select 1
      from public.account_users
      where user_id = auth.uid()
        and account_id = target_account_id
    );
$$;

create or replace function public.has_account_role(
  target_account_id uuid,
  allowed_roles public.user_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_super_admin()
    or exists (
      select 1
      from public.account_users
      where user_id = auth.uid()
        and account_id = target_account_id
        and role = any(allowed_roles)
    );
$$;

create or replace function public.handle_new_user_account()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  next_account_id uuid;
  next_full_name text;
  next_role public.user_role;
begin
  if exists (
    select 1
    from public.account_users
    where user_id = new.id
  ) then
    return new;
  end if;

  next_full_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'Hessa user'), '@', 1),
    'Hessa user'
  );

  next_role := case
    when exists (
      select 1
      from public.platform_super_admin_emails
      where email = lower(coalesce(new.email, ''))
    ) then 'super_admin'::public.user_role
    else 'owner'::public.user_role
  end;

  insert into public.accounts (
    name,
    owner_user_id,
    plan,
    subscription_status,
    status,
    created_at,
    updated_at
  )
  values (
    next_full_name || ' Workspace',
    new.id,
    'free',
    'free',
    'active',
    coalesce(new.created_at, now()),
    now()
  )
  returning id into next_account_id;

  insert into public.account_users (
    account_id,
    user_id,
    email,
    full_name,
    role,
    joined_at,
    created_at,
    updated_at
  )
  values (
    next_account_id,
    new.id,
    lower(coalesce(new.email, '')),
    next_full_name,
    next_role,
    coalesce(new.created_at, now()),
    coalesce(new.created_at, now()),
    now()
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_account on auth.users;
create trigger on_auth_user_created_create_account
after insert on auth.users
for each row
execute function public.handle_new_user_account();

do $$
declare
  auth_user record;
  next_account_id uuid;
  next_full_name text;
  next_role public.user_role;
begin
  for auth_user in
    select id, email, raw_user_meta_data, created_at
    from auth.users
  loop
    if not exists (
      select 1
      from public.account_users
      where user_id = auth_user.id
    ) then
      next_full_name := coalesce(
        nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
        nullif(auth_user.raw_user_meta_data ->> 'name', ''),
        split_part(coalesce(auth_user.email, 'Hessa user'), '@', 1),
        'Hessa user'
      );

      next_role := case
        when exists (
          select 1
          from public.platform_super_admin_emails
          where email = lower(coalesce(auth_user.email, ''))
        ) then 'super_admin'::public.user_role
        else 'owner'::public.user_role
      end;

      insert into public.accounts (
        name,
        owner_user_id,
        plan,
        subscription_status,
        status,
        created_at,
        updated_at
      )
      values (
        next_full_name || ' Workspace',
        auth_user.id,
        'free',
        'free',
        'active',
        coalesce(auth_user.created_at, now()),
        now()
      )
      returning id into next_account_id;

      insert into public.account_users (
        account_id,
        user_id,
        email,
        full_name,
        role,
        joined_at,
        created_at,
        updated_at
      )
      values (
        next_account_id,
        auth_user.id,
        lower(coalesce(auth_user.email, '')),
        next_full_name,
        next_role,
        coalesce(auth_user.created_at, now()),
        coalesce(auth_user.created_at, now()),
        now()
      );
    end if;
  end loop;
end $$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  company text,
  notes text,
  status text not null default 'active'
    check (status in ('active', 'finished', 'canceled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  scheduled_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'completed', 'canceled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  value numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  status text not null default 'active'
    check (status in ('active', 'sent', 'pending', 'approved', 'declined', 'finished', 'canceled')),
  sent_at timestamptz,
  next_follow_up_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  proposal_id uuid references public.proposals(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  follow_up_type text not null check (follow_up_type in ('appointment', 'proposal')),
  sequence_number integer not null default 1 check (sequence_number > 0),
  scheduled_at timestamptz,
  sent_at timestamptz,
  subject text,
  body text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sent', 'failed', 'skipped', 'completed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  template_type text not null check (template_type in ('appointment', 'proposal')),
  step_number integer not null default 1 check (step_number > 0),
  title text not null,
  subject text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, template_type, step_number)
);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  proposal_id uuid references public.proposals(id) on delete set null,
  follow_up_id uuid references public.follow_ups(id) on delete set null,
  recipient text not null,
  subject text not null,
  provider text not null default 'gmail',
  provider_message_id text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'clients',
    'appointments',
    'proposals',
    'follow_ups',
    'email_templates'
  ]
  loop
    execute format('drop trigger if exists touch_%I_updated_at on public.%I', tenant_table, tenant_table);
    execute format(
      'create trigger touch_%I_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      tenant_table,
      tenant_table
    );
  end loop;
end $$;

alter table public.platform_super_admin_emails enable row level security;
alter table public.accounts enable row level security;
alter table public.account_users enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.proposals enable row level security;
alter table public.follow_ups enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_events enable row level security;

drop policy if exists "Super admins can manage platform admin emails" on public.platform_super_admin_emails;
create policy "Super admins can manage platform admin emails"
on public.platform_super_admin_emails
for all
to authenticated
using (public.is_platform_super_admin())
with check (public.is_platform_super_admin());

drop policy if exists "Members can view their account" on public.accounts;
create policy "Members can view their account"
on public.accounts
for select
to authenticated
using (public.can_access_account(id));

drop policy if exists "Super admins can manage accounts" on public.accounts;
create policy "Super admins can manage accounts"
on public.accounts
for update
to authenticated
using (public.is_platform_super_admin())
with check (public.is_platform_super_admin());

drop policy if exists "Members can view account users" on public.account_users;
create policy "Members can view account users"
on public.account_users
for select
to authenticated
using (public.can_access_account(account_id));

drop policy if exists "Owners and admins can invite account users" on public.account_users;
create policy "Owners and admins can invite account users"
on public.account_users
for insert
to authenticated
with check (
  public.has_account_role(
    account_id,
    array['owner'::public.user_role, 'admin'::public.user_role]
  )
  and (role <> 'super_admin'::public.user_role or public.is_platform_super_admin())
);

drop policy if exists "Owners and admins can update account users" on public.account_users;
create policy "Owners and admins can update account users"
on public.account_users
for update
to authenticated
using (
  public.has_account_role(
    account_id,
    array['owner'::public.user_role, 'admin'::public.user_role]
  )
  and (role <> 'super_admin'::public.user_role or public.is_platform_super_admin())
)
with check (
  public.has_account_role(
    account_id,
    array['owner'::public.user_role, 'admin'::public.user_role]
  )
  and (role <> 'super_admin'::public.user_role or public.is_platform_super_admin())
);

drop policy if exists "Owners and admins can remove account users" on public.account_users;
create policy "Owners and admins can remove account users"
on public.account_users
for delete
to authenticated
using (
  public.has_account_role(
    account_id,
    array['owner'::public.user_role, 'admin'::public.user_role]
  )
  and (role <> 'super_admin'::public.user_role or public.is_platform_super_admin())
);

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'clients',
    'appointments',
    'proposals',
    'follow_ups',
    'email_templates'
  ]
  loop
    execute format('drop policy if exists "Members can view %s" on public.%I', tenant_table, tenant_table);
    execute format(
      'create policy "Members can view %s" on public.%I for select to authenticated using (public.can_access_account(account_id))',
      tenant_table,
      tenant_table
    );

    execute format('drop policy if exists "Staff can create %s" on public.%I', tenant_table, tenant_table);
    execute format(
      'create policy "Staff can create %s" on public.%I for insert to authenticated with check (public.has_account_role(account_id, array[''owner''::public.user_role, ''admin''::public.user_role, ''staff''::public.user_role]))',
      tenant_table,
      tenant_table
    );

    execute format('drop policy if exists "Staff can update %s" on public.%I', tenant_table, tenant_table);
    execute format(
      'create policy "Staff can update %s" on public.%I for update to authenticated using (public.has_account_role(account_id, array[''owner''::public.user_role, ''admin''::public.user_role, ''staff''::public.user_role])) with check (public.has_account_role(account_id, array[''owner''::public.user_role, ''admin''::public.user_role, ''staff''::public.user_role]))',
      tenant_table,
      tenant_table
    );

    execute format('drop policy if exists "Admins can delete %s" on public.%I', tenant_table, tenant_table);
    execute format(
      'create policy "Admins can delete %s" on public.%I for delete to authenticated using (public.has_account_role(account_id, array[''owner''::public.user_role, ''admin''::public.user_role]))',
      tenant_table,
      tenant_table
    );
  end loop;
end $$;

drop policy if exists "Members can view email_events" on public.email_events;
create policy "Members can view email_events"
on public.email_events
for select
to authenticated
using (public.can_access_account(account_id));

alter table public.gmail_oauth_states
add column if not exists account_id uuid references public.accounts(id) on delete cascade;

alter table public.gmail_connections
add column if not exists account_id uuid references public.accounts(id) on delete cascade;

alter table public.gmail_send_logs
add column if not exists account_id uuid references public.accounts(id) on delete cascade;

update public.gmail_oauth_states as states
set account_id = account_users.account_id
from public.account_users
where states.account_id is null
  and states.user_id = account_users.user_id;

update public.gmail_connections as connections
set account_id = account_users.account_id
from public.account_users
where connections.account_id is null
  and connections.user_id = account_users.user_id;

update public.gmail_send_logs as logs
set account_id = account_users.account_id
from public.account_users
where logs.account_id is null
  and logs.user_id = account_users.user_id;

drop policy if exists "Users can view their Gmail connection" on public.gmail_connections;
create policy "Users can view their Gmail connection"
on public.gmail_connections
for select
to authenticated
using (auth.uid() = user_id or public.is_platform_super_admin());

drop policy if exists "Users can view their Gmail send logs" on public.gmail_send_logs;
create policy "Users can view their Gmail send logs"
on public.gmail_send_logs
for select
to authenticated
using (auth.uid() = user_id or public.can_access_account(account_id));

create index if not exists accounts_owner_user_idx on public.accounts (owner_user_id);
create index if not exists accounts_plan_status_idx on public.accounts (plan, subscription_status, status);
create index if not exists account_users_account_role_idx on public.account_users (account_id, role);
create index if not exists account_users_email_idx on public.account_users (email);
create index if not exists clients_account_status_idx on public.clients (account_id, status);
create index if not exists appointments_account_scheduled_idx on public.appointments (account_id, scheduled_at);
create index if not exists proposals_account_status_idx on public.proposals (account_id, status);
create index if not exists follow_ups_account_schedule_idx on public.follow_ups (account_id, scheduled_at, status);
create index if not exists email_templates_account_type_idx on public.email_templates (account_id, template_type, step_number);
create index if not exists email_events_account_created_idx on public.email_events (account_id, created_at desc);
create index if not exists gmail_oauth_states_account_idx on public.gmail_oauth_states (account_id);
create index if not exists gmail_connections_account_idx on public.gmail_connections (account_id);
create index if not exists gmail_send_logs_account_created_idx on public.gmail_send_logs (account_id, created_at desc);

grant select, update on public.accounts to authenticated;
grant select, insert, update, delete on public.account_users to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.proposals to authenticated;
grant select, insert, update, delete on public.follow_ups to authenticated;
grant select, insert, update, delete on public.email_templates to authenticated;
grant select on public.email_events to authenticated;
grant select on public.gmail_connections to authenticated;
grant select on public.gmail_send_logs to authenticated;

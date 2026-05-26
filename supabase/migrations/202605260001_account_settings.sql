create table if not exists public.account_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  sender_from_email text not null default '',
  sender_from_name text not null default 'Hessa Enterprises',
  interval_days integer not null default 2 check (interval_days > 0),
  auto_open_draft_on_create boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.account_settings (account_id)
select id
from public.accounts
on conflict (account_id) do nothing;

drop trigger if exists touch_account_settings_updated_at on public.account_settings;
create trigger touch_account_settings_updated_at
before update on public.account_settings
for each row
execute function public.touch_updated_at();

alter table public.account_settings enable row level security;

drop policy if exists "Members can view account settings" on public.account_settings;
create policy "Members can view account settings"
on public.account_settings
for select
to authenticated
using (public.can_access_account(account_id));

drop policy if exists "Staff can create account settings" on public.account_settings;
create policy "Staff can create account settings"
on public.account_settings
for insert
to authenticated
with check (
  public.has_account_role(
    account_id,
    array['owner'::public.user_role, 'admin'::public.user_role, 'staff'::public.user_role]
  )
);

drop policy if exists "Staff can update account settings" on public.account_settings;
create policy "Staff can update account settings"
on public.account_settings
for update
to authenticated
using (
  public.has_account_role(
    account_id,
    array['owner'::public.user_role, 'admin'::public.user_role, 'staff'::public.user_role]
  )
)
with check (
  public.has_account_role(
    account_id,
    array['owner'::public.user_role, 'admin'::public.user_role, 'staff'::public.user_role]
  )
);

drop policy if exists "Admins can delete account settings" on public.account_settings;
create policy "Admins can delete account settings"
on public.account_settings
for delete
to authenticated
using (
  public.has_account_role(
    account_id,
    array['owner'::public.user_role, 'admin'::public.user_role]
  )
);

create index if not exists account_settings_updated_idx
on public.account_settings (updated_at desc);

grant select, insert, update, delete on public.account_settings to authenticated;

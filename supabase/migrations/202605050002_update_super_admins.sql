create extension if not exists pgcrypto;

create table if not exists public.platform_super_admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.platform_super_admin_emails (email)
values
  ('kevin.hessam@gmail.com'),
  ('danilitohhh@gmail.com')
on conflict (email) do nothing;

delete from public.platform_super_admin_emails
where email not in (
  'kevin.hessam@gmail.com',
  'danilitohhh@gmail.com'
);

alter table if exists public.accounts
add column if not exists billing_provider text;

alter table if exists public.accounts
add column if not exists billing_customer_id text;

alter table if exists public.accounts
add column if not exists billing_subscription_id text;

alter table if exists public.accounts
add column if not exists billing_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if to_regclass('public.account_users') is not null then
    update public.account_users
    set
      role = 'super_admin'::public.user_role,
      updated_at = now()
    where lower(email) in (
      'kevin.hessam@gmail.com',
      'danilitohhh@gmail.com'
    );

    update public.account_users
    set
      role = 'owner'::public.user_role,
      updated_at = now()
    where role = 'super_admin'::public.user_role
      and lower(email) not in (
        'kevin.hessam@gmail.com',
        'danilitohhh@gmail.com'
      );
  end if;
end $$;

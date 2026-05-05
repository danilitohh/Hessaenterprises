create extension if not exists pgcrypto;

create table if not exists public.plan_pricing (
  plan public.account_plan primary key,
  currency text not null default 'USD',
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  annual_price_cents integer not null default 0 check (annual_price_cents >= 0),
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  is_coming_soon boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plan_pricing (plan)
values
  ('free'),
  ('basic'),
  ('pro'),
  ('business')
on conflict (plan) do nothing;

drop trigger if exists touch_plan_pricing_updated_at on public.plan_pricing;
create trigger touch_plan_pricing_updated_at
before update on public.plan_pricing
for each row
execute function public.touch_updated_at();

alter table public.plan_pricing enable row level security;

drop policy if exists "Super admins can manage plan pricing" on public.plan_pricing;
create policy "Super admins can manage plan pricing"
on public.plan_pricing
for all
to authenticated
using (public.is_platform_super_admin())
with check (public.is_platform_super_admin());

create index if not exists plan_pricing_updated_idx on public.plan_pricing (updated_at desc);

grant select, insert, update, delete on public.plan_pricing to authenticated;

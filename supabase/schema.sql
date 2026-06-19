-- supabase/schema.sql

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Organizations Table
create table public.organizations (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Users Table (extends auth.users)
create table public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    organization_id uuid references public.organizations(id) on delete cascade,
    role text check (role in ('superadmin', 'admin', 'member')) not null default 'member',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Products Table
create table public.products (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid references public.organizations(id) on delete cascade not null,
    name text not null,
    description text,
    rate numeric(10,2) default 0.00,
    weight_grams integer default 0,
    package_dimensions text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Shipping Batches
create table public.shipping_batches (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid references public.organizations(id) on delete cascade not null,
    batch_date date not null default current_date,
    note text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Orders Table
create table public.orders (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid references public.organizations(id) on delete cascade not null,
    customer_name text not null,
    phone text,
    address_raw text not null,
    address_formatted text,
    product_id uuid references public.products(id) on delete set null,
    status text check (status in ('yet_to_ship', 'shipped')) not null default 'yet_to_ship',
    batch_id uuid references public.shipping_batches(id) on delete set null,
    tracking_id text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Tracking IDs Table (Managed by Admin)
create table public.tracking_ids (
    id uuid primary key default uuid_generate_v4(),
    code text not null unique,
    organization_id uuid references public.organizations(id) on delete set null,
    is_assigned boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 7. Scanned Labels
create table public.scanned_labels (
    id uuid primary key default uuid_generate_v4(),
    admin_user_id uuid references public.users(id) on delete set null,
    organization_id uuid references public.organizations(id) on delete cascade not null,
    from_address text not null,
    to_address text not null,
    product_weight numeric(10,2),
    product_dimensions text,
    batch_id uuid references public.shipping_batches(id) on delete set null,
    scanned_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Row Level Security (RLS) Configuration

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.shipping_batches enable row level security;
alter table public.orders enable row level security;
alter table public.tracking_ids enable row level security;
alter table public.scanned_labels enable row level security;

-- Setup RLS Policies

-- Secure Functions to fetch user attributes without triggering RLS recursively
create or replace function public.get_auth_user_role()
returns text
language plpgsql security definer set search_path = public
as $$
declare user_role text;
begin
  select role into user_role from public.users where id = auth.uid();
  return user_role;
end;
$$;

create or replace function public.get_auth_user_org()
returns uuid
language plpgsql security definer set search_path = public
as $$
declare org_id uuid;
begin
  select organization_id into org_id from public.users where id = auth.uid();
  return org_id;
end;
$$;

-- Users can view their own organization, superadmin views all
create policy "Users can view their organization"
on public.organizations for select
using (
    id = public.get_auth_user_org() OR
    public.get_auth_user_role() = 'superadmin'
);

-- Superadmins can insert/update organizations
create policy "Superadmins can manage organizations"
on public.organizations for all
using (public.get_auth_user_role() = 'superadmin');

-- Users can view their own user profile, superadmin views all, and org members view each other
create policy "Users can view users"
on public.users for select
using (
    id = auth.uid() OR 
    public.get_auth_user_role() = 'superadmin' OR
    (organization_id is not null and organization_id = public.get_auth_user_org())
);

-- Admins can update roles of users in their organization
create policy "Admins can update org members"
on public.users for update
using (
  (public.get_auth_user_role() = 'admin' AND organization_id = public.get_auth_user_org()) OR
  public.get_auth_user_role() = 'superadmin'
);

-- Products RLS
create policy "Org members can select products"
on public.products for select
using (organization_id in (select organization_id from public.users where id = auth.uid()));

create policy "Org members can insert products"
on public.products for insert
with check (organization_id in (select organization_id from public.users where id = auth.uid()));

-- Orders RLS
create policy "Org members can select orders"
on public.orders for select
using (organization_id in (select organization_id from public.users where id = auth.uid()));

create policy "Org members can insert orders"
on public.orders for insert
with check (organization_id in (select organization_id from public.users where id = auth.uid()));

create policy "Org members can update orders"
on public.orders for update
using (organization_id in (select organization_id from public.users where id = auth.uid()));

-- Shipping Batches RLS
create policy "Org members can select batches"
on public.shipping_batches for select
using (organization_id in (select organization_id from public.users where id = auth.uid()));

create policy "Org members can insert batches"
on public.shipping_batches for insert
with check (organization_id in (select organization_id from public.users where id = auth.uid()));

-- Tracking IDs (Admin can assign, members can select their assigned)
create policy "Admins can manage tracking_ids, members see assigned"
on public.tracking_ids for select
using (
    organization_id in (select organization_id from public.users where id = auth.uid()) OR
    (select role from public.users where id = auth.uid()) = 'admin'
);

-- Scanned Labels RLS
create policy "Org members can view scanned labels"
on public.scanned_labels for select
using (organization_id in (select organization_id from public.users where id = auth.uid()));

create policy "Admins can insert scanned labels"
on public.scanned_labels for insert
with check ((select role from public.users where id = auth.uid()) = 'admin');

-- 8. User Invitations Table (Managed by Super Admin)
create table public.user_invites (
    id uuid primary key default uuid_generate_v4(),
    email text not null unique,
    organization_id uuid references public.organizations(id) on delete cascade not null,
    role text check (role in ('superadmin', 'admin', 'member')) not null default 'member',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on invites 
alter table public.user_invites enable row level security;

create policy "Superadmins can manage invites"
on public.user_invites for all
using ((select role from public.users where id = auth.uid()) = 'superadmin');

-- 9. Auto-provisioning new users based on Whitelist
-- This trigger automatically checks if the new user's email is on the invite list.
-- If yes, assigns them to the org. If no, assigns them to a null org (blocked).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
    invite_record record;
begin
    -- Check if the email exists in the whitelist
    select * into invite_record from public.user_invites where email = new.email;

    if found then
        -- Email is whitelisted: Create user in the assigned organization
        insert into public.users (id, organization_id, role)
        values (new.id, invite_record.organization_id, invite_record.role);
    else
        -- Email NOT whitelisted: Create generic user with NO organization (blocked)
        insert into public.users (id, organization_id, role)
        values (new.id, null, 'member');
    end if;

    return new;
end;
$$;

-- Drop trigger if it exists
drop trigger if exists on_auth_user_created on auth.users;

-- Create the trigger
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

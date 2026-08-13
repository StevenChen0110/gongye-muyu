-- 共業木魚 — Supabase schema
-- 整段貼進 Supabase SQL Editor 執行。可重複執行（都有 if not exists / or replace）。

-- ── 匿名使用者 ────────────────────────────────────────────
-- 沒有登入。id 由前端產生後存在 localStorage，用來認人與累積敲擊數。
create table if not exists users (
  id uuid primary key,
  nickname text not null,
  knock_count integer not null default 0,
  created_at timestamptz default now()
);

-- ── 群組 ──────────────────────────────────────────────────
-- 一群人針對同一件事一起敲。code 是分享用的邀請碼。
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  knock_count integer not null default 0,
  created_at timestamptz default now()
);

-- ── 敲擊 ──────────────────────────────────────────────────
create table if not exists knocks (
  id bigint generated always as identity primary key,
  sin text,
  created_at timestamptz default now()
);

-- 從舊版 schema 升上來
alter table knocks add column if not exists user_id uuid references users (id) on delete set null;
alter table knocks add column if not exists group_id uuid references groups (id) on delete cascade;
alter table knocks add column if not exists fish text;
-- 群組模式沒有「口業」，所以 sin 要可以為空
alter table knocks alter column sin drop not null;

create index if not exists knocks_id_desc_idx on knocks (id desc);
create index if not exists knocks_group_idx on knocks (group_id, id desc);
create index if not exists users_rank_idx on users (knock_count desc);

-- ── 計數 ──────────────────────────────────────────────────
-- 排行榜不即時 count(*)，改用 trigger 維護計數。
-- security definer：讓它以擁有者身分執行，才能在匿名 RLS 下更新
-- users / groups——前端本身沒有 update 權限，所以偽造不了排行。
create or replace function bump_knock_counts() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update users set knock_count = knock_count + 1 where id = new.user_id;
  end if;
  if new.group_id is not null then
    update groups set knock_count = knock_count + 1 where id = new.group_id;
  end if;
  return new;
end;
$$;

drop trigger if exists knocks_bump_counts on knocks;
create trigger knocks_bump_counts
  after insert on knocks
  for each row execute function bump_knock_counts();

-- ── RLS ───────────────────────────────────────────────────
alter table users enable row level security;
alter table groups enable row level security;
alter table knocks enable row level security;

-- 任何人可讀（排行榜要讀暱稱、群組要讀標題）
drop policy if exists "read users" on users;
create policy "read users" on users for select using (true);

drop policy if exists "read groups" on groups;
create policy "read groups" on groups for select using (true);

drop policy if exists "read knocks" on knocks;
create policy "read knocks" on knocks for select using (true);

-- 任何人可新增（匿名，無登入）
drop policy if exists "insert users" on users;
create policy "insert users" on users for insert with check (true);

drop policy if exists "insert groups" on groups;
create policy "insert groups" on groups for insert with check (true);

drop policy if exists "insert knocks" on knocks;
create policy "insert knocks" on knocks for insert with check (true);

-- 刻意不給 update / delete：暱稱與計數都不能被前端改。

-- ── Realtime ──────────────────────────────────────────────
-- 重複執行會報 already member，可忽略。
alter publication supabase_realtime add table knocks;

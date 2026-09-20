-- 淨心木魚 — Supabase schema
-- 整段貼進 Supabase SQL Editor 執行。可重複執行（都有 if not exists / or replace）。
--
-- 這份檔案就是線上 DB 的真相，改 schema 請同步改這裡。

-- ── 匿名使用者 ────────────────────────────────────────────
-- 預設沒有登入：id 由前端產生後存在 localStorage，用來認人與累積敲擊數。
-- 登入之後 auth_id 會指向 auth.users，換裝置就找得回同一個身分。
create table if not exists users (
  id uuid primary key,
  nickname text not null,
  knock_count integer not null default 0,
  created_at timestamptz default now()
);

alter table users add column if not exists auth_id uuid unique references auth.users (id) on delete set null;
create index if not exists users_auth_idx on users (auth_id);

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

-- 自動敲一分鐘可以敲上百下，一下一筆會灌爆寫入與 realtime。
-- count 讓一筆代表多下，前端批次寫出去。
alter table knocks add column if not exists count integer not null default 1;
do $$
begin
  alter table knocks add constraint knocks_count_sane check (count between 1 and 5000);
exception when duplicate_object then null;
end $$;

-- manual / auto / ritual。公開 feed 只看 manual——自動敲不該洗掉真人的懺悔，
-- 超渡的內容比較私人，也不進 feed。
alter table knocks add column if not exists source text not null default 'manual';

create index if not exists knocks_id_desc_idx on knocks (id desc);
create index if not exists knocks_group_idx on knocks (group_id, id desc);
create index if not exists knocks_feed_idx on knocks (source, id desc);
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
  -- 加 new.count 而不是 1：一筆可能代表自動敲的好幾十下
  if new.user_id is not null then
    update users set knock_count = knock_count + new.count where id = new.user_id;
  end if;
  if new.group_id is not null then
    update groups set knock_count = knock_count + new.count where id = new.group_id;
  end if;
  return new;
end;
$$;

revoke execute on function bump_knock_counts() from public, anon, authenticated;

drop trigger if exists knocks_bump_counts on knocks;
create trigger knocks_bump_counts
  after insert on knocks
  for each row execute function bump_knock_counts();

-- ── 身分收編 ──────────────────────────────────────────────
-- 登入後把 localStorage 那顆匿名 uuid 綁到帳號上。
--
-- 為什麼是 security definer + RPC 而不是開一條 update policy：
-- 前端一旦能 update users，就能改別人的 nickname 和 knock_count。
create or replace function claim_identity(anon_id uuid, fallback_nickname text default null)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mine users;
  anon users;
begin
  if uid is null then
    raise exception '未登入' using errcode = '28000';
  end if;

  select * into mine from users where auth_id = uid;
  select * into anon from users where id = anon_id and auth_id is null;

  -- 第一次登入：直接收編這台裝置的匿名紀錄，累積的功德跟著過來
  if mine.id is null and anon.id is not null then
    update users set auth_id = uid where id = anon.id returning * into mine;
    return mine;
  end if;

  -- 全新帳號，這台裝置也沒有可收編的匿名紀錄
  if mine.id is null then
    insert into users (id, nickname, auth_id)
    values (uid, coalesce(nullif(fallback_nickname, ''), '無名的香客'), uid)
    on conflict (id) do update set auth_id = uid
    returning * into mine;
    return mine;
  end if;

  -- 已經有帳號，但在這台裝置又匿名敲了一陣子 → 併過去再清掉那筆
  if anon.id is not null and anon.id <> mine.id then
    update knocks set user_id = mine.id where user_id = anon.id;
    update users set knock_count = mine.knock_count + anon.knock_count
      where id = mine.id returning * into mine;
    delete from users where id = anon.id;
  end if;

  return mine;
end;
$$;

revoke execute on function claim_identity(uuid, text) from public, anon;
grant execute on function claim_identity(uuid, text) to authenticated;

-- ── 改暱稱 ────────────────────────────────────────────────
-- 一樣包成函式而不是開 update policy，這裡只准動 nickname 一個欄位。
-- 匿名身分不能改名（產品決定：註冊後才行）。
create or replace function set_nickname(target uuid, new_nickname text)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row users;
  name text := btrim(regexp_replace(coalesce(new_nickname, ''), '\s+', ' ', 'g'));
begin
  if uid is null then
    raise exception '要先登入才能改暱稱' using errcode = '28000';
  end if;
  if name = '' then
    raise exception '暱稱不能是空的' using errcode = '22023';
  end if;
  if char_length(name) > 12 then
    raise exception '暱稱最多 12 個字' using errcode = '22023';
  end if;

  select * into row from users where auth_id = uid;
  if row.id is null then
    raise exception '這個帳號還沒有身分' using errcode = 'P0002';
  end if;
  if target is not null and target <> row.id then
    raise exception '不是你的身分' using errcode = '42501';
  end if;

  update users set nickname = name where id = row.id returning * into row;
  return row;
end;
$$;

revoke execute on function set_nickname(uuid, text) from public, anon;
grant execute on function set_nickname(uuid, text) to authenticated;

-- ── 功德簿統計 ────────────────────────────────────────────
-- 全部在 DB 算完再回傳一包 json：敲上千下之後，把整串 knocks 拉回前端
-- 再自己 group by 是不划算的。
--
-- 注意所有「幾下」的統計都是 sum(count) 而不是 count(*)——一筆可能代表
-- 自動敲的好幾十下，用 count(*) 會跟 users.knock_count 分岔。
create or replace function knock_stats(target uuid)
returns json
language sql
stable
set search_path = public
as $$
with mine as (
  select
    id,
    sin,
    fish,
    group_id,
    count,
    created_at at time zone 'Asia/Taipei' as local_at
  from knocks
  where user_id = target
),
days as (
  select distinct local_at::date as d from mine
),
-- 連續日：日期減掉序號，同一段連續期間會落在同一個 grp
runs as (
  select d, d - (row_number() over (order by d))::int as grp from days
),
current_run as (
  select count(*) as len
  from runs
  where grp = (select grp from runs order by d desc limit 1)
    -- 斷了就不算：最後一天要是今天或昨天
    and (select max(d) from days) >= (now() at time zone 'Asia/Taipei')::date - 1
),
top as (
  select sin, sum(count) as n
  from mine
  where sin is not null
  group by sin
  order by n desc, sin
  limit 1
)
select json_build_object(
  'total', (select coalesce(sum(count), 0) from mine),
  'today', (select coalesce(sum(count), 0) from mine
            where local_at::date = (now() at time zone 'Asia/Taipei')::date),
  'streak', coalesce((select len from current_run), 0),
  'days', (select count(*) from days),
  'sins', (select count(distinct sin) from mine where sin is not null),
  'customs', (select count(distinct sin) from mine where sin like 'custom:%'),
  -- fish 存的是「尺寸-木材」，木材是後半段
  'woods', (select count(distinct split_part(fish, '-', 2)) from mine where fish is not null),
  'groups', (select coalesce(sum(count), 0) from mine where group_id is not null),
  'nights', (select coalesce(sum(count), 0) from mine
             where extract(hour from local_at) < 5),
  'top_sin', (select sin from top),
  'first_at', (select min(local_at) from mine),
  'joined', (select created_at from users where id = target)
);
$$;

grant execute on function knock_stats(uuid) to anon, authenticated;

-- ── 全站總數 ──────────────────────────────────────────────
-- 「大家一共敲了幾下」。要的是下數不是筆數——一筆可能代表自動敲的好幾十下。
create or replace function total_knocks()
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(sum(count), 0)::bigint from knocks;
$$;

grant execute on function total_knocks() to anon, authenticated;

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
-- 重複執行會報 already member，所以包起來忽略。
do $$
begin
  alter publication supabase_realtime add table knocks;
exception when duplicate_object then null;
end $$;

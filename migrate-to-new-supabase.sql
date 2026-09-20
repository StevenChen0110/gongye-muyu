-- ════════════════════════════════════════════════════════════
-- 淨心木魚 — 搬到新的 Supabase 專案
--
-- 用法：Supabase Dashboard → SQL Editor → 整份貼上 → Run
-- 可以重複執行（都有 if not exists / or replace）。
--
-- 第一段是 schema（跟 repo 的 supabase.sql 一模一樣），
-- 第二段是舊庫搬過來的 5 位施主 / 186 下敲擊。
-- ════════════════════════════════════════════════════════════

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

-- ── 刪除帳號 ──────────────────────────────────────────────
-- Apple 上架硬性要求 App 內要能刪帳號（不能只給客服信箱），GDPR / 個資法
-- 也是同樣的要求。
--
-- 策略是匿名化而不是全刪：knocks 留著但 user_id 設成 null，所以「大家一共」
-- 不會當場少一截（那是全站共有的數字，別人也看得到），但這個人的暱稱、
-- auth 帳號、個人統計全部消失，任何一筆都追不回本人。
create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mine users;
begin
  if uid is null then
    raise exception '未登入' using errcode = '28000';
  end if;

  select * into mine from users where auth_id = uid;

  if mine.id is not null then
    -- 先把敲擊跟這個人脫鉤。on delete set null 也會做，但寫明確一點，
    -- 而且這樣即使將來改了 FK 行為也不會突然變成連敲擊一起刪。
    update knocks set user_id = null where user_id = mine.id;
    delete from users where id = mine.id;
  end if;

  -- 最後才刪 auth 帳號：這一步成功之後 uid 就失效了
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function delete_account() from public, anon;
grant execute on function delete_account() to authenticated;

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



-- ════════════════════════════════════════════════════════════
-- 舊庫搬過來的資料：5 位施主 / 186 下
-- ════════════════════════════════════════════════════════════

-- users 的 knock_count 先給 0：下面插 knocks 時 trigger 會自己累加，
-- 這裡若填真實數字會變成兩倍。
insert into users (id, nickname, knock_count, created_at) values
  ('3635608c-7925-46d2-971a-565805b99cfe', 'Steven', 0, '2026-08-09T15:22:03.83872+00:00'),
  ('5bcecb6d-097e-4d39-866b-4393daa28ff5', '好氣的居士', 0, '2026-08-09T16:05:37.64395+00:00'),
  ('42c25fe0-2f7e-48b9-947c-28d2b81ae477', '心軟的凡人', 0, '2026-08-09T16:11:07.066997+00:00'),
  ('2e887143-19a1-4848-8fdd-68bf5ab134ec', '嘴硬小沙彌', 0, '2026-08-09T16:44:49.578088+00:00'),
  ('59bd76b1-30a6-4b7e-a53b-5abf33fc5941', '嘴硬的路人', 0, '2026-08-13T15:20:09.33822+00:00')
on conflict (id) do nothing;

insert into knocks (sin, user_id, fish, count, source, created_at) values
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:03.352441+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:03.794248+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:04.250194+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:04.959481+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:05.560425+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:06.189277+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:06.620642+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:07.152109+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:07.69962+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:08.256781+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:08.827659+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:09.331557+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:09.903194+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:10.42349+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:10.988618+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:11.540646+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:12.032442+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:12.637854+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:13.195739+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:13.711145+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:14.35161+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:14.870179+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:19.21933+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:19.603683+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:19.994549+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:20.373071+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:20.783196+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:21.119116+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:21.424067+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:21.788235+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:22.122645+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:22.45907+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:22.823318+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:23.177855+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:23.567176+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:23.933516+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:24.278516+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:24.909309+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:25.400088+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:25.910204+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:26.436636+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:26.914765+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:27.391019+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:27.869994+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:28.332398+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-09T15:47:28.782967+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:11:58.335232+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:11:59.221735+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:05.190634+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:05.562667+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:06.182085+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:06.730143+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:07.182872+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:07.642666+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:07.988948+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:08.725018+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:09.048145+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:09.349134+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:10.043751+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:10.571348+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:11.023124+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:11.451124+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:11.916039+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:12.343087+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:13.000098+00:00'),
  ('gossip', '42c25fe0-2f7e-48b9-947c-28d2b81ae477', 'medium-rosewood', 1, 'manual', '2026-08-09T16:12:13.664435+00:00'),
  ('complain', '2e887143-19a1-4848-8fdd-68bf5ab134ec', 'medium-camphor', 1, 'manual', '2026-08-09T16:45:00.450028+00:00'),
  ('complain', '2e887143-19a1-4848-8fdd-68bf5ab134ec', 'medium-camphor', 1, 'manual', '2026-08-09T16:45:01.879167+00:00'),
  ('complain', '2e887143-19a1-4848-8fdd-68bf5ab134ec', 'medium-rosewood', 1, 'manual', '2026-08-09T16:45:17.681504+00:00'),
  ('complain', '2e887143-19a1-4848-8fdd-68bf5ab134ec', 'large-rosewood', 1, 'manual', '2026-08-09T16:45:18.477921+00:00'),
  ('complain', '2e887143-19a1-4848-8fdd-68bf5ab134ec', 'large-rosewood', 1, 'manual', '2026-08-09T16:45:19.20847+00:00'),
  ('complain', '2e887143-19a1-4848-8fdd-68bf5ab134ec', 'large-rosewood', 1, 'manual', '2026-08-09T16:45:19.590232+00:00'),
  ('complain', '2e887143-19a1-4848-8fdd-68bf5ab134ec', 'large-rosewood', 1, 'manual', '2026-08-09T16:45:19.896168+00:00'),
  ('complain', '2e887143-19a1-4848-8fdd-68bf5ab134ec', 'large-rosewood', 1, 'manual', '2026-08-09T16:45:27.436165+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:26:56.611683+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:26:57.035402+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:26:57.498697+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:26:58.304714+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:26:58.637811+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:00.424269+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:00.818307+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:01.176102+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:01.497767+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:01.922506+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:02.328483+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:02.608749+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:03.063765+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:03.607168+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:04.180128+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:04.729435+00:00'),
  (NULL, '5bcecb6d-097e-4d39-866b-4393daa28ff5', 'medium-camphor', 1, 'manual', '2026-08-11T15:27:05.251672+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-13T15:21:58.874213+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-13T15:21:59.367963+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-13T15:21:59.987842+00:00'),
  ('gossip', '3635608c-7925-46d2-971a-565805b99cfe', 'medium-camphor', 1, 'manual', '2026-08-13T15:22:00.598168+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:05.91839+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:06.699947+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:07.220425+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:07.674511+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:08.245446+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:08.785753+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:09.181276+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:09.724771+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:10.287253+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:10.79003+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:11.266676+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:11.784851+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:12.288413+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:12.84503+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:13.391159+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:16.799591+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:17.131958+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:17.534971+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:17.863088+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:18.557985+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:18.904106+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:19.370249+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:19.739443+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:20.141266+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:26.705735+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:27.157953+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:27.52264+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:28.141412+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:28.690419+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:30.655539+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:31.221612+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:31.759592+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:32.203924+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:32.671493+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:33.275678+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:44:33.794503+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:46:22.260233+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:46:22.259501+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:46:22.560189+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:46:22.899194+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:46:23.270764+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-18T12:46:23.680566+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:11.643097+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:11.976342+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:13.963802+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:14.336415+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:16.296465+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:28.685205+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:28.922386+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:30.052317+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:30.377386+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:31.865737+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:32.569886+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:32.976401+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:33.260656+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:33.667996+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-rosewood', 1, 'manual', '2026-08-22T15:30:34.008622+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-cypress', 1, 'manual', '2026-08-22T15:30:36.328337+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-cypress', 1, 'manual', '2026-08-22T15:30:36.824883+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-cypress', 1, 'manual', '2026-08-22T15:30:37.225646+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-cypress', 1, 'manual', '2026-08-22T15:30:37.572972+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-cypress', 1, 'manual', '2026-08-22T15:30:39.924638+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-cypress', 1, 'manual', '2026-08-22T15:30:40.270966+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-cypress', 1, 'manual', '2026-08-22T15:30:40.648957+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-cypress', 1, 'manual', '2026-08-22T15:30:41.044105+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-camphor', 1, 'manual', '2026-08-22T15:30:41.503935+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-camphor', 1, 'manual', '2026-08-22T15:30:41.941097+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'medium-camphor', 1, 'manual', '2026-08-22T15:30:42.702615+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-08-22T15:30:43.305919+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-08-22T15:30:43.709063+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-08-23T12:44:56.210753+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-08-23T12:44:56.251527+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-08-23T12:44:56.665838+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:11.070397+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:11.359482+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:11.830017+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:13.12315+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:13.51969+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:13.998654+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:14.493251+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:14.816815+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:15.212226+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:16.010577+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:17.143424+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:17.562525+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:17.982715+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:18.290362+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:18.830347+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:21.417731+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'large-camphor', 1, 'manual', '2026-09-19T13:54:22.517109+00:00'),
  ('complain', '59bd76b1-30a6-4b7e-a53b-5abf33fc5941', 'small-camphor', 1, 'manual', '2026-09-19T13:54:26.268118+00:00');

-- 保險：把計數重算一次，確保跟 knocks 完全對得起來
update users u set knock_count = coalesce(
  (select sum(k.count) from knocks k where k.user_id = u.id), 0);

-- 驗收
select
  (select count(*) from users) as 施主,
  (select count(*) from knocks) as 敲擊筆數,
  total_knocks() as 大家一共,
  (select coalesce(sum(knock_count), 0) from users) as 計數加總;

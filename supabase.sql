-- 共業木魚 — Supabase 建表 / RLS / Realtime
-- 直接整段貼進 Supabase SQL Editor 執行即可。

create table if not exists knocks (
  id bigint generated always as identity primary key,
  sin text not null,              -- 使用者選的罐頭口業（存 id，例如 'gossip'）
  created_at timestamptz default now()
);

-- feed 依 id 由新到舊撈，加個索引
create index if not exists knocks_id_desc_idx on knocks (id desc);

alter table knocks enable row level security;

-- 任何人可讀
drop policy if exists "anyone can read" on knocks;
create policy "anyone can read" on knocks for select using (true);

-- 任何人可新增（匿名，無登入）
-- 注意：MVP 開放匿名寫入，前端有 300ms rate limit；要更嚴格可改成 Edge Function 代寫。
drop policy if exists "anyone can insert" on knocks;
create policy "anyone can insert" on knocks for insert with check (true);

-- 開啟 Realtime（重複執行會報 already member，可忽略）
alter publication supabase_realtime add table knocks;

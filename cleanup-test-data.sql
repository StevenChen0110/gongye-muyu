-- 清掉搬家驗證時產生的測試資料。
-- 在 Supabase SQL Editor 執行一次即可，之後可以把這個檔案刪掉。
--
-- 前端沒有 delete 權限（RLS 刻意不給），所以只能從這裡清。

-- 驗證時敲的那幾下（原始資料是 id 1~186）
delete from knocks where id > 186;

-- 驗證時自動產生的匿名身分（沒有登入、也沒有留下任何敲擊的）
delete from users u
where u.auth_id is null
  and u.created_at > '2026-09-20'
  and not exists (select 1 from knocks k where k.user_id = u.id);

-- 保險：計數重算，確保跟 knocks 對得起來
update users u set knock_count = coalesce(
  (select sum(k.count) from knocks k where k.user_id = u.id), 0);

-- 驗收：應該回到 5 / 186 / 186 / 186
select
  (select count(*) from users) as 施主,
  (select count(*) from knocks) as 敲擊筆數,
  total_knocks() as 大家一共,
  (select coalesce(sum(knock_count), 0) from users) as 計數加總;

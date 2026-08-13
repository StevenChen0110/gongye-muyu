# 淨心木魚

一個線上木魚。分三種使用情境：

| 分頁 | 做什麼 |
| --- | --- |
| **自己敲** | 想敲就敲，選一個自己剛犯的口業，累積自己的功德 |
| **一起敲** | 開一個群，寫下大家要一起敲的那件事，用邀請碼把人拉進來一起敲 |
| **排行** | 看所有人裡誰敲得最勤 |

**沒有登入。** 身分是存在 localStorage 的一組匿名 id，配一個自動產生的暱稱（例如「嘴快的香客」）。代價要講清楚：**換瀏覽器或清掉 localStorage 就會變成另一個人，累積的敲擊數找不回來。** 要真正跨裝置就得做登入，那是這一版刻意不做的事。

## 木魚

**尺寸 × 木材** 的交集，3 × 3 = 9 種。選了之後聲音和長相都會變。

| 尺寸 | 聲音 |
| --- | --- |
| 手持 | 音高 ×1.72、衰減 ×0.6 —— 小巧清脆 |
| 中型 | 基準（245Hz） |
| 大殿 | 音高 ×0.58、衰減 ×1.8 —— 低沉綿長 |

| 木材 | 聲音與顏色 |
| --- | --- |
| 樟木 | 溫和居中，廟裡最常見。中間色的棕 |
| 檜木 | 質地軟 → 低通 3.1kHz、槌頭鈍、衰減 ×1.25。偏黃的淺色 |
| 花梨木 | 硬且密 → 低通 7kHz、槌頭亮、衰減 ×0.78、分音更多。深紅棕 |

要加木材就往 [`src/lib/fish.ts`](src/lib/fish.ts) 的 `WOODS` 加一筆，聲音與配色會自動接上，不用改別的地方。

## 震動

敲的時候會震（`navigator.vibrate`），毫秒數跟著木魚大小走：手持 16ms、中型 28ms、大殿 48ms。有可關閉的開關，設定存 localStorage。

**iOS Safari 完全不支援 Vibration API**，所以 iPhone 上不會震 —— 這是瀏覽器限制，只有原生 App 才能觸發震動。因此偵測到不支援時，UI 會直接顯示「此裝置不支援震動」而不是給一顆按了沒反應的開關。Android Chrome 正常。

## 技術

- SvelteKit 2 + Svelte 5 (runes) + TypeScript
- Supabase（Postgres + Realtime），匿名寫入
- 木魚聲用 Web Audio API 即時合成，無音檔
- 部署：Vercel

## 資料模型

三張表：`users`（匿名使用者 + 累積敲擊數）、`groups`（群組 + 邀請碼）、`knocks`（每一次敲擊）。

排行榜的計數**不是**每次去 `count(*)`，而是用 DB trigger 維護 `users.knock_count`。那個 trigger 是 `security definer`，所以能在匿名 RLS 下更新計數 —— 而前端本身沒有 `update` 權限，**因此偽造不了排行**。同理暱稱也改不了。

`knocks.group_id` 為 `null` 代表個人/公開的敲擊。公開 feed 只撈 `group_id is null`，免得別人群組裡的內容外流。

## 一、設定 Supabase

1. 到 [supabase.com](https://supabase.com) 開一個新 project。
2. 左側 **SQL Editor** → 貼上 [`supabase.sql`](supabase.sql) 整份 → Run。
   這會建 `knocks` 表、開 RLS（任何人可讀 / 可新增）、並把表加進 `supabase_realtime` publication。
3. 確認 **Database → Replication**（新版在 Database → Publications）裡 `supabase_realtime` 有勾到 `knocks`。
4. 到 **Project Settings → API** 複製：
   - `Project URL` → `PUBLIC_SUPABASE_URL`
   - `anon` / `publishable` key → `PUBLIC_SUPABASE_ANON_KEY`

> 這兩個值會進前端 bundle，本來就是公開的。**不要**把 `service_role` key 放進來。

## 二、本機跑起來

```bash
npm install
cp .env.example .env
# 把剛剛複製的兩個值填進 .env
npm run dev
```

打開 http://localhost:5173 。

想測即時效果，開兩個瀏覽器視窗互敲就看得到。

沒設 `.env` 也不會壞：木魚照樣有聲音，只是 feed 會顯示「尚未設定 Supabase」。

## 三、部署到 Vercel

```bash
npm i -g vercel   # 若還沒裝
vercel            # 第一次會問你要不要 link，一路 Enter
```

或直接把 repo 推到 GitHub，在 Vercel **Add New → Project** 匯入。Framework 會自動偵測成 SvelteKit（`adapter-auto` 會自己選 Vercel adapter，不用改設定）。

**重點：環境變數。** 在 Vercel 專案的 **Settings → Environment Variables** 加上這兩個，Production / Preview / Development 都勾：

| Name | Value |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | 你的 Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | anon key |

或用 CLI：

```bash
vercel env add PUBLIC_SUPABASE_URL
vercel env add PUBLIC_SUPABASE_ANON_KEY
vercel --prod
```

> `PUBLIC_` 開頭是 SvelteKit 的規定（`$env/static/public`），改名字會 build 失敗。
> 環境變數是在 **build 時**注入的，之後改了值要重新 deploy 才會生效。

## 四、互動流程（為什麼這樣設計）

規格裡給了兩種流程，這裡採「**先選口業，之後連敲都算同一種**」：

- 第一次點木魚 → 出聲、功德 +1、同時把 6 個口業攤開來問你「剛剛犯的是哪一種？」
- 選好之後存進 localStorage，**那一敲也算數**（會補寫進 DB），之後每一敲都直接記在同一個口業上
- 想換心情？點上方那顆「正在懺悔 …」就能換

理由：敲木魚要能連續、要有節奏。每敲一下都跳一個 modal 會直接殺掉爽感，所以把摩擦壓縮成「整場只問一次」。

## 五、冷啟動

沒人在線時畫面也不能是空的。載入時會抓**最近 30 筆真實歷史** knocks 填進 feed，並顯示累計總數。**不造假數據** —— 只是把真的歷史放出來看。

## 六、防濫用（最小限度）

- 前端 rate limit：兩次敲擊至少間隔 300ms（`Knocker.svelte` 的 `COOLDOWN_MS`）
- 排行計數由 DB trigger 維護、前端無 update 權限，所以名次刷不動
- 但 **insert 本身是開放的**：有心人可以直接打 API 灌 knocks 來衝排行。這是 MVP 的取捨。要收緊的下一步是改走 Edge Function 代寫 + IP rate limit

## 七、調木魚音色

音效全在 [`src/lib/woodenFish.ts`](src/lib/woodenFish.ts)，是一個純函式：

```ts
playWoodenFish({ frequency: 200, malletLevel: 0.6 });
playWoodenFish(PRESETS.temple);
```

**設計依據**：木魚是縫隙鼓（slit drum），聲音來自木塊振動模態 + 腔體 Helmholtz 共鳴。所以用的是**模態合成** —— 一組**非諧波**衰減正弦（1 : 2.42 : 3.94 : 6.1），高頻模態衰減得比低頻快。單一 oscillator 或整數倍諧波都會聽起來像電子琴；attack 也必須是寬頻噪音（木槌打木頭），不能用方波。

四層結構：`mallet`（木槌撞擊噪音）→ `modes`（非諧波模態）→ `air`（腔體中空感）→ `master`（低通/高通修邊）。

| 參數 | 說明 |
| --- | --- |
| `frequency` | 基頻。大木魚 120–200、中 220–320、小手持 380–600 |
| `modeRatios` | 模態頻率比。**非諧波**才像木頭，整數倍會像管風琴 |
| `modeGains` / `modeDecays` | 各模態音量與衰減。高頻模態要更短，這是木頭感的關鍵 |
| `pitchDropRatio` / `pitchDropTime` | 基頻在 attack 瞬間的音高滑動 |
| `malletLevel` / `malletFrequency` / `malletQ` / `malletDecay` | 木槌撞擊噪音。`Q` 越小越寬、越像木頭 |
| `airLevel` / `airRatio` / `airDecay` | 腔體共鳴，中空的「噗」 |
| `lowpass` / `highpass` | 整體修邊，`lowpass` 調低會更悶更遠 |
| `volume` / `humanize` | 音量、每敲的隨機抖動 |

現成音色在 `PRESETS`：`temple`（大殿）/ `classic`（中型）/ `small`（手持）/ `soft`（布槌）。頁面下方有切換器可以直接 A/B，選擇會記在 localStorage。

## 檔案結構

```
src/
  lib/
    sins.ts         6 個罐頭口業（不開放自由填字，避免內容審核）
    woodenFish.ts   Web Audio 木魚合成器
    supabase.ts     client、查詢、realtime 訂閱
  routes/
    +page.svelte    整個 app（單頁）
    +layout.svelte
supabase.sql        建表 + RLS + Realtime
```

## 之後可以做（這版刻意不做）

排行榜、個人功德歷史、自由填字（要審核）、每日共業統計、分享卡片。

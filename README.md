# 共業木魚

> 敲一下，替自己的口業積點功德。原來大家都一樣。

一個線上木魚。你敲、你選一個自己剛剛犯的口業，然後看著全世界其他人的懺悔即時飄進來。

沒有帳號、沒有登入、沒有排行榜、沒有個人歷史 —— 這一版只驗證一件事：**人們願不願意敲一下、承認自己嘴賤，並看著別人也一樣。**

## 技術

- SvelteKit 2 + Svelte 5 (runes) + TypeScript
- Supabase（Postgres + Realtime），匿名寫入
- 木魚聲用 Web Audio API 即時合成，無音檔
- 部署：Vercel

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

- 前端 rate limit：兩次敲擊至少間隔 300ms（`KNOCK_COOLDOWN_MS`）
- 匿名 session id 存在 localStorage，純前端用途，不進 DB
- RLS 開放匿名 insert 是 MVP 的取捨。要收緊的話，下一步是改走 Edge Function 代寫 + IP rate limit

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

<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { SINS, sinEmoji, sinLabel } from '$lib/sins';
	import { playWoodenFish, unlockAudio, setMasterVolume, PRESETS } from '$lib/woodenFish';
	import WoodCanvas from '$lib/WoodCanvas.svelte';
	import { drawWoodenFish, drawMallet, VW, VH } from '$lib/wood';
	import {
		fetchRecentKnocks,
		fetchTotalCount,
		insertKnock,
		subscribeToKnocks,
		getSessionId,
		isConfigured,
		type Knock
	} from '$lib/supabase';

	const FEED_MAX = 30;
	const KNOCK_COOLDOWN_MS = 300; // 前端 rate limit：壓著狂點也不會灌 DB
	const MILESTONE = 108; // 百八煩惱

	type ToneId = 'temple' | 'classic' | 'small' | 'soft';
	const TONES: { id: ToneId; label: string }[] = [
		{ id: 'temple', label: '大殿' },
		{ id: 'classic', label: '中型' },
		{ id: 'small', label: '手持' },
		{ id: 'soft', label: '布槌' }
	];

	/** feed 文案輪替，避免 30 行長得一模一樣。依 id 決定，重繪也不會跳動。 */
	const PHRASES = [
		(s: string) => `有人剛剛懺悔了「${s}」`,
		(s: string) => `某位施主承認了「${s}」`,
		(s: string) => `有人默默放下了「${s}」`,
		(s: string) => `一位路過的凡人坦承「${s}」`
	];

	let selectedSin = $state<string | null>(null);
	let merit = $state(0);
	let total = $state(0);
	let feed = $state<Knock[]>([]);
	let floaters = $state<{ id: number; dx: number; rot: number }[]>([]);
	let ripples = $state<number[]>([]);
	let striking = $state(false);
	let pickerOpen = $state(false);
	let hintPicker = $state(false);
	let muted = $state(false);
	let tone = $state<ToneId>('classic');
	let loading = $state(true);
	let blessing = $state(false);
	let now = $state(Date.now());

	let lastKnockAt = 0;
	let pendingKnock = false;
	let seq = 0;

	const selectedLabel = $derived(selectedSin ? sinLabel(selectedSin) : null);

	onMount(() => {
		getSessionId(); // 匿名 session id，只留在前端
		selectedSin = localStorage.getItem('muyu:sin');
		merit = Number(localStorage.getItem('muyu:merit') ?? 0) || 0;
		muted = localStorage.getItem('muyu:muted') === '1';
		const savedTone = localStorage.getItem('muyu:tone') as ToneId | null;
		if (savedTone && savedTone in PRESETS) tone = savedTone;
		setMasterVolume(muted ? 0 : 1);

		// 冷啟動：先用真實歷史把 feed 填滿，畫面一開始就是「活的」
		void (async () => {
			const [recent, count] = await Promise.all([fetchRecentKnocks(FEED_MAX), fetchTotalCount()]);
			feed = recent;
			total = count;
			loading = false;
		})();

		const unsubscribe = subscribeToKnocks((knock) => {
			pushToFeed(knock);
			total += 1;
		});

		const clock = setInterval(() => (now = Date.now()), 20_000);

		return () => {
			unsubscribe();
			clearInterval(clock);
		};
	});

	function pushToFeed(knock: Knock) {
		if (feed.some((k) => k.id === knock.id)) return; // 自己那一筆會從 realtime 再回來一次
		feed = [knock, ...feed].slice(0, FEED_MAX);
	}

	function knock() {
		const t = performance.now();
		if (t - lastKnockAt < KNOCK_COOLDOWN_MS) return;
		lastKnockAt = t;

		unlockAudio();
		playWoodenFish(PRESETS[tone]);

		striking = false;
		requestAnimationFrame(() => (striking = true));
		setTimeout(() => (striking = false), 260);

		merit += 1;
		localStorage.setItem('muyu:merit', String(merit));
		if (merit === MILESTONE) {
			blessing = true;
			setTimeout(() => (blessing = false), 5200);
		}

		const id = ++seq;
		floaters = [...floaters, { id, dx: Math.random() * 56 - 28, rot: Math.random() * 14 - 7 }];
		setTimeout(() => (floaters = floaters.filter((f) => f.id !== id)), 1500);

		ripples = [...ripples, id];
		setTimeout(() => (ripples = ripples.filter((r) => r !== id)), 900);

		if (!selectedSin) {
			// 還沒選口業：先讓他聽到聲音，再溫柔地問一次
			pendingKnock = true;
			pickerOpen = true;
			hintPicker = true;
			setTimeout(() => (hintPicker = false), 1400);
			return;
		}

		void confess(selectedSin);
	}

	async function confess(sin: string) {
		const row = await insertKnock(sin);
		if (row) {
			pushToFeed(row);
			total += 1;
		}
	}

	function selectSin(id: string) {
		selectedSin = id;
		localStorage.setItem('muyu:sin', id);
		pickerOpen = false;
		if (pendingKnock) {
			pendingKnock = false;
			void confess(id); // 剛剛那一敲也算數
		}
	}

	function selectTone(id: ToneId) {
		tone = id;
		localStorage.setItem('muyu:tone', id);
		unlockAudio();
		playWoodenFish(PRESETS[id]); // 選了就先聽一下
	}

	function toggleMute() {
		muted = !muted;
		localStorage.setItem('muyu:muted', muted ? '1' : '0');
		setMasterVolume(muted ? 0 : 1);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.code === 'Space' || e.code === 'Enter') {
			const el = e.target as HTMLElement | null;
			if (el && (el.tagName === 'BUTTON' || el.tagName === 'A')) return;
			e.preventDefault();
			knock();
		}
	}

	function phraseFor(k: Knock): string {
		return PHRASES[k.id % PHRASES.length](sinLabel(k.sin));
	}

	function timeAgo(iso: string): string {
		const diff = Math.max(0, now - new Date(iso).getTime());
		const m = Math.floor(diff / 60_000);
		if (m < 1) return '剛剛';
		if (m < 60) return `${m} 分鐘前`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} 小時前`;
		return `${Math.floor(h / 24)} 天前`;
	}
</script>

<svelte:window on:keydown={onKeydown} />

<div class="page">
	<header>
		<h1>共業木魚</h1>
		<div class="rule" aria-hidden="true"></div>
		<p class="sub">敲一下，替自己的口業積點功德。<br class="br-m" />原來大家都一樣。</p>
	</header>

	<main>
		<section class="altar">
			<p class="counter" aria-live="polite">
				{#if loading}
					<span class="dim">正在數大家的功德…</span>
				{:else}
					至今已有 <strong>{total.toLocaleString('en-US')}</strong> 人承認造口業 🙏
				{/if}
			</p>

			<div class="fish-wrap">
				<div class="ripples" aria-hidden="true">
					{#each ripples as r (r)}
						<span class="ripple"></span>
					{/each}
				</div>

				{#each floaters as f (f.id)}
					<span class="floater" style="--dx:{f.dx}px; --rot:{f.rot}deg" out:fade={{ duration: 220 }}
						>功德 +1</span
					>
				{/each}

				<button
					class="fish"
					class:striking
					onpointerdown={knock}
					aria-label="敲木魚"
					title="敲我（或按空白鍵）"
				>
					<span class="fish-art">
						<WoodCanvas draw={drawWoodenFish} vw={VW} vh={VH} label="木魚" />
					</span>
					<span class="mallet" aria-hidden="true">
						<WoodCanvas draw={drawMallet} vw={120} vh={200} />
					</span>
				</button>
			</div>

			<p class="merit">
				你的功德 <strong>{merit}</strong>
			</p>

			{#if blessing}
				<p class="blessing" transition:fade={{ duration: 400 }}>
					敲滿 {MILESTONE} 下，百八煩惱先放一邊 🙏
				</p>
			{/if}

			<div class="sin-zone">
				{#if selectedSin && !pickerOpen}
					<button class="current" onclick={() => (pickerOpen = true)}>
						<span class="tag">正在懺悔</span>
						<span class="cur-label">{sinEmoji(selectedSin)} {selectedLabel}</span>
						<span class="change">換一個</span>
					</button>
					<p class="tip">繼續敲，都算同一種口業。</p>
				{:else}
					<p class="ask" class:hint={hintPicker}>
						{selectedSin ? '這次想懺悔哪一種？' : '你剛剛犯的是哪一種口業？'}
					</p>
					<div class="sins">
						{#each SINS as sin (sin.id)}
							<button
								class="sin"
								class:active={sin.id === selectedSin}
								onclick={() => selectSin(sin.id)}
							>
								<span class="emoji">{sin.emoji}</span><span>{sin.label}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="audio-bar">
				<button class="mute" onclick={toggleMute} aria-pressed={muted}>
					{muted ? '🔕 靜音中' : '🔔 有聲音'}
				</button>
				<div class="tones" role="group" aria-label="木魚音色">
					{#each TONES as t (t.id)}
						<button
							class="tone"
							class:active={t.id === tone}
							onclick={() => selectTone(t.id)}
							aria-pressed={t.id === tone}>{t.label}</button
						>
					{/each}
				</div>
			</div>
		</section>

		<aside class="feed">
			<h2><span>大家的懺悔</span></h2>
			{#if !isConfigured}
				<p class="empty">
					還沒接上 Supabase，暫時只有你一個人在敲。<br />照 README 設好
					<code>.env</code> 就會有人陪你了。
				</p>
			{:else if loading}
				<p class="empty">正在連上眾生…</p>
			{:else if feed.length === 0}
				<p class="empty">目前一片清淨。<br />你可以當第一個承認的人。</p>
			{:else}
				<ul>
					{#each feed as k, i (k.id)}
						<li
							animate:flip={{ duration: 280 }}
							in:fly={{ y: -16, duration: 360 }}
							out:fade={{ duration: 220 }}
							style="--dim:{Math.max(0.3, 1 - i / (FEED_MAX * 0.85))}"
						>
							<span class="bell">{sinEmoji(k.sin)}</span>
							<span class="text">{phraseFor(k)}</span>
							<span class="when">{timeAgo(k.created_at)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>
	</main>

	<footer>
		<p>這裡只懺悔自己，不檢舉別人。<br class="br-m" />嘴賤是共業，功德是自己的。</p>
	</footer>
</div>

<style>
	.page {
		position: relative;
		z-index: 1;
		max-width: 1060px;
		margin: 0 auto;
		padding: 3rem 1.25rem 3.5rem;
	}

	header {
		text-align: center;
		margin-bottom: 2.4rem;
	}

	h1 {
		margin: 0;
		font-family: var(--serif);
		font-size: clamp(2rem, 6vw, 2.9rem);
		font-weight: 600;
		letter-spacing: 0.22em;
		text-indent: 0.22em; /* 補掉 letter-spacing 在尾字產生的偏移 */
		color: var(--ink);
	}

	/* 一道刻線，取代原本的裝飾性 emoji */
	.rule {
		width: clamp(72px, 18vw, 132px);
		height: 2px;
		margin: 1.1rem auto 1rem;
		border-radius: 2px;
		background: linear-gradient(to right, transparent, var(--sandal) 45%, transparent);
		opacity: 0.5;
	}

	.sub {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.95rem;
		line-height: 1.85;
	}

	main {
		display: grid;
		grid-template-columns: 1.22fr 1fr;
		gap: 2.4rem;
		align-items: start;
	}

	.altar {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		min-width: 0; /* grid 子項預設 min-width:auto，不加這行整欄不會縮 */
	}

	.counter {
		margin: 0;
		font-size: 0.9rem;
		color: var(--ink-soft);
		background: var(--paper-card);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.5rem 1.15rem;
		box-shadow: var(--shadow-soft);
	}

	.counter strong {
		font-family: var(--serif);
		color: var(--sandal-deep);
		font-size: 1.1rem;
		letter-spacing: 0.03em;
		font-variant-numeric: tabular-nums;
	}

	.dim {
		opacity: 0.7;
	}

	footer {
		margin-top: 3rem;
		text-align: center;
		font-size: 0.76rem;
		line-height: 1.9;
		color: var(--ink-faint);
	}

	footer p {
		margin: 0;
	}

	.br-m {
		display: none;
	}

	/* ── 木魚 ── */
	.fish-wrap {
		position: relative;
		width: min(360px, 80vw);
		margin: 1.5rem 0 0.6rem;
	}

	.fish {
		display: block;
		width: 100%;
		position: relative;
		padding: 0;
		border-radius: 50%;
		touch-action: manipulation;
	}

	.fish-art {
		display: block;
		filter: drop-shadow(0 14px 20px rgba(110, 76, 42, 0.2));
		transition: transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.5);
	}

	.fish-art :global(canvas) {
		display: block;
		width: 100%;
		height: auto;
	}

	.fish:active .fish-art,
	.fish.striking .fish-art {
		transform: scale(0.955) translateY(5px);
	}

	/* 木槌：平常斜靠著，敲的時候落下 */
	.mallet {
		position: absolute;
		right: -16%;
		top: 20%;
		width: 32%;
		transform-origin: 30% 94%;
		transform: rotate(30deg);
		transition: transform 0.22s cubic-bezier(0.3, 0.8, 0.4, 1.3);
		pointer-events: none;
		filter: drop-shadow(0 6px 10px rgba(110, 76, 42, 0.22));
	}

	.mallet :global(canvas) {
		display: block;
		width: 100%;
		height: auto;
	}

	.fish:active .mallet,
	.fish.striking .mallet {
		transform: rotate(-6deg);
		transition-duration: 0.09s;
	}

	/* 敲擊漣漪 —— 聲音擴散出去的感覺 */
	.ripples {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.ripple {
		position: absolute;
		width: 62%;
		aspect-ratio: 1;
		border: 1.5px solid var(--sandal);
		border-radius: 50%;
		opacity: 0;
		animation: ripple 0.9s cubic-bezier(0.2, 0.7, 0.35, 1) forwards;
	}

	@keyframes ripple {
		0% {
			transform: scale(0.85);
			opacity: 0.42;
		}
		100% {
			transform: scale(1.65);
			opacity: 0;
		}
	}

	.floater {
		position: absolute;
		left: 50%;
		top: 8%;
		z-index: 3;
		font-family: var(--serif);
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--sandal-deep);
		text-shadow: 0 1px 0 rgba(255, 255, 255, 0.85);
		white-space: nowrap;
		pointer-events: none;
		animation: rise 1.5s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
	}

	@keyframes rise {
		0% {
			opacity: 0;
			transform: translate(calc(-50% + var(--dx)), 14px) scale(0.75) rotate(var(--rot));
		}
		20% {
			opacity: 1;
			transform: translate(calc(-50% + var(--dx)), -4px) scale(1.06) rotate(var(--rot));
		}
		100% {
			opacity: 0;
			transform: translate(calc(-50% + var(--dx)), -104px) scale(1) rotate(var(--rot));
		}
	}

	.merit {
		margin: 0.3rem 0 0;
		font-size: 0.86rem;
		color: var(--ink-soft);
		letter-spacing: 0.04em;
	}

	.merit strong {
		font-family: var(--serif);
		font-size: 1.15rem;
		color: var(--sandal-deep);
		margin-left: 0.15em;
		font-variant-numeric: tabular-nums;
	}

	.blessing {
		margin: 0.7rem 0 0;
		font-size: 0.84rem;
		color: var(--sandal-deep);
		background: #f4e3cb;
		border: 1px solid var(--sandal-light);
		border-radius: 999px;
		padding: 0.4rem 1rem;
	}

	/* ── 口業選單：木牌 ── */
	.sin-zone {
		width: 100%;
		max-width: min(430px, 100%);
		margin-top: 1.6rem;
	}

	.ask {
		margin: 0 0 0.85rem;
		font-size: 0.9rem;
		color: var(--ink-soft);
		transition: color 0.2s;
	}

	.ask.hint {
		color: var(--sandal-deep);
		animation: nudge 0.55s ease;
	}

	@keyframes nudge {
		0%,
		100% {
			transform: translateY(0);
		}
		45% {
			transform: translateY(-5px);
		}
	}

	.sins {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.sin {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
		background: linear-gradient(#fffdf9, #f7efe1);
		border: 1px solid var(--line);
		border-radius: 13px;
		padding: 0.78rem 0.6rem;
		font-size: 0.87rem;
		color: var(--ink);
		box-shadow: var(--shadow-soft);
		transition:
			transform 0.14s ease,
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.sin:hover {
		transform: translateY(-2px);
		border-color: var(--sandal-light);
		box-shadow: var(--shadow-lift);
	}

	.sin.active {
		background: linear-gradient(#f6e5cd, #efd9ba);
		border-color: var(--sandal);
	}

	.emoji {
		margin-right: 0.4rem;
	}

	.current {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		background: linear-gradient(#f6e5cd, #f0dcc0);
		border: 1px solid var(--sandal-light);
		border-radius: 999px;
		padding: 0.55rem 0.65rem 0.55rem 0.55rem;
		box-shadow: var(--shadow-soft);
		transition: box-shadow 0.2s;
	}

	.current:hover {
		box-shadow: var(--shadow-lift);
	}

	.tag {
		font-size: 0.68rem;
		letter-spacing: 0.06em;
		color: #fffdf8;
		background: var(--saffron);
		border-radius: 999px;
		padding: 0.2rem 0.55rem;
	}

	.cur-label {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--sandal-deep);
	}

	.change {
		font-size: 0.74rem;
		color: var(--ink-soft);
		border-bottom: 1px dashed var(--ink-faint);
		padding-bottom: 1px;
	}

	.tip {
		margin: 0.7rem 0 0;
		font-size: 0.78rem;
		color: var(--ink-faint);
	}

	/* ── 音色 ── */
	.audio-bar {
		margin-top: 1.9rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.mute {
		font-size: 0.76rem;
		color: var(--ink-soft);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.32rem 0.8rem;
		background: var(--paper-card);
		transition: border-color 0.2s;
	}

	.mute:hover {
		border-color: var(--sandal-light);
	}

	.tones {
		display: flex;
		gap: 0.2rem;
		background: var(--paper-card);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.2rem;
	}

	.tone {
		font-size: 0.74rem;
		color: var(--ink-soft);
		border-radius: 999px;
		padding: 0.24rem 0.62rem;
		transition:
			background 0.18s,
			color 0.18s;
	}

	.tone:hover {
		color: var(--sandal-deep);
	}

	.tone.active {
		background: var(--saffron);
		color: #fffdf8;
	}

	/* ── 懺悔 feed ── */
	.feed {
		position: relative;
		background: var(--paper-card);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 1.3rem 1.3rem 0.5rem;
		box-shadow: var(--shadow-soft);
		min-width: 0;
		min-height: 340px;
		max-height: 74vh;
		overflow: hidden;
	}

	.feed h2 {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin: 0 0 1rem;
		font-family: var(--serif);
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--ink-soft);
		white-space: nowrap;
	}

	.feed h2::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--celadon);
		flex-shrink: 0;
		/* 有連上 realtime 時輕輕呼吸，代表「這是活的」 */
		animation: pulse 2.8s ease-in-out infinite;
	}

	.feed h2::after {
		content: '';
		flex: 1;
		height: 1px;
		background: linear-gradient(to right, var(--line), transparent);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}

	.feed ul {
		list-style: none;
		margin: 0;
		padding: 0 0 1.6rem;
		max-height: 62vh;
		overflow-y: auto;
		/* 舊的往下淡出，不用硬切 */
		mask-image: linear-gradient(to bottom, #000 82%, transparent 100%);
	}

	.feed li {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		padding: 0.6rem 0;
		border-bottom: 1px dashed var(--line-soft);
		font-size: 0.865rem;
		line-height: 1.6;
		opacity: var(--dim);
	}

	.feed li:last-child {
		border-bottom: none;
	}

	.bell {
		flex-shrink: 0;
		font-size: 0.95rem;
	}

	.text {
		flex: 1;
		color: var(--ink);
	}

	.when {
		flex-shrink: 0;
		font-size: 0.7rem;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.empty {
		font-size: 0.85rem;
		line-height: 1.95;
		color: var(--ink-soft);
	}

	code {
		font-size: 0.9em;
		background: #ece0ca;
		border-radius: 4px;
		padding: 0.05em 0.35em;
	}

	/* ── RWD ── */
	@media (max-width: 820px) {
		.page {
			padding-top: 2.2rem;
		}

		main {
			grid-template-columns: 1fr;
			gap: 2rem;
		}

		.br-m {
			display: inline;
		}

		.feed {
			min-height: 0; /* 手機上不需要為了對齊左欄而留高 */
			max-height: none;
		}

		.feed ul {
			max-height: 46vh;
		}

		/* 手機上把木槌收斂一點，別頂到螢幕邊 */
		.fish-wrap {
			width: min(300px, 72vw);
		}

		.mallet {
			right: -8%;
			width: 30%;
		}
	}

	@media (max-width: 400px) {
		.sins {
			grid-template-columns: 1fr;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.floater,
		.ripple,
		.ask.hint,
		.feed h2::before {
			animation: none;
		}

		.fish-art,
		.mallet {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { SINS, sinEmoji, sinLabel } from '$lib/sins';
	import { playWoodenFish, unlockAudio, setMasterVolume, PRESETS } from '$lib/woodenFish';
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

	type ToneId = 'temple' | 'classic' | 'small' | 'soft';
	const TONES: { id: ToneId; label: string }[] = [
		{ id: 'temple', label: '大殿' },
		{ id: 'classic', label: '中型' },
		{ id: 'small', label: '手持' },
		{ id: 'soft', label: '布槌' }
	];

	let selectedSin = $state<string | null>(null);
	let merit = $state(0);
	let total = $state(0);
	let feed = $state<Knock[]>([]);
	let floaters = $state<{ id: number; dx: number; rot: number }[]>([]);
	let striking = $state(false);
	let pickerOpen = $state(false);
	let hintPicker = $state(false);
	let muted = $state(false);
	let tone = $state<ToneId>('classic');
	let loading = $state(true);
	let now = $state(Date.now());

	let lastKnockAt = 0;
	let pendingKnock = false;
	let floaterSeq = 0;

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
		setTimeout(() => (striking = false), 220);

		merit += 1;
		localStorage.setItem('muyu:merit', String(merit));

		const id = ++floaterSeq;
		floaters = [...floaters, { id, dx: Math.random() * 60 - 30, rot: Math.random() * 16 - 8 }];
		setTimeout(() => (floaters = floaters.filter((f) => f.id !== id)), 1400);

		if (!selectedSin) {
			// 還沒選口業：先讓他聽到聲音，再溫柔地問一次
			pendingKnock = true;
			pickerOpen = true;
			hintPicker = true;
			setTimeout(() => (hintPicker = false), 1200);
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
		<p class="sub">敲一下，替自己的口業積點功德。原來大家都一樣。</p>
	</header>

	<main>
		<section class="altar">
			<div class="counter" aria-live="polite">
				{#if loading}
					<span class="dim">正在數大家的功德…</span>
				{:else}
					至今已有 <strong>{total.toLocaleString('en-US')}</strong> 人承認造口業 🙏
				{/if}
			</div>

			<div class="fish-wrap">
				{#each floaters as f (f.id)}
					<span
						class="floater"
						style="--dx:{f.dx}px; --rot:{f.rot}deg"
						out:fade={{ duration: 200 }}>功德 +1</span
					>
				{/each}

				<button
					class="fish"
					class:striking
					onpointerdown={knock}
					aria-label="敲木魚"
					title="敲我（或按空白鍵）"
				>
					<svg viewBox="0 0 240 200" aria-hidden="true">
						<defs>
							<radialGradient id="woodGrad" cx="38%" cy="28%" r="78%">
								<stop offset="0%" stop-color="#d6a173" />
								<stop offset="55%" stop-color="#b07d4f" />
								<stop offset="100%" stop-color="#7f5433" />
							</radialGradient>
						</defs>
						<ellipse cx="120" cy="178" rx="86" ry="12" fill="#000" opacity="0.08" />
						<path
							d="M120 24c58 0 100 34 100 78 0 41-42 68-100 68S20 143 20 102c0-44 42-78 100-78z"
							fill="url(#woodGrad)"
						/>
						<path
							d="M120 24c58 0 100 34 100 78 0 41-42 68-100 68S20 143 20 102c0-44 42-78 100-78z"
							fill="none"
							stroke="#6d4527"
							stroke-width="3"
							opacity="0.45"
						/>
						<path
							d="M58 118c22 16 56 24 88 20 26-3 44-11 56-21"
							fill="none"
							stroke="#5f3b20"
							stroke-width="9"
							stroke-linecap="round"
							opacity="0.75"
						/>
						<path
							d="M62 66c16-14 40-22 62-22"
							fill="none"
							stroke="#f2d3ae"
							stroke-width="7"
							stroke-linecap="round"
							opacity="0.4"
						/>
						<circle cx="86" cy="92" r="7" fill="#5f3b20" opacity="0.6" />
					</svg>
				</button>
			</div>

			<p class="merit">你今天的功德：<strong>{merit}</strong></p>

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
						{selectedSin ? '換一個？' : '你剛剛犯的是哪一種口業？'}
					</p>
					<div class="sins">
						{#each SINS as sin (sin.id)}
							<button
								class="sin"
								class:active={sin.id === selectedSin}
								onclick={() => selectSin(sin.id)}
							>
								<span class="emoji">{sin.emoji}</span>{sin.label}
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
			<h2>大家的懺悔</h2>
			{#if !isConfigured}
				<p class="empty">
					尚未設定 Supabase，所以看不到別人。<br />照著 README 設好
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
							animate:flip={{ duration: 260 }}
							in:fly={{ y: -14, duration: 320 }}
							out:fade={{ duration: 200 }}
							style="opacity:{Math.max(0.28, 1 - i / (FEED_MAX * 0.9))}"
						>
							<span class="bell">{sinEmoji(k.sin)}</span>
							<span class="text">有人剛剛懺悔了「{sinLabel(k.sin)}」</span>
							<span class="when">{timeAgo(k.created_at)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>
	</main>

	<footer>
		<p>這裡只懺悔自己，不檢舉別人。嘴賤是共業，功德是自己的。</p>
	</footer>
</div>

<style>
	.page {
		max-width: 1040px;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 3rem;
	}

	header {
		text-align: center;
		margin-bottom: 2rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.9rem, 5vw, 2.6rem);
		letter-spacing: 0.16em;
		font-weight: 600;
	}

	.sub {
		margin: 0.6rem 0 0;
		color: var(--ink-soft);
		font-size: 0.95rem;
		line-height: 1.7;
	}

	main {
		display: grid;
		grid-template-columns: 1.25fr 1fr;
		gap: 2rem;
		align-items: start;
	}

	.altar {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.counter {
		font-size: 0.92rem;
		color: var(--ink-soft);
		background: rgba(255, 255, 255, 0.55);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.45rem 1.1rem;
	}

	.counter strong {
		color: var(--wood-dark);
		font-size: 1.05rem;
	}

	.dim {
		opacity: 0.7;
	}

	.fish-wrap {
		position: relative;
		margin: 1.2rem 0 0.4rem;
		width: min(340px, 78vw);
	}

	.fish {
		display: block;
		width: 100%;
		padding: 1.4rem;
		border-radius: 50%;
		transition: transform 0.16s ease;
		touch-action: manipulation;
	}

	.fish svg {
		width: 100%;
		height: auto;
		display: block;
		filter: drop-shadow(0 10px 18px rgba(110, 76, 42, 0.22));
		transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.4);
	}

	.fish:active svg,
	.fish.striking svg {
		transform: scale(0.94) translateY(4px);
	}

	.floater {
		position: absolute;
		left: 50%;
		top: 12%;
		transform: translateX(-50%);
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--wood-dark);
		text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
		pointer-events: none;
		animation: rise 1.4s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
		white-space: nowrap;
		z-index: 2;
	}

	@keyframes rise {
		0% {
			opacity: 0;
			transform: translate(calc(-50% + var(--dx)), 10px) scale(0.8) rotate(var(--rot));
		}
		18% {
			opacity: 1;
			transform: translate(calc(-50% + var(--dx)), -6px) scale(1.05) rotate(var(--rot));
		}
		100% {
			opacity: 0;
			transform: translate(calc(-50% + var(--dx)), -90px) scale(1) rotate(var(--rot));
		}
	}

	.merit {
		margin: 0.2rem 0 1.4rem;
		color: var(--ink-soft);
		font-size: 0.9rem;
	}

	.merit strong {
		color: var(--wood-dark);
	}

	.sin-zone {
		width: 100%;
		max-width: 420px;
	}

	.ask {
		margin: 0 0 0.75rem;
		font-size: 0.92rem;
		color: var(--ink-soft);
		transition: color 0.2s;
	}

	.ask.hint {
		color: var(--wood-dark);
		animation: nudge 0.5s ease;
	}

	@keyframes nudge {
		0%,
		100% {
			transform: translateY(0);
		}
		40% {
			transform: translateY(-4px);
		}
	}

	.sins {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.55rem;
	}

	.sin {
		background: rgba(255, 255, 255, 0.65);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 0.7rem 0.6rem;
		font-size: 0.88rem;
		box-shadow: var(--shadow-soft);
		transition:
			transform 0.12s ease,
			border-color 0.2s,
			background 0.2s;
	}

	.sin:hover {
		transform: translateY(-2px);
		border-color: var(--accent);
	}

	.sin.active {
		background: #f6e7d3;
		border-color: var(--wood);
	}

	.emoji {
		margin-right: 0.35rem;
	}

	.current {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		justify-content: center;
		background: #f6e7d3;
		border: 1px solid var(--wood-light);
		border-radius: 999px;
		padding: 0.6rem 1rem;
		box-shadow: var(--shadow-soft);
	}

	.tag {
		font-size: 0.72rem;
		color: #fff;
		background: var(--wood);
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
	}

	.cur-label {
		font-size: 0.92rem;
		color: var(--wood-dark);
		font-weight: 600;
	}

	.change {
		font-size: 0.75rem;
		color: var(--ink-soft);
		border-bottom: 1px dashed var(--ink-soft);
	}

	.tip {
		margin: 0.6rem 0 0;
		font-size: 0.78rem;
		color: var(--ink-soft);
	}

	.audio-bar {
		margin-top: 1.6rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.tones {
		display: flex;
		gap: 0.25rem;
		background: rgba(255, 255, 255, 0.5);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.2rem;
	}

	.tone {
		font-size: 0.75rem;
		color: var(--ink-soft);
		border-radius: 999px;
		padding: 0.22rem 0.6rem;
		transition:
			background 0.18s,
			color 0.18s;
	}

	.tone.active {
		background: var(--wood);
		color: #fff;
	}

	.mute {
		font-size: 0.78rem;
		color: var(--ink-soft);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		background: rgba(255, 255, 255, 0.5);
	}

	.feed {
		background: rgba(255, 255, 255, 0.52);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 1.1rem 1.1rem 0.6rem;
		box-shadow: var(--shadow-soft);
		max-height: 70vh;
		overflow: hidden;
		position: relative;
	}

	.feed::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 64px;
		background: linear-gradient(to bottom, rgba(250, 246, 238, 0), #faf6ee);
		pointer-events: none;
	}

	.feed h2 {
		margin: 0 0 0.9rem;
		font-size: 0.95rem;
		letter-spacing: 0.1em;
		color: var(--ink-soft);
		font-weight: 600;
	}

	.feed ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 58vh;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.feed li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.5rem 0;
		border-bottom: 1px dashed var(--line);
		font-size: 0.87rem;
		line-height: 1.5;
	}

	.feed li:last-child {
		border-bottom: none;
	}

	.text {
		flex: 1;
	}

	.when {
		font-size: 0.72rem;
		color: var(--ink-soft);
		white-space: nowrap;
	}

	.empty {
		font-size: 0.85rem;
		color: var(--ink-soft);
		line-height: 1.8;
	}

	code {
		background: #eee3ce;
		border-radius: 4px;
		padding: 0 0.3em;
	}

	footer {
		margin-top: 2.6rem;
		text-align: center;
		font-size: 0.76rem;
		color: var(--ink-soft);
		opacity: 0.85;
	}

	@media (max-width: 780px) {
		main {
			grid-template-columns: 1fr;
		}

		.feed {
			max-height: none;
		}

		.feed ul {
			max-height: 44vh;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.floater,
		.ask.hint {
			animation: none;
		}
	}
</style>

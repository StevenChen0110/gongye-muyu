<script lang="ts">
	/**
	 * 木魚本體 + 敲擊行為（聲音、震動、漣漪、功德浮字）。
	 * 個人模式與群組模式共用這個元件，差別只在 onKnock 拿去做什麼。
	 */
	import { fade } from 'svelte/transition';
	import WoodCanvas from './WoodCanvas.svelte';
	import { drawWoodenFish, drawMallet, VW, VH } from './wood';
	import { playWoodenFish, unlockAudio } from './woodenFish';
	import { buzz } from './haptics';
	import type { Fish } from './fish';

	/** 按住多久才開始連敲。太短會讓一般的點擊誤判成長按。 */
	const HOLD_MS = 400;
	/**
	 * 連敲的起始與最快間隔。會在 RAMP_BEATS 下之內線性加速。
	 *
	 * 收在 180ms（約 330 BPM）而不是更快：再快就超過真實的誦經速度，
	 * 聽起來像啄木鳥而不是在敲木魚，殘響也會開始疊在一起糊掉。
	 */
	const REPEAT_START_MS = 320;
	const REPEAT_MIN_MS = 180;
	const RAMP_BEATS = 6;

	let {
		fish,
		haptics = true,
		onKnock,
		onHold = false,
		onHoldKnock,
		onHoldChange
	}: {
		fish: Fish;
		haptics?: boolean;
		onKnock: () => void;
		/**
		 * 開不開放長按連敲。
		 *
		 * 群組模式一下寫一筆，連敲會灌爆群組 feed；自動敲與超渡本來就在自己敲，
		 * 所以只有個人的手動模式開。
		 */
		onHold?: boolean;
		/**
		 * 長按連敲的每一下。沒給就退回 onKnock。
		 *
		 * 分開的理由：連敲一秒可以敲 9 下，走 onKnock 那條路會變成一秒 9 筆
		 * INSERT 加 9 次 realtime 廣播，把公開 feed 洗掉。呼叫端應該改走批次。
		 */
		onHoldKnock?: () => void;
		/** 連敲開始／結束。給呼叫端開關批次寫入用。 */
		onHoldChange?: (holding: boolean) => void;
	} = $props();

	let striking = $state(false);
	let floaters = $state<{ id: number; dx: number; rot: number }[]>([]);
	let ripples = $state<number[]>([]);

	let seq = 0;
	let animSeq = 0;

	// 換木材時 palette 變，這個 closure 也變，WoodCanvas 就會重繪
	const drawFish = $derived((ctx: CanvasRenderingContext2D) => drawWoodenFish(ctx, fish.palette));

	/**
	 * 只發聲，不動畫、不計數。
	 *
	 * `when` 是 AudioContext 的絕對時間，給節拍器預先排程用；省略就是立刻。
	 */
	export function playAt(when = 0) {
		unlockAudio();
		playWoodenFish(fish.sound, when);
	}

	/**
	 * 只播動畫與震動，不發聲。
	 *
	 * 自動敲時聲音早就排程出去了，動畫要等到「真的聽得到」的那一刻才由節拍器
	 * 回頭呼叫這裡，否則畫面會早於聲音。
	 */
	export function animate() {
		buzz(fish.vibrate, haptics);

		// 用遞增 token 保護：高 BPM 時第 N 拍的 timeout 會把第 N+1 拍剛設好的
		// flag 清掉，動畫就卡住不動了
		const my = ++animSeq;
		striking = false;
		requestAnimationFrame(() => (striking = true));
		setTimeout(() => {
			if (animSeq === my) striking = false;
		}, 260);

		const id = ++seq;
		floaters = [...floaters, { id, dx: Math.random() * 56 - 28, rot: Math.random() * 14 - 7 }];
		setTimeout(() => (floaters = floaters.filter((f) => f.id !== id)), 1500);

		ripples = [...ripples, id];
		setTimeout(() => (ripples = ripples.filter((r) => r !== id)), 900);
	}

	/** 發聲 + 動畫，但不經過 rate limit、也不回報 onKnock。 */
	export function knockNow() {
		playAt();
		animate();
	}

	/**
	 * 使用者點擊／空白鍵的入口。每一下都算，不做時間節流。
	 *
	 * 這裡刻意沒有 rate limit：手指能敲多快就算多快，手點得到卻沒加到功德
	 * 是最讓人困惑的事。之前的 80ms 上限在雙手交替敲時（間隔 40~60ms）
	 * 會漏掉將近一半。
	 *
	 * 重複事件不靠時間擋——pointerdown 每根手指每次按下只會發一次，
	 * 而且沒有綁 click，所以不會有同一下被算兩次的問題。
	 * 灌 DB 也不靠這裡：快速連點會走批次寫入（見 +page.svelte 的 startRapid）。
	 */
	export function strike() {
		knockNow();
		onKnock();
	}

	// ── 長按連敲 ──────────────────────────────────────
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let repeatTimer: ReturnType<typeof setTimeout> | null = null;
	let holding = $state(false);
	let heldBeats = 0;

	/**
	 * 第 n 下的間隔：從 320ms 線性收到 180ms。
	 *
	 * 等速連敲聽起來像機器，加速才像真的在使力。
	 */
	function gapFor(n: number): number {
		const t = Math.min(1, n / RAMP_BEATS);
		return REPEAT_START_MS + (REPEAT_MIN_MS - REPEAT_START_MS) * t;
	}

	function repeatTick() {
		knockNow();
		(onHoldKnock ?? onKnock)();
		heldBeats += 1;
		// 用 setTimeout 串接而不是 setInterval：間隔本身每一下都在變
		repeatTimer = setTimeout(repeatTick, gapFor(heldBeats));
	}

	function beginHold() {
		holding = true;
		heldBeats = 0;
		onHoldChange?.(true);
		repeatTick();
	}

	function endHold() {
		if (holdTimer !== null) clearTimeout(holdTimer);
		holdTimer = null;
		if (repeatTimer !== null) clearTimeout(repeatTimer);
		repeatTimer = null;
		if (holding) {
			holding = false;
			onHoldChange?.(false);
		}
	}

	/**
	 * 空白鍵按住也要能連敲。
	 *
	 * 系統的按鍵自動重複會一直送 keydown，但那個速率由使用者的系統設定決定，
	 * 快慢不一。所以改用自己的節奏：第一次 keydown 正常敲，後續的重複事件
	 * 只拿來當「還按著」的訊號。
	 */
	export function keyDown() {
		if (!onHold) {
			strike();
			return;
		}
		if (holding || holdTimer !== null) return; // 自動重複，忽略
		strike();
		holdTimer = setTimeout(beginHold, HOLD_MS);
	}

	export function keyUp() {
		endHold();
	}

	function onPointerDown(e: PointerEvent) {
		strike();
		if (!onHold) return;
		// 指標離開元件後仍要收到 pointerup，不然放開時連敲會停不下來
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		if (holdTimer !== null) clearTimeout(holdTimer);
		holdTimer = setTimeout(beginHold, HOLD_MS);
	}

	// 連敲中途被關掉（切驅動、切到群組）時要收乾淨，
	// 不然計時器會繼續跑，還會跟自動敲搶同一個批次 buffer
	$effect(() => {
		if (!onHold) endHold();
	});

	// 離開頁面時一定要停：背景分頁的 setTimeout 會被節流到 ~1Hz，
	// 回來時節奏是散的，而且使用者早就放開了
	$effect(() => {
		const stop = () => endHold();
		document.addEventListener('visibilitychange', stop);
		window.addEventListener('blur', stop);
		return () => {
			endHold();
			document.removeEventListener('visibilitychange', stop);
			window.removeEventListener('blur', stop);
		};
	});
</script>

<div class="wrap" style="--scale: {fish.scale}">
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
		class:holding
		onpointerdown={onPointerDown}
		onpointerup={endHold}
		onpointercancel={endHold}
		oncontextmenu={(e) => e.preventDefault()}
		aria-label="敲木魚"
		title="敲我（或按空白鍵）。按住可以連敲"
	>
		<span class="art">
			<WoodCanvas draw={drawFish} vw={VW} vh={VH} label={fish.label} />
		</span>
		<span class="mallet" aria-hidden="true">
			<WoodCanvas draw={drawMallet} vw={120} vh={200} />
		</span>
	</button>
</div>

<style>
	.wrap {
		position: relative;
		/*
		 * --knock-shrink 由外層決定（超渡放了照片時木魚要讓出上方的空間）。
		 * 跟 --scale 相乘而不是取代它，尺寸預設 0.74/0.88/1 完全不受影響；
		 * 沒有外層設定時預設 1，其他呼叫點一行都不用改。
		 */
		width: calc(min(340px, 74vw) * var(--scale) * var(--knock-shrink, 1));
		margin: 0 auto;
		transition: width 0.35s cubic-bezier(0.3, 0.8, 0.4, 1);
	}

	.fish {
		display: block;
		width: 100%;
		position: relative;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
	}

	.fish:focus-visible {
		outline: 2px solid var(--saffron);
		outline-offset: 8px;
		border-radius: 50%;
	}

	.art {
		display: block;
		transition: transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.5);
	}

	.art :global(canvas) {
		display: block;
		width: 100%;
		height: auto;
	}

	.fish:active .art,
	.fish.striking .art {
		transform: scale(0.955) translateY(5px);
	}

	.mallet {
		position: absolute;
		right: -16%;
		top: 20%;
		width: 32%;
		transform-origin: 30% 94%;
		transform: rotate(30deg);
		transition: transform 0.22s cubic-bezier(0.3, 0.8, 0.4, 1.3);
		pointer-events: none;
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

	/* 連敲時給一點暖光，讓使用者知道「按住」這件事真的生效了 */
	.fish.holding .art {
		filter: drop-shadow(0 0 14px rgba(200, 150, 70, 0.45));
	}

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

	@media (prefers-reduced-motion: reduce) {
		.floater,
		.ripple {
			animation: none;
		}

		.art,
		.mallet,
		.wrap {
			transition: none;
		}
	}
</style>

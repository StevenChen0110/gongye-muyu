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

	const COOLDOWN_MS = 300; // 前端 rate limit：壓著狂點也不會灌 DB

	let {
		fish,
		haptics = true,
		onKnock
	}: {
		fish: Fish;
		haptics?: boolean;
		onKnock: () => void;
	} = $props();

	let striking = $state(false);
	let floaters = $state<{ id: number; dx: number; rot: number }[]>([]);
	let ripples = $state<number[]>([]);

	let lastAt = 0;
	let seq = 0;

	// 換木材時 palette 變，這個 closure 也變，WoodCanvas 就會重繪
	const drawFish = $derived((ctx: CanvasRenderingContext2D) => drawWoodenFish(ctx, fish.palette));

	export function strike() {
		const t = performance.now();
		if (t - lastAt < COOLDOWN_MS) return;
		lastAt = t;

		unlockAudio();
		playWoodenFish(fish.sound);
		buzz(fish.vibrate, haptics);

		striking = false;
		requestAnimationFrame(() => (striking = true));
		setTimeout(() => (striking = false), 260);

		const id = ++seq;
		floaters = [...floaters, { id, dx: Math.random() * 56 - 28, rot: Math.random() * 14 - 7 }];
		setTimeout(() => (floaters = floaters.filter((f) => f.id !== id)), 1500);

		ripples = [...ripples, id];
		setTimeout(() => (ripples = ripples.filter((r) => r !== id)), 900);

		onKnock();
	}
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
		onpointerdown={strike}
		aria-label="敲木魚"
		title="敲我（或按空白鍵）"
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
		width: calc(min(340px, 74vw) * var(--scale));
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

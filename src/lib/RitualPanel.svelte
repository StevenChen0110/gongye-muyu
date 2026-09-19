<script lang="ts">
	/**
	 * 超度。寫下一件想放下的事，設定時間，敲完它。
	 *
	 * 跟自動敲共用同一套節拍器，差別在於：有一個對象、結束時有儀式。
	 * 儀式本身（那件事消散）才是這個模式的重點，所以動畫放在這裡而不是
	 * 塞進主畫面的 blessing。
	 */
	import { fade } from 'svelte/transition';
	import { RITUAL_MAX_LEN } from './sins';

	let {
		text,
		minutes,
		running,
		remaining,
		knocked,
		done,
		onText,
		onMinutes,
		onToggle,
		onDismiss
	}: {
		text: string;
		minutes: number;
		running: boolean;
		remaining: number;
		knocked: number;
		/** 剛完成，正在播放儀式 */
		done: boolean;
		onText: (v: string) => void;
		onMinutes: (v: number) => void;
		onToggle: () => void;
		onDismiss: () => void;
	} = $props();

	const MINUTES = [1, 3, 5, 10];
	const minuteIdx = $derived(MINUTES.indexOf(minutes));
	const hasMinute = $derived(minuteIdx !== -1);
	const ready = $derived(text.trim().length > 0);

	const mmss = $derived(
		`${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`
	);
</script>

<div class="ritual">
	{#if done}
		<div class="ceremony" transition:fade={{ duration: 500 }}>
			<p class="gone">{text}</p>
			<p class="verdict">功德圓滿。</p>
			<p class="coda">今天先放過自己。</p>
			<p class="tally">敲了 {knocked.toLocaleString('en-US')} 下</p>
			<button class="again" onclick={onDismiss}>再來一次</button>
		</div>
	{:else if running}
		<p class="target" aria-live="polite">正在超度「{text}」</p>
		<p class="status">
			<span class="clock">{mmss}</span>
			<span class="sep" aria-hidden="true">·</span>
			已敲 {knocked.toLocaleString('en-US')} 下
		</p>
		<button class="go running" onclick={onToggle}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<rect x="6" y="5" width="4" height="14" rx="1" />
				<rect x="14" y="5" width="4" height="14" rx="1" />
			</svg>
			先停下
		</button>
	{:else}
		<label class="q" for="ritual-text">今天想超度什麼？</label>
		<input
			id="ritual-text"
			class="target-input"
			value={text}
			maxlength={RITUAL_MAX_LEN}
			placeholder="那個討厭的同事、今天的破事…"
			oninput={(e) => onText(e.currentTarget.value)}
			onkeydown={(e) => {
				if (e.key === 'Enter' && ready) onToggle();
			}}
		/>

		<div class="track" style="--n: {MINUTES.length}; --i: {minuteIdx}" role="group" aria-label="時間">
			{#if hasMinute}
				<span class="thumb" aria-hidden="true"></span>
			{/if}
			{#each MINUTES as m (m)}
				<button
					class="opt"
					class:active={m === minutes}
					onclick={() => onMinutes(m)}
					aria-pressed={m === minutes}
				>
					{m} 分
				</button>
			{/each}
		</div>

		<button class="go" onclick={onToggle} disabled={!ready}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
			開始超度
		</button>
		<p class="hint">
			{ready ? '敲完它，然後放下。' : '先寫下那件事。'}
		</p>
	{/if}
</div>

<style>
	.ritual {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 340px;
	}

	.q {
		font-size: 0.82rem;
		color: var(--ink);
	}

	.target-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		font: inherit;
		font-size: 0.92rem;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		transition: border-color var(--fast);
	}

	.target-input:focus {
		outline: none;
		border-color: var(--saffron);
	}

	.track {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--n), 1fr);
		padding: 3px;
		background: var(--surface-2);
		border-radius: var(--r-sm);
	}

	.thumb {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 3px;
		width: calc((100% - 6px) / var(--n));
		background: var(--surface);
		border-radius: calc(var(--r-sm) - 3px);
		box-shadow: var(--shadow-soft);
		transform: translateX(calc(var(--i) * 100%));
		transition: transform var(--slow);
	}

	.opt {
		position: relative;
		z-index: 1;
		padding: 0.42rem 0.3rem;
		font-size: 0.82rem;
		font-weight: 500;
		color: var(--ink-soft);
		border-radius: calc(var(--r-sm) - 3px);
		transition: color var(--fast);
	}

	.opt:hover {
		color: var(--ink);
	}

	.opt.active {
		color: var(--ink);
		font-weight: 600;
	}

	.go {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		margin-top: 0.3rem;
		padding: 0.62rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: #fffdf9;
		background: var(--saffron);
		border-radius: var(--r-sm);
		transition:
			transform var(--fast),
			opacity var(--fast);
	}

	.go:active {
		transform: scale(0.985);
	}

	.go:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.go.running {
		color: var(--ink);
		background: var(--surface-2);
	}

	.go svg {
		width: 15px;
		height: 15px;
		fill: currentColor;
	}

	.target {
		margin: 0;
		text-align: center;
		font-size: 0.86rem;
		color: var(--ink);
	}

	.status,
	.hint {
		margin: 0;
		text-align: center;
		font-size: 0.76rem;
		color: var(--ink-faint);
	}

	.clock {
		font-family: var(--serif);
		font-size: 0.95rem;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.sep {
		margin: 0 0.3rem;
	}

	/* ── 儀式 ── */
	.ceremony {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0;
		text-align: center;
	}

	/* 那件事散掉：放大、變淡、模糊 */
	.gone {
		margin: 0 0 0.4rem;
		font-family: var(--serif);
		font-size: 1.15rem;
		color: var(--ink);
		animation: dissolve 3.4s var(--ease) forwards;
	}

	@keyframes dissolve {
		0% {
			opacity: 1;
			transform: scale(1);
			filter: blur(0);
		}
		100% {
			opacity: 0;
			transform: scale(1.5) translateY(-14px);
			filter: blur(7px);
		}
	}

	.verdict {
		margin: 0;
		font-family: var(--serif);
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--sandal-deep);
		opacity: 0;
		animation: surface 0.8s var(--ease) 1.1s forwards;
	}

	.coda {
		margin: 0;
		font-size: 0.84rem;
		color: var(--ink-soft);
		opacity: 0;
		animation: surface 0.8s var(--ease) 1.5s forwards;
	}

	.tally {
		margin: 0.2rem 0 0;
		font-size: 0.74rem;
		color: var(--ink-faint);
		opacity: 0;
		animation: surface 0.8s var(--ease) 1.9s forwards;
	}

	@keyframes surface {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.again {
		margin-top: 0.7rem;
		padding: 0.45rem 1.1rem;
		font-size: 0.8rem;
		color: var(--ink-soft);
		background: var(--surface-2);
		border-radius: var(--r-full);
		opacity: 0;
		animation: surface 0.8s var(--ease) 2.3s forwards;
	}

	.again:hover {
		color: var(--ink);
	}

	@media (prefers-reduced-motion: reduce) {
		.gone {
			animation: none;
			opacity: 0.35;
		}

		.verdict,
		.coda,
		.tally,
		.again {
			animation: none;
			opacity: 1;
		}
	}
</style>

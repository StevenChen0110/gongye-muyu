<script lang="ts">
	/** 尺寸 × 木材 的兩軸選擇器。3 × 3 = 9 種木魚。兩排 segmented control。 */
	import { SIZES, WOODS } from './fish';

	let {
		sizeId,
		woodId,
		onPick
	}: {
		sizeId: string;
		woodId: string;
		onPick: (sizeId: string, woodId: string) => void;
	} = $props();

	// 滑動的 thumb 靠 index 位移，所以不用替每顆按鈕畫背景
	const sizeIdx = $derived(Math.max(0, SIZES.findIndex((s) => s.id === sizeId)));
	const woodIdx = $derived(Math.max(0, WOODS.findIndex((w) => w.id === woodId)));
</script>

<div class="picker">
	<div class="track" style="--n: {SIZES.length}; --i: {sizeIdx}" role="group" aria-label="木魚大小">
		<span class="thumb" aria-hidden="true"></span>
		{#each SIZES as s (s.id)}
			<button
				class="opt"
				class:active={s.id === sizeId}
				onclick={() => onPick(s.id, woodId)}
				aria-pressed={s.id === sizeId}
				title={s.desc}
			>
				{s.label}
			</button>
		{/each}
	</div>

	<div class="track" style="--n: {WOODS.length}; --i: {woodIdx}" role="group" aria-label="木魚木材">
		<span class="thumb" aria-hidden="true"></span>
		{#each WOODS as w (w.id)}
			<button
				class="opt"
				class:active={w.id === woodId}
				onclick={() => onPick(sizeId, w.id)}
				aria-pressed={w.id === woodId}
				title={w.desc}
			>
				<span class="chip" style="background: {w.palette[1]}"></span>
				{w.label}
			</button>
		{/each}
	</div>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 340px;
	}

	.track {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--n), 1fr);
		gap: 0;
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-width: 0;
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

	.chip {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(70, 44, 20, 0.18);
		flex-shrink: 0;
	}
</style>

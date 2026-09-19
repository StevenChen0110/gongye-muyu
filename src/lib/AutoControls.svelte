<script lang="ts">
	/**
	 * 自動敲的控制盤：速度、時間、播放鍵、倒數。
	 *
	 * 刻意做成獨立元件而不是塞進 +page.svelte——那支的 style 區塊已經上千行、
	 * 平坦命名空間，.bar / .fill / .value 這種名字早就是地雷。
	 */
	import { BPM_MIN, BPM_MAX } from './metronome';
	import { AMBIENTS, type AmbientId } from './ambient';

	let {
		bpm,
		minutes,
		running,
		remaining,
		knocked,
		slowDown,
		ambient,
		ambientVol,
		onBpm,
		onMinutes,
		onToggle,
		onSlowDown,
		onAmbient,
		onAmbientVol
	}: {
		bpm: number;
		minutes: number;
		running: boolean;
		/** 剩餘秒數 */
		remaining: number;
		/** 這一輪已經敲幾下 */
		knocked: number;
		slowDown: boolean;
		ambient: AmbientId;
		ambientVol: number;
		onBpm: (v: number) => void;
		onMinutes: (v: number) => void;
		onToggle: () => void;
		onSlowDown: (v: boolean) => void;
		onAmbient: (v: AmbientId) => void;
		onAmbientVol: (v: number) => void;
	} = $props();

	const PACE = [
		{ id: 'slow', label: '慢', bpm: 40, desc: '靜坐' },
		{ id: 'normal', label: '一般', bpm: 60, desc: '誦念' },
		{ id: 'fast', label: '快', bpm: 90, desc: '精進' }
	];

	const MINUTES = [1, 3, 5, 10, 20];

	// 對到 preset 才顯示滑動的 thumb；自訂速度時就都不選中
	const paceIdx = $derived(PACE.findIndex((p) => p.bpm === bpm));
	const minuteIdx = $derived(MINUTES.indexOf(minutes));
	// 注意：不能在 markup 裡直接寫 {#if paceIdx >= 0}，Svelte 的 parser 會把
	// `>` 當成標籤結束
	const hasPace = $derived(paceIdx !== -1);
	const hasMinute = $derived(minuteIdx !== -1);

	const mmss = $derived(
		`${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`
	);
</script>

<div class="auto">
	<div class="row">
		<span class="label">速度</span>
		<span class="readout">{bpm} <small>BPM</small></span>
	</div>

	<div class="track" style="--n: {PACE.length}; --i: {paceIdx}" role="group" aria-label="速度">
		{#if hasPace}
			<span class="thumb" aria-hidden="true"></span>
		{/if}
		{#each PACE as p (p.id)}
			<button
				class="opt"
				class:active={p.bpm === bpm}
				onclick={() => onBpm(p.bpm)}
				aria-pressed={p.bpm === bpm}
				title={p.desc}
			>
				{p.label}
			</button>
		{/each}
	</div>

	<input
		class="slider"
		type="range"
		min={BPM_MIN}
		max={BPM_MAX}
		step="1"
		value={bpm}
		aria-label="每分鐘敲幾下"
		oninput={(e) => onBpm(Number(e.currentTarget.value))}
	/>

	<div class="row">
		<span class="label">時間</span>
	</div>

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

	<button
		class="switch"
		role="switch"
		aria-checked={slowDown}
		onclick={() => onSlowDown(!slowDown)}
	>
		<span class="sw-text">
			漸慢
			<small>結束時放慢到 {Math.max(BPM_MIN, Math.round(bpm / 2))} BPM</small>
		</span>
		<span class="sw-track" aria-hidden="true"><span class="sw-knob"></span></span>
	</button>

	<div class="row">
		<span class="label">背景音</span>
	</div>

	<div class="amb" role="group" aria-label="背景音">
		{#each AMBIENTS as a (a.id)}
			<button
				class="amb-opt"
				class:active={a.id === ambient}
				onclick={() => onAmbient(a.id)}
				aria-pressed={a.id === ambient}
				title={a.desc}
			>
				{a.label}
			</button>
		{/each}
	</div>

	{#if ambient !== 'none'}
		<input
			class="slider"
			type="range"
			min="0"
			max="100"
			step="1"
			value={Math.round(ambientVol * 100)}
			aria-label="背景音音量"
			oninput={(e) => onAmbientVol(Number(e.currentTarget.value) / 100)}
		/>
	{/if}

	<button class="go" class:running onclick={onToggle}>
		{#if running}
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<rect x="6" y="5" width="4" height="14" rx="1" />
				<rect x="14" y="5" width="4" height="14" rx="1" />
			</svg>
			停下來
		{:else}
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
			開始
		{/if}
	</button>

	{#if running}
		<p class="status" aria-live="polite">
			<span class="clock">{mmss}</span>
			<span class="sep" aria-hidden="true">·</span>
			已敲 {knocked.toLocaleString('en-US')} 下
		</p>
	{:else}
		<p class="hint">木魚會自己敲，你什麼都不用做。</p>
	{/if}
</div>

<style>
	.auto {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 340px;
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.label {
		font-size: 0.76rem;
		color: var(--ink-soft);
	}

	.readout {
		margin-left: auto;
		font-family: var(--serif);
		font-size: 0.95rem;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.readout small {
		font-family: var(--sans);
		font-size: 0.66rem;
		color: var(--ink-faint);
	}

	/* 跟 FishPicker 同一套 segmented control */
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
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

	.slider {
		width: 100%;
		height: 22px;
		margin: 0;
		background: none;
		-webkit-appearance: none;
		appearance: none;
		cursor: pointer;
	}

	.slider::-webkit-slider-runnable-track {
		height: 3px;
		background: var(--line);
		border-radius: var(--r-full);
	}

	.slider::-moz-range-track {
		height: 3px;
		background: var(--line);
		border-radius: var(--r-full);
	}

	.slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 15px;
		height: 15px;
		margin-top: -6px;
		background: var(--sandal);
		border: none;
		border-radius: 50%;
		box-shadow: var(--shadow-soft);
	}

	.slider::-moz-range-thumb {
		width: 15px;
		height: 15px;
		background: var(--sandal);
		border: none;
		border-radius: 50%;
		box-shadow: var(--shadow-soft);
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
			background var(--fast);
	}

	.go:active {
		transform: scale(0.985);
	}

	/* 停止時不該長得像主要動作 */
	.go.running {
		color: var(--ink);
		background: var(--surface-2);
	}

	.go svg {
		width: 15px;
		height: 15px;
		fill: currentColor;
	}

	/* 漸慢開關。跟主畫面的聲音/震動開關同一套視覺 */
	.switch {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 0.1rem;
		text-align: left;
	}

	.sw-text {
		display: flex;
		flex-direction: column;
		gap: 0.08rem;
		font-size: 0.82rem;
		color: var(--ink);
	}

	.sw-text small {
		font-size: 0.68rem;
		color: var(--ink-faint);
	}

	.sw-track {
		position: relative;
		flex-shrink: 0;
		margin-left: auto;
		width: 34px;
		height: 19px;
		background: var(--line);
		border-radius: var(--r-full);
		transition: background var(--fast);
	}

	.sw-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 15px;
		height: 15px;
		background: var(--surface);
		border-radius: 50%;
		box-shadow: var(--shadow-soft);
		transition: transform var(--fast);
	}

	.switch[aria-checked='true'] .sw-track {
		background: var(--saffron);
	}

	.switch[aria-checked='true'] .sw-knob {
		transform: translateX(15px);
	}

	/* 背景音：四個選項用 wrap 的膠囊，跟口業那排同語彙 */
	.amb {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.amb-opt {
		padding: 0.34rem 0.7rem;
		font-size: 0.8rem;
		color: var(--ink-soft);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-full);
		transition:
			background var(--fast),
			border-color var(--fast),
			color var(--fast);
	}

	.amb-opt:hover {
		border-color: var(--sandal-light);
		color: var(--ink);
	}

	.amb-opt.active {
		background: var(--celadon);
		border-color: var(--celadon);
		color: #fffdf9;
		font-weight: 500;
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
</style>

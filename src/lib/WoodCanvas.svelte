<script lang="ts">
	/**
	 * 把 wood.ts 的繪製掛到一個會自動處理 devicePixelRatio 與 resize 的 canvas 上。
	 * 木紋用固定種子產生，所以重繪不會抖動。
	 */
	let {
		draw,
		vw,
		vh,
		label = ''
	}: {
		draw: (ctx: CanvasRenderingContext2D) => void;
		vw: number;
		vh: number;
		label?: string;
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);

	function render() {
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		if (rect.width === 0) return;

		const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);

		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.scale((rect.width * dpr) / vw, (rect.height * dpr) / vh);
		draw(ctx);
	}

	$effect(() => {
		if (!canvas) return;
		render();
		const ro = new ResizeObserver(render);
		ro.observe(canvas);
		return () => ro.disconnect();
	});
</script>

<canvas bind:this={canvas} style="aspect-ratio: {vw} / {vh}" aria-label={label || undefined}></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		height: auto;
	}
</style>

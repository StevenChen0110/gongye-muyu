<script lang="ts">
	/**
	 * 超渡的化光：照片先整個亮起來，然後碎成光點、往上飄散、再輕輕落下。
	 *
	 * 為什麼用 canvas 而不是 CSS：
	 * CSS 只能對整張圖做 filter 與 transform，做不出「碎成幾百個獨立光點、
	 * 各自有不同的速度與落點」。而那正是「淨化」跟「消失」的差別——
	 * 整張淡掉是消失，散成光點再落下才是化掉。
	 *
	 * 光點的顏色直接從照片取樣，所以散開的是這張照片本身，不是外加的粒子特效。
	 *
	 * 動作分三段（總長約 3.4 秒，跟文字的 dissolve 對齊）：
	 *   1. 0~0.8s  整張變亮、過曝（像被光吃掉）
	 *   2. 0.5~2s  碎成光點、向上飄、擴散
	 *   3. 1.5~3.4s 光點減速、轉為飄落、淡出
	 */
	let {
		src,
		size,
		onDone
	}: {
		/** 要化掉的照片（object URL） */
		src: string;
		/** 圓的直徑（px），跟龕的 --photo-w 一致 */
		size: number;
		onDone?: () => void;
	} = $props();

	/** 取樣的格子密度：size/GRID 約是每個光點的間距 */
	const GRID = 13;
	const DURATION = 3400;
	/** 往上飄的高度，跟原本 CSS 版的 -54px 同個量級但更誇張一點 */
	const RISE = 70;

	type Mote = {
		/** 起點（canvas 座標） */
		x0: number;
		y0: number;
		/** 水平漂移與上升高度 */
		dx: number;
		rise: number;
		/** 最後落下的距離 */
		fall: number;
		r: number;
		color: string;
		/** 這顆什麼時候開始飄（0~1，讓它們不要整齊劃一） */
		delay: number;
		/** 閃爍的相位 */
		phase: number;
	};

	let canvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		const el = canvas;
		if (!el) return;

		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		// 上下都要留白：光點會飄出圓的範圍
		const W = size;
		const H = size + RISE + 60;
		el.width = W * dpr;
		el.height = H * dpr;
		el.style.width = `${W}px`;
		el.style.height = `${H}px`;

		const ctx = el.getContext('2d');
		if (!ctx) return;
		ctx.scale(dpr, dpr);

		let raf = 0;
		let motes: Mote[] = [];
		let start = 0;
		let done = false;

		const img = new Image();
		img.onload = () => {
			// 先把照片畫進離屏 canvas 取色
			const off = document.createElement('canvas');
			off.width = size;
			off.height = size;
			const octx = off.getContext('2d', { willReadFrequently: true });
			if (!octx) return;

			// 跟 .frame 一樣用 cover 裁切，光點才對得上原本看到的畫面
			const scale = Math.max(size / img.width, size / img.height);
			const dw = img.width * scale;
			const dh = img.height * scale;
			octx.drawImage(img, (size - dw) / 2, (size - dh) / 2 - dh * 0.08, dw, dh);

			const data = octx.getImageData(0, 0, size, size).data;
			const R = size / 2;

			for (let y = GRID / 2; y < size; y += GRID) {
				for (let x = GRID / 2; x < size; x += GRID) {
					// 只取圓形範圍內的（龕是圓的）
					const dxc = x - R;
					const dyc = y - R;
					const dist = Math.hypot(dxc, dyc);
					if (dist > R) continue;

					const i = (Math.floor(y) * size + Math.floor(x)) * 4;
					const r = data[i];
					const g = data[i + 1];
					const b = data[i + 2];

					motes.push({
						x0: x,
						y0: y,
						// 往外擴散：離中心越遠飄得越開
						dx: dxc * 0.42 + (Math.random() - 0.5) * 16,
						rise: RISE * (0.65 + Math.random() * 0.7),
						fall: 26 + Math.random() * 46,
						r: 1.1 + Math.random() * 1.7,
						color: `${r},${g},${b}`,
						// 外圈先散、中心後散，像從邊緣被光吃掉
						delay: (dist / R) * 0.22 + Math.random() * 0.18,
						phase: Math.random() * Math.PI * 2
					});
				}
			}

			// 不想看動畫的人：直接顯示結束狀態，不做逐格運算
			if (reduced) {
				ctx.clearRect(0, 0, W, H);
				onDone?.();
				return;
			}
			raf = requestAnimationFrame(tick);
		};
		img.src = src;

		/** 緩出：一開始快、後面慢，像飄起來之後失速 */
		const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.2);

		function tick(now: number) {
			if (!start) start = now;
			const t = Math.min(1, (now - start) / DURATION);
			ctx!.clearRect(0, 0, W, H);

			// 第一段：整張照片還在，但越來越亮、越來越淡
			if (t < 0.34) {
				const k = t / 0.34;
				ctx!.save();
				ctx!.globalAlpha = 1 - k;
				ctx!.filter = `brightness(${1 + k * 1.6}) saturate(${1 - k * 0.5})`;
				ctx!.beginPath();
				ctx!.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
				ctx!.clip();
				const scale = Math.max(size / img.width, size / img.height);
				const dw = img.width * scale;
				const dh = img.height * scale;
				ctx!.drawImage(img, (size - dw) / 2, (size - dh) / 2 - dh * 0.08, dw, dh);
				ctx!.restore();
			}

			// 第二、三段：光點
			ctx!.globalCompositeOperation = 'lighter';
			for (const m of motes) {
				const mt = (t - m.delay) / (1 - m.delay);
				if (mt <= 0) continue;
				const e = easeOut(Math.min(1, mt));

				// 上升在前 60%，之後轉為飄落
				const up = Math.min(1, e / 0.6);
				const down = Math.max(0, (e - 0.6) / 0.4);
				const y = m.y0 - m.rise * up + m.fall * down * down;
				const x = m.x0 + m.dx * e;

				// 亮度：先亮起來，再慢慢暗掉
				const life = mt < 0.18 ? mt / 0.18 : 1 - (mt - 0.18) / 0.82;
				if (life <= 0) continue;
				// 輕微閃爍，像塵埃在光裡
				const twinkle = 0.75 + 0.25 * Math.sin(now / 130 + m.phase);
				const a = Math.max(0, life) * twinkle * 0.9;

				const rad = m.r * (1 + e * 0.5);
				const grd = ctx!.createRadialGradient(x, y, 0, x, y, rad * 3);
				grd.addColorStop(0, `rgba(${m.color},${a})`);
				// 外圈統一偏暖白，讓整體讀起來是「光」而不是「彩色碎片」
				grd.addColorStop(0.4, `rgba(255,236,200,${a * 0.5})`);
				grd.addColorStop(1, 'rgba(255,236,200,0)');
				ctx!.fillStyle = grd;
				ctx!.beginPath();
				ctx!.arc(x, y, rad * 3, 0, Math.PI * 2);
				ctx!.fill();
			}
			ctx!.globalCompositeOperation = 'source-over';

			if (t < 1) {
				raf = requestAnimationFrame(tick);
			} else if (!done) {
				done = true;
				ctx!.clearRect(0, 0, W, H);
				onDone?.();
			}
		}

		return () => {
			cancelAnimationFrame(raf);
			img.onload = null;
		};
	});
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
	canvas {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		pointer-events: none;
	}
</style>

/**
 * 木頭材質的程序化繪製。
 *
 * 為什麼用 Canvas 而不是 SVG：木魚要好看，靠的是木紋、導管孔、
 * 邊緣的環境遮蔽、開縫內壁的反光——這些是「很多筆很淡的疊加」，
 * 用 SVG path 手刻既寫不出來也難調。Canvas 可以程序生成。
 *
 * 所有繪製都在 260×240 的虛擬座標系裡進行，由呼叫端負責縮放。
 */

export const VW = 260;
export const VH = 240;

/** 固定種子的亂數，讓木紋在每次重繪（resize / DPR 變化）時保持不變。 */
function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 把後續繪製限制在一個橢圓內。 */
function clipEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
	ctx.beginPath();
	ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
	ctx.clip();
}

/**
 * 木紋：一組橫向、隨形體微彎的年輪線 + 導管孔。
 * 這是整塊木頭「像木頭」的主要來源。
 */
function grain(
	ctx: CanvasRenderingContext2D,
	rand: () => number,
	opts: { x0: number; x1: number; y0: number; y1: number; lines: number; curve: number }
) {
	const { x0, x1, y0, y1, lines, curve } = opts;
	const mid = (x0 + x1) / 2;

	for (let i = 0; i < lines; i++) {
		const base = y0 + ((i + 0.5) * (y1 - y0)) / lines;
		const amp = 1.5 + rand() * 6;
		const freq = 0.008 + rand() * 0.02;
		const phase = rand() * Math.PI * 2;
		const dark = rand() > 0.72; // 少數幾條深色的「木心」線

		ctx.beginPath();
		for (let x = x0; x <= x1; x += 3) {
			const d = (x - mid) / (x1 - mid);
			const y = base + Math.sin(x * freq + phase) * amp + d * d * curve;
			if (x === x0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.strokeStyle = dark
			? `rgba(78,48,26,${0.1 + rand() * 0.12})`
			: `rgba(120,80,48,${0.04 + rand() * 0.07})`;
		ctx.lineWidth = dark ? 1.4 + rand() * 1.6 : 0.8 + rand();
		ctx.stroke();
	}

	// 導管孔：短短的深色刻痕，近看才有的細節
	for (let i = 0; i < 260; i++) {
		const x = x0 + rand() * (x1 - x0);
		const y = y0 + rand() * (y1 - y0);
		const len = 1 + rand() * 3.5;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + len, y + (rand() - 0.5) * 0.8);
		ctx.strokeStyle = `rgba(66,40,20,${0.05 + rand() * 0.1})`;
		ctx.lineWidth = 0.7;
		ctx.stroke();
	}
}

/** 開縫（魚嘴）的外形。上緣近乎水平，下緣鼓出來，成一個橫躺的透鏡。 */
function slitPath(ctx: CanvasRenderingContext2D) {
	ctx.beginPath();
	ctx.moveTo(60, 141);
	ctx.bezierCurveTo(104, 137, 158, 135, 200, 132);
	ctx.bezierCurveTo(162, 158, 98, 163, 60, 141);
	ctx.closePath();
}

/**
 * 開縫。分三層：內壁（下緣被光打到，較亮）、深處（近黑）、上緣的鑿口硬邊。
 * 少了「下緣反光」這層，看起來就只是一條黑線而不是鑿穿的洞。
 */
function drawSlit(ctx: CanvasRenderingContext2D) {
	// 洞口上方的落影
	ctx.save();
	slitPath(ctx);
	ctx.shadowColor = 'rgba(40,22,8,0.55)';
	ctx.shadowBlur = 12;
	ctx.shadowOffsetY = -5;
	ctx.fillStyle = 'rgba(40,22,8,0.9)';
	ctx.fill();
	ctx.restore();

	// 洞內：上深下亮，亮的是被光照到的下內壁
	ctx.save();
	slitPath(ctx);
	ctx.clip();
	const hole = ctx.createLinearGradient(0, 132, 0, 163);
	hole.addColorStop(0, '#150C05');
	hole.addColorStop(0.55, '#241609');
	hole.addColorStop(0.86, '#5E3A1E');
	hole.addColorStop(1, '#8A5B33');
	ctx.fillStyle = hole;
	ctx.fill();
	ctx.restore();

	// 上緣的鑿口：一條硬邊，切面感從這來
	ctx.beginPath();
	ctx.moveTo(60, 141);
	ctx.bezierCurveTo(104, 137, 158, 135, 200, 132);
	ctx.strokeStyle = 'rgba(52,30,12,0.85)';
	ctx.lineWidth = 2.2;
	ctx.stroke();
}

/** 沿頂緣的一道鑿槽。深線 + 下方一條亮線 = 有稜有角的雕刻感。 */
function drawTopGroove(ctx: CanvasRenderingContext2D) {
	const curve = (offset: number) => {
		ctx.beginPath();
		ctx.moveTo(50, 96 + offset);
		ctx.bezierCurveTo(70, 48 + offset, 190, 48 + offset, 210, 92 + offset);
	};
	curve(0);
	ctx.strokeStyle = 'rgba(72,44,22,0.34)';
	ctx.lineWidth = 3;
	ctx.stroke();
	curve(3.5);
	ctx.strokeStyle = 'rgba(255,226,190,0.22)';
	ctx.lineWidth = 2;
	ctx.stroke();
}

/** 光澤：一大片柔和的漫射高光 + 一個小而集中的亮點。 */
function drawSheen(ctx: CanvasRenderingContext2D) {
	ctx.save();
	ctx.translate(96, 62);
	ctx.rotate(-0.42);
	ctx.scale(1, 0.52);
	const soft = ctx.createRadialGradient(0, 0, 2, 0, 0, 54);
	soft.addColorStop(0, 'rgba(255,240,216,0.5)');
	soft.addColorStop(0.5, 'rgba(255,238,212,0.18)');
	soft.addColorStop(1, 'rgba(255,238,212,0)');
	ctx.fillStyle = soft;
	ctx.beginPath();
	ctx.arc(0, 0, 54, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	ctx.save();
	ctx.translate(88, 56);
	ctx.rotate(-0.5);
	ctx.scale(1, 0.42);
	const hot = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
	hot.addColorStop(0, 'rgba(255,250,236,0.66)');
	hot.addColorStop(1, 'rgba(255,250,236,0)');
	ctx.fillStyle = hot;
	ctx.beginPath();
	ctx.arc(0, 0, 22, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/** 木魚本體。畫在 260×240 的虛擬座標系裡。 */
export function drawWoodenFish(ctx: CanvasRenderingContext2D) {
	const rand = mulberry32(20260805);

	const cx = 130;
	const cy = 112;
	const rx = 104;
	const ry = 88;

	// ── 接觸陰影 ──────────────────────────────────────
	// 不畫蒲團：木魚直接安放在宣紙上，只靠一道貼地的影子交代重量。
	// 遠影負責份量，近影負責「接觸點」——少了近影就會像浮在半空。
	ctx.save();
	ctx.beginPath();
	ctx.ellipse(130, 203, 96, 15, 0, 0, Math.PI * 2);
	const far = ctx.createRadialGradient(130, 203, 6, 130, 203, 96);
	far.addColorStop(0, 'rgba(96,66,34,0.26)');
	far.addColorStop(0.6, 'rgba(96,66,34,0.12)');
	far.addColorStop(1, 'rgba(96,66,34,0)');
	ctx.fillStyle = far;
	ctx.fill();

	ctx.beginPath();
	ctx.ellipse(130, 199, 54, 7, 0, 0, Math.PI * 2);
	const near = ctx.createRadialGradient(130, 199, 2, 130, 199, 54);
	near.addColorStop(0, 'rgba(74,46,18,0.4)');
	near.addColorStop(1, 'rgba(74,46,18,0)');
	ctx.fillStyle = near;
	ctx.fill();
	ctx.restore();

	// ── 魚身 ──────────────────────────────────────────
	ctx.save();
	ctx.shadowColor = 'rgba(84,50,20,0.34)';
	ctx.shadowBlur = 18;
	ctx.shadowOffsetY = 9;
	ctx.beginPath();
	ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
	const base = ctx.createRadialGradient(96, 62, 12, cx, cy + 10, 168);
	base.addColorStop(0, '#E9C193');
	base.addColorStop(0.42, '#C99060');
	base.addColorStop(0.72, '#A87244');
	base.addColorStop(1, '#7C5030');
	ctx.fillStyle = base;
	ctx.fill();
	ctx.restore();

	// 以下細節全部限制在魚身內
	ctx.save();
	clipEllipse(ctx, cx, cy, rx, ry);

	// 木紋
	grain(ctx, rand, { x0: 20, x1: 244, y0: 20, y1: 204, lines: 30, curve: 26 });

	// 邊緣環境遮蔽：中心透明、周邊壓深，球體感就是這層給的
	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(1, ry / rx);
	const ao = ctx.createRadialGradient(0, 0, rx * 0.5, 0, 0, rx);
	ao.addColorStop(0, 'rgba(74,44,20,0)');
	ao.addColorStop(0.75, 'rgba(74,44,20,0.2)');
	ao.addColorStop(1, 'rgba(58,33,14,0.62)');
	ctx.fillStyle = ao;
	ctx.beginPath();
	ctx.arc(0, 0, rx, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	drawSlit(ctx);
	drawTopGroove(ctx);
	drawSheen(ctx);

	ctx.restore();

	// 上緣的一道細亮邊，讓輪廓不會糊在背景裡
	ctx.beginPath();
	ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, Math.PI * 1.06, Math.PI * 1.92);
	ctx.strokeStyle = 'rgba(255,232,201,0.4)';
	ctx.lineWidth = 2;
	ctx.stroke();
}

/** 木槌。畫在 120×200 的虛擬座標系裡，用同一套木頭材質。 */
export function drawMallet(ctx: CanvasRenderingContext2D) {
	const rand = mulberry32(775501);

	ctx.save();
	ctx.shadowColor = 'rgba(92,60,30,0.28)';
	ctx.shadowBlur = 12;
	ctx.shadowOffsetY = 7;

	// 握柄
	ctx.beginPath();
	ctx.moveTo(32, 188);
	ctx.lineTo(74, 62);
	ctx.lineCap = 'round';
	ctx.lineWidth = 13;
	const stick = ctx.createLinearGradient(20, 0, 88, 0);
	stick.addColorStop(0, '#8E5E36');
	stick.addColorStop(0.4, '#C79059');
	stick.addColorStop(1, '#7E5130');
	ctx.strokeStyle = stick;
	ctx.stroke();

	// 槌頭
	ctx.beginPath();
	ctx.arc(78, 46, 27, 0, Math.PI * 2);
	const head = ctx.createRadialGradient(68, 34, 3, 78, 48, 38);
	head.addColorStop(0, '#EAC195');
	head.addColorStop(0.5, '#C48C57');
	head.addColorStop(1, '#7A4E2D');
	ctx.fillStyle = head;
	ctx.fill();
	ctx.restore();

	// 槌頭木紋
	ctx.save();
	clipEllipse(ctx, 78, 46, 27, 27);
	grain(ctx, rand, { x0: 48, x1: 108, y0: 16, y1: 76, lines: 9, curve: 6 });
	ctx.restore();

	// 槌頭高光
	ctx.save();
	ctx.translate(68, 34);
	ctx.scale(1, 0.7);
	const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
	gl.addColorStop(0, 'rgba(255,246,228,0.62)');
	gl.addColorStop(1, 'rgba(255,246,228,0)');
	ctx.fillStyle = gl;
	ctx.beginPath();
	ctx.arc(0, 0, 15, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

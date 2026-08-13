/**
 * 木魚與木槌的繪製（極簡版）。
 *
 * 刻意保持「一顆木頭 + 一道開縫」。之前加過頂部刻槽、魚眼、捲紋、
 * 蒲團，結果整顆讀成一張笑臉——開縫變嘴、刻槽變眉毛。所以現在
 * 只留必要的三件事：形體、木紋、開縫。
 *
 * 座標系固定為 260×240（木魚）與 120×200（木槌），縮放由呼叫端處理。
 *
 * 想微調的話：
 *   BODY   — 木魚的位置與大小
 *   SLIT   — 開縫的左右端點、高度、下緣鼓出的幅度
 *   WOOD   — 木頭顏色（亮 → 暗）
 */

export const VW = 260;
export const VH = 240;

/** 木魚本體的位置與半徑 */
const BODY = { cx: 130, cy: 116, rx: 100, ry: 86 };

/** 開縫：y 是上緣高度，bulge 是下緣往下鼓出的幅度 */
const SLIT = { x0: 64, x1: 196, y: 130, bulge: 17 };

/** 預設木頭顏色（樟木），由受光處到暗處。由 fish.ts 的木材配色覆寫。 */
const DEFAULT_WOOD = ['#E6BD8E', '#C68F5F', '#A06D41', '#7A4C2C'];

/** 固定種子的亂數，讓木紋在重繪（resize / DPR 變化）時保持不變。 */
function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 淡淡的橫向木紋。刻意很輕——重了就會搶掉形體。 */
function grain(
	ctx: CanvasRenderingContext2D,
	rand: () => number,
	box: { x0: number; x1: number; y0: number; y1: number; lines: number }
) {
	const { x0, x1, y0, y1, lines } = box;
	for (let i = 0; i < lines; i++) {
		const base = y0 + ((i + 0.5) * (y1 - y0)) / lines;
		const amp = 1 + rand() * 4;
		const freq = 0.01 + rand() * 0.015;
		const phase = rand() * Math.PI * 2;

		ctx.beginPath();
		for (let x = x0; x <= x1; x += 4) {
			const y = base + Math.sin(x * freq + phase) * amp;
			if (x === x0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.strokeStyle = `rgba(122,80,46,${0.05 + rand() * 0.06})`;
		ctx.lineWidth = 0.8 + rand();
		ctx.stroke();
	}
}

/** 開縫外形：上緣水平（有一點傾斜就會變成笑臉），下緣鼓出。 */
function slitPath(ctx: CanvasRenderingContext2D) {
	const { x0, x1, y, bulge } = SLIT;
	ctx.beginPath();
	ctx.moveTo(x0, y);
	ctx.lineTo(x1, y);
	ctx.bezierCurveTo(x1 - 10, y + bulge, x0 + 10, y + bulge, x0, y);
	ctx.closePath();
}

/** 木魚。palette 由 fish.ts 的木材決定（亮 → 暗，4 色）。 */
export function drawWoodenFish(ctx: CanvasRenderingContext2D, palette: string[] = DEFAULT_WOOD) {
	const rand = mulberry32(20260808);
	const { cx, cy, rx, ry } = BODY;
	const WOOD = palette.length >= 4 ? palette : DEFAULT_WOOD;

	// 貼地陰影
	ctx.save();
	ctx.beginPath();
	ctx.ellipse(cx, cy + ry + 6, 88, 13, 0, 0, Math.PI * 2);
	const shadow = ctx.createRadialGradient(cx, cy + ry + 6, 4, cx, cy + ry + 6, 88);
	shadow.addColorStop(0, 'rgba(96,66,34,0.3)');
	shadow.addColorStop(1, 'rgba(96,66,34,0)');
	ctx.fillStyle = shadow;
	ctx.fill();
	ctx.restore();

	// 本體
	ctx.beginPath();
	ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
	const fill = ctx.createRadialGradient(cx - 36, cy - 46, 10, cx, cy, rx * 1.5);
	fill.addColorStop(0, WOOD[0]);
	fill.addColorStop(0.42, WOOD[1]);
	fill.addColorStop(0.75, WOOD[2]);
	fill.addColorStop(1, WOOD[3]);
	ctx.fillStyle = fill;
	ctx.fill();

	ctx.save();
	ctx.beginPath();
	ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
	ctx.clip();

	grain(ctx, rand, { x0: cx - rx - 4, x1: cx + rx + 4, y0: cy - ry, y1: cy + ry, lines: 18 });

	// 邊緣壓深，形體感靠這層
	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(1, ry / rx);
	const edge = ctx.createRadialGradient(0, 0, rx * 0.62, 0, 0, rx);
	edge.addColorStop(0, 'rgba(74,44,20,0)');
	edge.addColorStop(1, 'rgba(60,34,14,0.5)');
	ctx.fillStyle = edge;
	ctx.beginPath();
	ctx.arc(0, 0, rx, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	drawSlit(ctx);

	// 一片柔和的高光
	ctx.save();
	ctx.translate(cx - 40, cy - 52);
	ctx.rotate(-0.4);
	ctx.scale(1, 0.5);
	const sheen = ctx.createRadialGradient(0, 0, 2, 0, 0, 50);
	sheen.addColorStop(0, 'rgba(255,241,218,0.4)');
	sheen.addColorStop(1, 'rgba(255,241,218,0)');
	ctx.fillStyle = sheen;
	ctx.beginPath();
	ctx.arc(0, 0, 50, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	ctx.restore();
}

/** 開縫：洞內上深下亮（下內壁反光），少了那層就只是一條黑線。 */
function drawSlit(ctx: CanvasRenderingContext2D) {
	const { x0, x1, y, bulge } = SLIT;

	ctx.save();
	slitPath(ctx);
	ctx.clip();
	const hole = ctx.createLinearGradient(0, y, 0, y + bulge);
	hole.addColorStop(0, '#180E06');
	hole.addColorStop(0.6, '#2A1A0B');
	hole.addColorStop(1, '#7A4E2A');
	ctx.fillStyle = hole;
	ctx.fill();
	ctx.restore();

	// 上緣的鑿口硬邊
	ctx.beginPath();
	ctx.moveTo(x0, y);
	ctx.lineTo(x1, y);
	ctx.strokeStyle = 'rgba(54,30,12,0.8)';
	ctx.lineWidth = 2;
	ctx.stroke();
}

/** 木槌。 */
export function drawMallet(ctx: CanvasRenderingContext2D) {
	ctx.save();
	ctx.shadowColor = 'rgba(92,60,30,0.26)';
	ctx.shadowBlur = 10;
	ctx.shadowOffsetY = 6;

	ctx.beginPath();
	ctx.moveTo(32, 188);
	ctx.lineTo(74, 62);
	ctx.lineCap = 'round';
	ctx.lineWidth = 12;
	const stick = ctx.createLinearGradient(20, 0, 88, 0);
	stick.addColorStop(0, '#8B5B34');
	stick.addColorStop(0.45, '#C48C57');
	stick.addColorStop(1, '#7C4F2E');
	ctx.strokeStyle = stick;
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(78, 46, 25, 0, Math.PI * 2);
	const head = ctx.createRadialGradient(68, 34, 3, 78, 48, 36);
	head.addColorStop(0, '#E8BF92');
	head.addColorStop(0.5, '#C28A55');
	head.addColorStop(1, '#784C2B');
	ctx.fillStyle = head;
	ctx.fill();
	ctx.restore();
}

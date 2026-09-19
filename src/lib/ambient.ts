/**
 * 背景音。全部用 Web Audio 合成，不載任何音檔。
 *
 * 為什麼不用 mp3：一首可 loop 的 ambient 大約 2–4MB，是目前整包 bundle 的上百倍；
 * 而且背景音是整個 session 持續播放，流量會隨「使用時長」成長而不是「瀏覽次數」——
 * 那是唯一一個越受歡迎越花錢的功能。合成的另一個好處是沒有接縫問題，
 * 循環噪音本質上不存在 loop point。
 */
import { audioNow, getAmbientBus, getAudioContext } from './woodenFish';

export type AmbientId = 'none' | 'rain' | 'drone' | 'night';

export const AMBIENTS: { id: AmbientId; label: string; desc: string }[] = [
	{ id: 'none', label: '無', desc: '只有木魚' },
	{ id: 'rain', label: '雨聲', desc: '窗外下著雨' },
	{ id: 'drone', label: '梵唄', desc: '低沉的殿堂共鳴' },
	{ id: 'night', label: '夜蟲', desc: '山寺的夏夜' }
];

/** 換背景音時的交叉淡入淡出時間 */
const FADE_S = 0.8;

type Layer = {
	/** 這一層自己的 gain，淡出後整個斷掉 */
	out: GainNode;
	stop: () => void;
};

let current: AmbientId = 'none';
let layer: Layer | null = null;

export function currentAmbient(): AmbientId {
	return current;
}

export function setAmbient(id: AmbientId): void {
	if (id === current) return;
	current = id;

	// 舊的先淡出再拆掉，避免爆音
	if (layer) {
		const old = layer;
		const t = audioNow();
		old.out.gain.cancelScheduledValues(t);
		old.out.gain.setValueAtTime(old.out.gain.value, t);
		old.out.gain.linearRampToValueAtTime(0.0001, t + FADE_S);
		setTimeout(() => old.stop(), FADE_S * 1000 + 120);
		layer = null;
	}

	if (id === 'none') return;

	const bus = getAmbientBus();
	const ctx = getAudioContext();
	if (!bus || !ctx) return;

	layer = id === 'rain' ? makeRain(ctx, bus) : id === 'drone' ? makeDrone(ctx, bus) : makeNight(ctx, bus);

	// 淡入
	const t = audioNow();
	layer.out.gain.setValueAtTime(0.0001, t);
	layer.out.gain.linearRampToValueAtTime(1, t + FADE_S);
}

/** 給每一層共用的輸出節點。 */
function makeOut(ctx: AudioContext, bus: GainNode): GainNode {
	const out = ctx.createGain();
	out.gain.value = 0.0001;
	out.connect(bus);
	return out;
}

/** 循環播放的噪音床。用一段長 buffer + loop，比反覆 new source 省得多。 */
function noiseBed(ctx: AudioContext, seconds = 4): AudioBufferSourceNode {
	const len = Math.floor(ctx.sampleRate * seconds);
	const buf = ctx.createBuffer(1, len, ctx.sampleRate);
	const data = buf.getChannelData(0);
	// 粉紅噪音（Voss-McCartney 的簡化版）：比白噪音低頻多，聽起來比較像自然聲
	let b0 = 0,
		b1 = 0,
		b2 = 0;
	for (let i = 0; i < len; i++) {
		const white = Math.random() * 2 - 1;
		b0 = 0.99765 * b0 + white * 0.099046;
		b1 = 0.963 * b1 + white * 0.2965164;
		b2 = 0.57 * b2 + white * 1.0526913;
		data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.15;
	}
	const src = ctx.createBufferSource();
	src.buffer = buf;
	src.loop = true;
	return src;
}

/**
 * 雨。
 *
 * 純粹的濾波噪音聽起來像電台雜訊不像雨；雨的辨識度來自寬頻底噪之上
 * 隨機散落的水滴瞬態，所以要再灑一層短促的高頻點擊。
 */
function makeRain(ctx: AudioContext, bus: GainNode): Layer {
	const out = makeOut(ctx, bus);

	const bed = noiseBed(ctx);
	const lp = ctx.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.value = 2400;
	const hp = ctx.createBiquadFilter();
	hp.type = 'highpass';
	hp.frequency.value = 240;
	const bedGain = ctx.createGain();
	bedGain.gain.value = 0.34;
	bed.connect(hp).connect(lp).connect(bedGain).connect(out);
	bed.start();

	// 水滴。雨本來就不規則，這裡用 setTimeout 的抖動反而是對的。
	let timer: ReturnType<typeof setTimeout> | null = null;
	const drop = () => {
		const t = audioNow();
		const src = ctx.createBufferSource();
		const len = Math.floor(ctx.sampleRate * 0.03);
		const b = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = b.getChannelData(0);
		for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
		src.buffer = b;

		const bp = ctx.createBiquadFilter();
		bp.type = 'bandpass';
		bp.frequency.value = 1800 + Math.random() * 3200;
		bp.Q.value = 3 + Math.random() * 4;

		const g = ctx.createGain();
		g.gain.setValueAtTime(0.16 + Math.random() * 0.2, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

		src.connect(bp).connect(g).connect(out);
		src.start(t);
		src.stop(t + 0.08);

		timer = setTimeout(drop, 30 + Math.random() * 110);
	};
	drop();

	return {
		out,
		stop() {
			if (timer !== null) clearTimeout(timer);
			try {
				bed.stop();
			} catch {
				// 已經停了就算了
			}
			out.disconnect();
		}
	};
}

/** 梵唄：幾顆失諧的低頻正弦 + 緩慢移動的低通，像殿堂裡的共鳴。 */
function makeDrone(ctx: AudioContext, bus: GainNode): Layer {
	const out = makeOut(ctx, bus);

	const lp = ctx.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.value = 420;
	lp.Q.value = 0.8;
	lp.connect(out);

	// 很慢的 LFO 推低通，聲音才不會死板
	const lfo = ctx.createOscillator();
	lfo.frequency.value = 0.045;
	const lfoGain = ctx.createGain();
	lfoGain.gain.value = 130;
	lfo.connect(lfoGain).connect(lp.frequency);
	lfo.start();

	const oscs: OscillatorNode[] = [];
	// 55 / 82.5 / 110 Hz ≈ A1 與其五度、八度
	[
		[55, 0.5],
		[82.5, 0.26],
		[110, 0.2]
	].forEach(([freq, level]) => {
		const o = ctx.createOscillator();
		o.type = 'sine';
		o.frequency.value = freq;
		o.detune.value = (Math.random() * 2 - 1) * 6; // 稍微失諧會有拍頻，比較有厚度
		const g = ctx.createGain();
		g.gain.value = level * 0.42;
		o.connect(g).connect(lp);
		o.start();
		oscs.push(o);
	});

	return {
		out,
		stop() {
			oscs.forEach((o) => {
				try {
					o.stop();
				} catch {
					// 已經停了
				}
			});
			try {
				lfo.stop();
			} catch {
				// 已經停了
			}
			out.disconnect();
		}
	};
}

/** 夜蟲：低噪音底 + 稀疏的高頻蟲鳴。 */
function makeNight(ctx: AudioContext, bus: GainNode): Layer {
	const out = makeOut(ctx, bus);

	const bed = noiseBed(ctx);
	const lp = ctx.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.value = 700;
	const bedGain = ctx.createGain();
	bedGain.gain.value = 0.2;
	bed.connect(lp).connect(bedGain).connect(out);
	bed.start();

	let timer: ReturnType<typeof setTimeout> | null = null;
	const chirp = () => {
		const t = audioNow();
		// 一隻蟲叫一串，不是單一聲
		const bursts = 3 + Math.floor(Math.random() * 4);
		const base = 4200 + Math.random() * 2600;
		for (let i = 0; i < bursts; i++) {
			const at = t + i * 0.055;
			const o = ctx.createOscillator();
			o.type = 'triangle';
			o.frequency.value = base;
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, at);
			g.gain.exponentialRampToValueAtTime(0.05, at + 0.006);
			g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
			o.connect(g).connect(out);
			o.start(at);
			o.stop(at + 0.05);
		}
		timer = setTimeout(chirp, 900 + Math.random() * 2600);
	};
	chirp();

	return {
		out,
		stop() {
			if (timer !== null) clearTimeout(timer);
			try {
				bed.stop();
			} catch {
				// 已經停了
			}
			out.disconnect();
		}
	};
}

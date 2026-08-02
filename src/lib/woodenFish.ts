/**
 * 木魚聲：用 Web Audio API 即時合成，不用任何 mp3 音檔。
 *
 * ── 為什麼這樣做 ────────────────────────────────────────────
 * 木魚是「縫隙鼓」(slit drum)：中空腔體 + 一道開縫，聲音來自
 *   (a) 木頭被敲擊的板/塊振動模態
 *   (b) 腔體的 Helmholtz 共鳴（那個「空空的」感覺）
 * 這類敲擊樂器不能用單一 oscillator 表達。正確模型是「模態合成」：
 * 一組**非諧波**的衰減正弦（不是 1:2:3 整數倍，而是 1 : 2.4 : 3.9 …），
 * 而且高頻模態衰減得比低頻快。少了這點就會像電子琴。
 *
 * ── 四層結構 ────────────────────────────────────────────────
 *   1. mallet — 木槌撞擊的寬頻噪音（極短，~10ms）。這是「木頭感」的來源，
 *               絕對不能用方波/鋸齒，那些有整齊諧波，一聽就是合成器。
 *   2. modes  — 4 個非諧波模態正弦，各自的音量與衰減時間。聲音的主體。
 *   3. air    — 腔體共鳴：帶通噪音，做出中空的「噗」。
 *   4. master — 低通削掉電子感的高頻毛邊 + 高通去掉低頻糊音。
 *
 * 全部參數都在 WoodenFishOptions，要微調音色改這裡就好。
 */

export type WoodenFishOptions = {
	/** 基頻 (Hz)。大木魚 120–200、中 220–320、小手持 380–600 */
	frequency: number;
	/** 模態頻率比。非諧波才像木頭，整數倍會像管風琴 */
	modeRatios: number[];
	/** 各模態相對音量（長度對齊 modeRatios，會自動正規化） */
	modeGains: number[];
	/** 各模態衰減時間 (秒)。高頻模態要比低頻短，這是「木頭」的關鍵 */
	modeDecays: number[];
	/** 基頻模態在 attack 瞬間的音高下滑比例（1 = 不掉）。木頭被敲凹一下的感覺 */
	pitchDropRatio: number;
	/** 音高下滑時間 (秒) */
	pitchDropTime: number;

	/** 木槌撞擊噪音音量 0–1。這層決定「叩」有多硬 */
	malletLevel: number;
	/** 撞擊噪音的頻率重心 (Hz)。越高越像敲到硬木邊緣 */
	malletFrequency: number;
	/** 撞擊噪音的頻寬（Q 越小越寬、越像木頭；越大越像敲金屬） */
	malletQ: number;
	/** 撞擊噪音衰減 (秒)。~0.01 才夠脆 */
	malletDecay: number;

	/** 腔體共鳴音量 0–1（0 = 關掉），做出中空感 */
	airLevel: number;
	/** 腔體共鳴頻率相對基頻的倍數 */
	airRatio: number;
	/** 腔體共鳴衰減 (秒) */
	airDecay: number;

	/** 整體低通 (Hz)。削掉高頻毛邊，木頭不該有太多 5kHz 以上的東西 */
	lowpass: number;
	/** 整體高通 (Hz)。去掉悶住的低頻 */
	highpass: number;
	/** 總音量 0–1 */
	volume: number;
	/** 每敲隨機微調音高與音量（0.03 = ±3%），連敲時不會像機器人 */
	humanize: number;
};

/** 中型木魚，預設音色。 */
export const DEFAULT_OPTIONS: WoodenFishOptions = {
	frequency: 245,
	// 非諧波比例，取自板/塊狀振動體的典型模態分佈
	modeRatios: [1, 2.42, 3.94, 6.1],
	modeGains: [1, 0.42, 0.22, 0.1],
	modeDecays: [0.135, 0.085, 0.05, 0.028],
	pitchDropRatio: 0.9,
	pitchDropTime: 0.022,

	malletLevel: 0.42,
	malletFrequency: 1650,
	malletQ: 0.8,
	malletDecay: 0.011,

	airLevel: 0.16,
	airRatio: 1.55,
	airDecay: 0.06,

	lowpass: 4800,
	highpass: 80,
	volume: 0.55,
	humanize: 0.025
};

/** 幾組現成音色，方便直接換：playWoodenFish(PRESETS.small) */
export const PRESETS: Record<string, Partial<WoodenFishOptions>> = {
	/** 預設中型木魚 */
	classic: {},
	/** 小手持木魚：高、脆、更短 */
	small: {
		frequency: 430,
		modeDecays: [0.09, 0.055, 0.035, 0.02],
		malletFrequency: 2300,
		malletLevel: 0.5,
		airLevel: 0.1,
		lowpass: 6000
	},
	/** 大殿木魚：低、悶、腔體感重 */
	temple: {
		frequency: 150,
		modeRatios: [1, 2.28, 3.7, 5.4],
		modeDecays: [0.24, 0.15, 0.09, 0.05],
		malletFrequency: 1100,
		malletQ: 0.6,
		airLevel: 0.24,
		airDecay: 0.1,
		lowpass: 3200,
		volume: 0.6
	},
	/** 更鈍、更「肉」的敲法，像用包布的槌 */
	soft: {
		malletLevel: 0.2,
		malletFrequency: 900,
		malletDecay: 0.02,
		lowpass: 3000
	}
};

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** 取得（或初始化）共用的 AudioContext。必須在使用者互動時呼叫，iOS 才會解鎖。 */
function getContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	if (!ctx) {
		const AC = window.AudioContext ?? (window as any).webkitAudioContext;
		if (!AC) return null;
		ctx = new AC();
		masterGain = ctx.createGain();
		masterGain.gain.value = 1;
		masterGain.connect(ctx.destination);
	}
	// 手機瀏覽器常常把 context 掛在 suspended，敲之前叫醒它
	if (ctx.state === 'suspended') void ctx.resume();
	return ctx;
}

/** 在第一次使用者互動時呼叫，先把 audio 解鎖，第一敲才不會沒聲音。 */
export function unlockAudio(): void {
	getContext();
}

function getNoiseBuffer(audio: AudioContext): AudioBuffer {
	if (!noiseBuffer) {
		const length = Math.floor(audio.sampleRate * 0.25);
		noiseBuffer = audio.createBuffer(1, length, audio.sampleRate);
		const data = noiseBuffer.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
	}
	return noiseBuffer;
}

/** 短噪音爆發，當作「木槌」的激發訊號。 */
function noiseBurst(
	audio: AudioContext,
	at: number,
	level: number,
	decay: number,
	freq: number,
	q: number,
	destination: AudioNode
) {
	const src = audio.createBufferSource();
	src.buffer = getNoiseBuffer(audio);
	src.playbackRate.value = 0.85 + Math.random() * 0.3; // 每敲的噪音都不一樣
	// 從 buffer 的隨機位置開始，避免連敲時聽到同一段噪音
	const offset = Math.random() * 0.1;

	const filter = audio.createBiquadFilter();
	filter.type = 'bandpass';
	filter.frequency.setValueAtTime(freq, at);
	filter.Q.setValueAtTime(q, at);

	const gain = audio.createGain();
	gain.gain.setValueAtTime(level, at);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);

	src.connect(filter).connect(gain).connect(destination);
	src.start(at, offset);
	src.stop(at + decay + 0.05);
}

/**
 * 敲一下木魚。可傳入部分參數覆寫預設值：
 *   playWoodenFish({ frequency: 200, malletLevel: 0.6 })
 *   playWoodenFish(PRESETS.temple)
 */
export function playWoodenFish(overrides: Partial<WoodenFishOptions> = {}): void {
	const audio = getContext();
	if (!audio || !masterGain) return;

	const o: WoodenFishOptions = { ...DEFAULT_OPTIONS, ...overrides };
	const now = audio.currentTime;
	const jitter = 1 + (Math.random() * 2 - 1) * o.humanize;
	const f0 = Math.max(20, o.frequency * jitter);
	const vel = 1 - Math.random() * o.humanize * 2; // 力道也抖一下

	// ── 4. master chain：低通 → 高通 → masterGain ──
	const lp = audio.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.setValueAtTime(o.lowpass, now);
	lp.Q.setValueAtTime(0.7, now);

	const hp = audio.createBiquadFilter();
	hp.type = 'highpass';
	hp.frequency.setValueAtTime(o.highpass, now);

	const out = audio.createGain();
	out.gain.value = o.volume * vel;

	out.connect(lp).connect(hp).connect(masterGain);

	// ── 2. 模態：非諧波正弦，高頻的先死 ──
	const total = o.modeGains.reduce((a, b) => a + b, 0) || 1;
	o.modeRatios.forEach((ratio, i) => {
		const gainValue = (o.modeGains[i] ?? 0) / total;
		const decay = o.modeDecays[i] ?? 0.05;
		if (gainValue <= 0) return;

		const osc = audio.createOscillator();
		osc.type = 'sine';
		const freq = Math.max(20, f0 * ratio);
		osc.frequency.setValueAtTime(freq, now);
		if (i === 0 && o.pitchDropRatio !== 1) {
			// 只有基頻做 pitch drop——被敲的瞬間木頭形變
			osc.frequency.setValueAtTime(freq / o.pitchDropRatio, now);
			osc.frequency.exponentialRampToValueAtTime(freq, now + o.pitchDropTime);
		}

		const g = audio.createGain();
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(gainValue, now + 0.002); // 幾乎瞬間的 attack
		g.gain.exponentialRampToValueAtTime(0.0001, now + decay);

		osc.connect(g).connect(out);
		osc.start(now);
		osc.stop(now + decay + 0.05);
	});

	// ── 1. 木槌撞擊 ──
	if (o.malletLevel > 0) {
		noiseBurst(audio, now, o.malletLevel, o.malletDecay, o.malletFrequency, o.malletQ, out);
	}

	// ── 3. 腔體共鳴（中空感）──
	if (o.airLevel > 0) {
		noiseBurst(audio, now, o.airLevel, o.airDecay, f0 * o.airRatio, 6, out);
	}
}

/** 靜音開關（0–1）。 */
export function setMasterVolume(value: number): void {
	if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, value));
}

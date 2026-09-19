/**
 * 節拍器。自動敲的心臟。
 *
 * 為什麼不是 setInterval(() => strike(), 60000 / bpm)：
 * JS 的計時器精度受 event loop 影響，誤差累積下來幾分鐘就聽得出漂移，而且
 * 分頁切到背景會被節流到 ~1Hz，節奏直接散掉。
 *
 * 標準解法是 "A Tale of Two Clocks"：用一個粗略的計時器定期醒來，把未來一小段
 * 時間內的音訊事件「預先排程」到 AudioContext 的時鐘上。音訊硬體自己會準時發聲，
 * JS 晚幾毫秒醒來完全沒差。
 */
import { audioNow, outputLatency } from './woodenFish';

/** JS 醒來的頻率。夠密就好，這個迴圈本身很便宜。 */
const TICK_MS = 25;
/** 平常往前排多久的音。 */
const LOOKAHEAD_S = 0.12;
/**
 * 分頁被隱藏時往前排多久。
 *
 * 背景分頁的計時器被節流到約 1Hz，0.12 秒的視窗會斷掉。排 1.5 秒的量、一秒排一次，
 * 節奏依然精準（因為時間是記在 AudioContext 時鐘上）。代價是隱藏時按停止最多
 * 有 1.5 秒延遲，但那時使用者看不到畫面。
 */
const HIDDEN_LOOKAHEAD_S = 1.5;

/**
 * rAF 最快 ~16.7ms 一次，用「時間到了才放」會讓每一敲平均慢 8ms 且抖動 16ms。
 * 提前半個 frame 判定，早一點點感覺不出來，但一致性會讓節奏聽起來更緊。
 */
const VISUAL_LEAD_S = 0.008;

export type TickHandle = {
	/** 這一拍的 AudioContext 絕對時間（秒） */
	at: number;
	/** 這是本次啟動的第幾拍，從 0 開始 */
	index: number;
};

export type Metronome = {
	start(): void;
	stop(): void;
	/** 改速度。不會打斷正在跑的節奏。 */
	setBpm(bpm: number): void;
	readonly running: boolean;
	/**
	 * 已排程但還沒響到的拍數。
	 *
	 * 停止時這些音會被靜音壓掉，呼叫端若在 onSchedule 計數就要拿這個數字扣回去。
	 */
	readonly unheard: number;
};

export type MetronomeOptions = {
	bpm: number;
	/** 排音訊用。同步呼叫，不能 await——這裡面只該做 scheduling。 */
	onSchedule: (tick: TickHandle) => void;
	/** 真的聽得到的那一刻才呼叫。動畫與震動放這裡。 */
	onAudible: (tick: TickHandle) => void;
	/** 敲滿幾拍自動停。undefined = 無限。 */
	limit?: number;
	/**
	 * 漸慢：從起始 BPM 線性降到這個值，在 limit 拍內走完。
	 * 需要有 limit 才有意義（要知道總長度才能算斜率）。
	 */
	slowTo?: number;
	onComplete?: () => void;
};

export function createMetronome(opts: MetronomeOptions): Metronome {
	let bpm = clampBpm(opts.bpm);
	let running = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let raf = 0;

	/** 下一拍的 AudioContext 時間 */
	let nextAt = 0;
	let index = 0;
	/** 已排程但還沒「聽到」的拍，依 at 遞增排列 */
	let pending: TickHandle[] = [];
	/** stop() 當下還沒響到的拍數，留給呼叫端扣帳用 */
	let lastUnheard = 0;

	function lookahead(): number {
		const hidden = typeof document !== 'undefined' && document.hidden;
		return hidden ? HIDDEN_LOOKAHEAD_S : LOOKAHEAD_S;
	}

	/**
	 * 第 i 拍該用的速度。沒開漸慢就是固定值。
	 *
	 * 線性內插而不是等比：使用者調的是 BPM，線性降下去在感覺上就是「穩定變慢」。
	 */
	function bpmAt(i: number): number {
		if (opts.slowTo === undefined || !opts.limit || opts.limit < 2) return bpm;
		const ratio = Math.min(1, i / (opts.limit - 1));
		return clampBpm(bpm + (opts.slowTo - bpm) * ratio);
	}

	function schedule() {
		if (!running) return;
		const horizon = audioNow() + lookahead();

		while (nextAt < horizon) {
			if (opts.limit !== undefined && index >= opts.limit) {
				finish();
				return;
			}

			const tick: TickHandle = { at: nextAt, index };
			opts.onSchedule(tick);
			pending.push(tick);

			// 只推進間距，不重算 nextAt——setBpm 時已排好的拍就不會被挪動
			nextAt += 60 / bpmAt(index);
			index += 1;
		}
	}

	/**
	 * 動畫迴圈。只在播放中運行。
	 *
	 * 扣掉 outputLatency 是為了對準「聲音出喇叭」而不是「訊號進音訊圖」——
	 * 藍牙耳機可以差 150–300ms，少了這項畫面會明顯早於聲音。
	 */
	function drain() {
		if (!running) return;
		const t = audioNow() - outputLatency() + VISUAL_LEAD_S;

		// 落後時只補最後一拍，其餘丟掉：一個 frame 放五次動畫是閃屏不是節奏
		let due: TickHandle | null = null;
		while (pending.length && pending[0].at <= t) due = pending.shift()!;
		if (due) opts.onAudible(due);

		raf = requestAnimationFrame(drain);
	}

	function finish() {
		stop();
		opts.onComplete?.();
	}

	function start() {
		if (running) return;
		running = true;
		pending = [];
		lastUnheard = 0;
		index = 0;
		// 給一點起步緩衝，第一拍才不會因為排程來不及而被 clamp 成「立刻」
		nextAt = audioNow() + 0.06;

		schedule();
		timer = setInterval(schedule, TICK_MS);
		raf = requestAnimationFrame(drain);
	}

	function stop() {
		if (!running) return;
		running = false;
		if (timer !== null) clearInterval(timer);
		timer = null;
		cancelAnimationFrame(raf);
		raf = 0;
		// 留著給 unheard 讀，下次 start() 會重置
		lastUnheard = pending.length;
		pending = [];
	}

	return {
		start,
		stop,
		setBpm(next: number) {
			bpm = clampBpm(next);
		},
		get running() {
			return running;
		},
		get unheard() {
			return running ? pending.length : lastUnheard;
		}
	};
}

/** 30–120。再快木魚就像啄木鳥了，而且每個下游問題都變難。 */
export const BPM_MIN = 30;
export const BPM_MAX = 120;

export function clampBpm(bpm: number): number {
	if (!Number.isFinite(bpm)) return 60;
	return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
}

/**
 * 指定的分鐘數大約會敲幾拍。
 *
 * 固定速度時就是 minutes × bpm。開了漸慢之後每拍的間距都不一樣，沒有閉合解，
 * 所以直接累加模擬——幾百次迴圈而已，比推導公式好懂也不會錯。
 */
export function beatsForMinutes(minutes: number, bpm: number, slowTo?: number): number {
	const seconds = minutes * 60;
	if (slowTo === undefined || slowTo === bpm) return Math.max(1, Math.round(seconds * (bpm / 60)));

	// bpmAt 的斜率取決於總拍數，而總拍數又取決於斜率，所以用迭代逼近固定點。
	// 從平均速度起步，幾輪就收斂了。
	let guess = Math.max(1, Math.round((seconds * (bpm + slowTo)) / 2 / 60));
	for (let iter = 0; iter < 12; iter++) {
		let elapsed = 0;
		let beats = 0;
		while (elapsed < seconds && beats < guess * 4 + 8) {
			const ratio = guess > 1 ? Math.min(1, beats / (guess - 1)) : 1;
			elapsed += 60 / clampBpm(bpm + (slowTo - bpm) * ratio);
			beats += 1;
		}
		if (beats === guess) break;
		guess = beats;
	}
	return Math.max(1, guess);
}

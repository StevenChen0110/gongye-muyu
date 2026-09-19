/**
 * 敲擊的批次寫入。
 *
 * 自動敲 60 BPM 跑十分鐘是 600 下。一下一筆 INSERT 會產生 600 次寫入與
 * 600 次 realtime 廣播，把公開 feed 洗掉、也白白吃掉額度。
 * 這裡累積到一定數量或時間才寫一筆，用 knocks.count 記錄那一筆代表幾下。
 */
import type { Knock } from './supabase';

export type KnockBuffer = {
	/** 記一下（或多下）。傳負數是扣帳。到門檻會自動 flush。 */
	add(n?: number): void;
	/** 立刻把累積的寫出去。沒東西可寫就回 null。 */
	flush(): Promise<Knock | null>;
	/** 還沒寫出去的數量 */
	readonly pending: number;
	/** 拆掉計時器與事件監聽 */
	dispose(): void;
};

export function createKnockBuffer(opts: {
	write: (count: number) => Promise<Knock | null>;
	/** 累積到這麼多下就先寫一筆 */
	every?: number;
	/** 或是超過這麼久就寫 */
	afterMs?: number;
	/** 寫成功後回報，讓呼叫端把它推進 feed */
	onWritten?: (row: Knock) => void;
}): KnockBuffer {
	const every = opts.every ?? 30;
	const afterMs = opts.afterMs ?? 20_000;

	let pending = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** 避免同一批被 flush 兩次（例如門檻與計時器同時到） */
	let writing: Promise<Knock | null> | null = null;

	function clearTimer() {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	async function flush(): Promise<Knock | null> {
		clearTimer();
		if (writing) return writing;
		const n = pending;
		if (n <= 0) return null;
		pending = 0;

		writing = opts
			.write(n)
			.then((row) => {
				if (row) opts.onWritten?.(row);
				return row;
			})
			.catch((e) => {
				// 寫失敗就把數量還回去，下一次 flush 再試
				pending += n;
				console.warn('[knocks] 批次寫入失敗：', e);
				return null;
			})
			.finally(() => {
				writing = null;
			}) as Promise<Knock | null>;

		return writing;
	}

	function add(n = 1) {
		// 可以是負數：自動敲停止時要扣掉已排程但被靜音壓掉的拍
		pending = Math.max(0, pending + n);
		if (pending >= every) {
			void flush();
			return;
		}
		if (timer === null) timer = setTimeout(() => void flush(), afterMs);
	}

	// 關分頁／切到背景時先寫出去。最後一批仍可能在 pagehide 掉（supabase-js
	// 不走 sendBeacon），但 600 下掉十幾下不是問題，不值得為它過度設計。
	const onHide = () => {
		if (document.visibilityState === 'hidden') void flush();
	};
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', onHide);
	}

	return {
		add,
		flush,
		get pending() {
			return pending;
		},
		dispose() {
			clearTimer();
			if (typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', onHide);
				window.removeEventListener('pagehide', onHide);
			}
		}
	};
}

/**
 * 敲擊震動。
 *
 * 用 Vibration API（navigator.vibrate）。實話講在前面：
 * Android Chrome 支援，**iOS Safari 完全不支援**，所以 iPhone 上不會震。
 * 這是瀏覽器的限制，不是設定問題——iOS 只有原生 App 才能觸發震動。
 * 因此 isSupported() 為 false 時，UI 就不要顯示那顆開關，免得使用者
 * 一直以為是自己沒開。
 */

const KEY = 'muyu:haptics';

/** 這台裝置的瀏覽器到底能不能震。 */
export function isSupported(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function isEnabled(): boolean {
	if (typeof localStorage === 'undefined') return true;
	return localStorage.getItem(KEY) !== '0'; // 預設開
}

export function setEnabled(on: boolean): void {
	if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, on ? '1' : '0');
}

/**
 * 震一下。ms 由木魚尺寸決定（大顆震得沉一點）。
 * enabled 由呼叫端傳進來，避免每次敲都讀 localStorage。
 */
export function buzz(ms: number, enabled: boolean): void {
	if (!enabled || !isSupported()) return;
	try {
		navigator.vibrate(ms);
	} catch {
		// 某些瀏覽器在沒有使用者手勢時會丟錯，忽略即可
	}
}

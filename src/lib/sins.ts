/**
 * 懺悔的內容。三個罐頭預設 + 使用者自訂。
 *
 * `id` 會存進資料庫、也會出現在別人的即時 feed 裡：預設的是穩定代號
 * （gossip / complain / lie），自訂的則是 `custom:文字` —— 也就是說自訂
 * 內容是公開的。所以下面對長度和空白做了限制。
 */
export type Sin = {
	id: string;
	label: string;
	emoji: string;
};

export const PRESET_SINS: Sin[] = [
	{ id: 'gossip', label: '說了別人壞話', emoji: '🗣️' },
	{ id: 'complain', label: '抱怨個不停', emoji: '😮‍💨' },
	{ id: 'lie', label: '說謊 / 誇大', emoji: '🤥' }
];

const PRESET_MAP = new Map(PRESET_SINS.map((s) => [s.id, s]));

export const CUSTOM_PREFIX = 'custom:';
export const CUSTOM_EMOJI = '✏️';
export const CUSTOM_MAX_LEN = 12;

/**
 * 超度模式輸入的那件事。
 *
 * 比 CUSTOM_MAX_LEN 寬，因為「想放下的一件事」寫 12 個字太擠。
 * 這類文字比較私人，所以超度的紀錄 source='ritual'，不會進公開 feed。
 */
export const RITUAL_MAX_LEN = 24;
const CUSTOM_MAX_COUNT = 6;
const CUSTOM_KEY = 'muyu:custom-sins';

export function isCustom(id: string): boolean {
	return id.startsWith(CUSTOM_PREFIX);
}

/** 拿到顯示用的文字；遇到不認得的 id（例如舊資料）就原樣顯示。 */
export function sinLabel(id: string): string {
	if (isCustom(id)) return id.slice(CUSTOM_PREFIX.length);
	return PRESET_MAP.get(id)?.label ?? id;
}

export function sinEmoji(id: string): string {
	if (isCustom(id)) return CUSTOM_EMOJI;
	return PRESET_MAP.get(id)?.emoji ?? '🔔';
}

/** 換行、連續空白都壓成一格，再砍到上限。 */
export function normalizeCustom(raw: string): string {
	return raw.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_MAX_LEN);
}

export function loadCustomSins(): Sin[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
		if (!Array.isArray(raw)) return [];
		return raw
			.filter((t): t is string => typeof t === 'string')
			.map(normalizeCustom)
			.filter(Boolean)
			.slice(0, CUSTOM_MAX_COUNT)
			.map(toCustomSin);
	} catch {
		return [];
	}
}

function toCustomSin(text: string): Sin {
	return { id: CUSTOM_PREFIX + text, label: text, emoji: CUSTOM_EMOJI };
}

/** 加一則自訂。回傳新的清單；重複或空字串就原樣退回。 */
export function addCustomSin(list: Sin[], raw: string): { list: Sin[]; added: Sin | null } {
	const text = normalizeCustom(raw);
	if (!text) return { list, added: null };
	const sin = toCustomSin(text);
	if (list.some((s) => s.id === sin.id)) return { list, added: sin };

	const next = [...list, sin].slice(-CUSTOM_MAX_COUNT);
	saveCustomSins(next);
	return { list: next, added: sin };
}

export function removeCustomSin(list: Sin[], id: string): Sin[] {
	const next = list.filter((s) => s.id !== id);
	saveCustomSins(next);
	return next;
}

export function customLimitReached(list: Sin[]): boolean {
	return list.length >= CUSTOM_MAX_COUNT;
}

function saveCustomSins(list: Sin[]): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.map((s) => s.label)));
}

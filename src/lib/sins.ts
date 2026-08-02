/**
 * 固定 6 個罐頭口業。這一版不開放自由填字，避免內容審核。
 * `id` 存進資料庫（穩定、可統計），`label` 只是顯示用。
 */
export type Sin = {
	id: string;
	label: string;
	emoji: string;
};

export const SINS: Sin[] = [
	{ id: 'gossip', label: '說了別人壞話', emoji: '🗣️' },
	{ id: 'complain', label: '抱怨個不停', emoji: '😮‍💨' },
	{ id: 'talkback', label: '跟長輩頂嘴', emoji: '🙄' },
	{ id: 'nonsense', label: '講幹話 / 開黃腔', emoji: '🍆' },
	{ id: 'sarcasm', label: '酸別人 / 冷嘲熱諷', emoji: '🍋' },
	{ id: 'lie', label: '說謊 / 誇大', emoji: '🤥' }
];

const SIN_MAP = new Map(SINS.map((s) => [s.id, s]));

/** 拿到顯示用的口業；遇到不認得的 id（例如舊資料）就原樣顯示。 */
export function sinLabel(id: string): string {
	return SIN_MAP.get(id)?.label ?? id;
}

export function sinEmoji(id: string): string {
	return SIN_MAP.get(id)?.emoji ?? '🔔';
}

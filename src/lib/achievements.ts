/**
 * 成就。全部從 knock_stats() 回傳的那包數字推導，前端不另外記帳——
 * 換裝置、清 localStorage 都不會弄丟。
 */
export type Stats = {
	total: number;
	today: number;
	/** 連續有敲的天數，斷了就歸零 */
	streak: number;
	/** 總共有幾天敲過 */
	days: number;
	/** 用過幾種不同的懺悔內容 */
	sins: number;
	customs: number;
	woods: number;
	groups: number;
	/** 凌晨 5 點前敲的次數 */
	nights: number;
	top_sin: string | null;
	first_at: string | null;
	/** 這個身分在 users 表建立的時間 */
	joined: string | null;
};

export const EMPTY_STATS: Stats = {
	total: 0,
	today: 0,
	streak: 0,
	days: 0,
	sins: 0,
	customs: 0,
	woods: 0,
	groups: 0,
	nights: 0,
	top_sin: null,
	first_at: null,
	joined: null
};

export type Achievement = {
	id: string;
	name: string;
	desc: string;
	emoji: string;
	goal: number;
	of: (s: Stats) => number;
};

export const ACHIEVEMENTS: Achievement[] = [
	{ id: 'first', name: '初發心', desc: '敲下第一聲', emoji: '🪷', goal: 1, of: (s) => s.total },
	{ id: 'ten', name: '十念', desc: '累積敲滿 10 下', emoji: '🔔', goal: 10, of: (s) => s.total },
	{
		id: 'mala',
		name: '百八煩惱',
		desc: '累積敲滿 108 下',
		emoji: '📿',
		goal: 108,
		of: (s) => s.total
	},
	{
		id: 'thousand',
		name: '千錘百鍊',
		desc: '累積敲滿 1000 下',
		emoji: '⛰️',
		goal: 1000,
		of: (s) => s.total
	},
	{
		id: 'three',
		name: '三業俱懺',
		desc: '三種懺悔內容都用過',
		emoji: '🗣️',
		goal: 3,
		of: (s) => s.sins
	},
	{
		id: 'own-words',
		name: '自省',
		desc: '用自己寫的話懺悔一次',
		emoji: '✏️',
		goal: 1,
		of: (s) => s.customs
	},
	{
		id: 'woods',
		name: '遍嘗百木',
		desc: '敲過 3 種不同木材',
		emoji: '🪵',
		goal: 3,
		of: (s) => s.woods
	},
	{
		id: 'streak',
		name: '七日精進',
		desc: '連續七天都有敲',
		emoji: '📅',
		goal: 7,
		of: (s) => s.streak
	},
	{
		id: 'night',
		name: '夜半鐘聲',
		desc: '在凌晨五點前敲過',
		emoji: '🌙',
		goal: 1,
		of: (s) => s.nights
	},
	{
		id: 'together',
		name: '共業',
		desc: '在群組裡敲滿 10 下',
		emoji: '👥',
		goal: 10,
		of: (s) => s.groups
	}
];

export type Earned = Achievement & { value: number; done: boolean; ratio: number };

export function evaluate(stats: Stats): Earned[] {
	return ACHIEVEMENTS.map((a) => {
		const value = Math.max(0, a.of(stats));
		return {
			...a,
			value,
			done: value >= a.goal,
			ratio: Math.min(1, value / a.goal)
		};
	});
}

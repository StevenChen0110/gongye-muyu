import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { getIdentity, makeGroupCode } from './identity';
import type { Stats } from './achievements';

// 用 dynamic（而非 static）env：static 版在變數缺席時會直接讓 build 失敗，
// 這個專案刻意允許「沒設 Supabase 也要 build/跑得起來」（見 isConfigured）。
const PUBLIC_SUPABASE_URL = env.PUBLIC_SUPABASE_URL ?? '';
const PUBLIC_SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY ?? '';

export type Knock = {
	id: number;
	sin: string | null;
	fish: string | null;
	group_id: string | null;
	created_at: string;
	/** 這一筆代表幾下。自動敲會批次寫入，一筆可能是幾十下。 */
	count: number;
	/** manual / auto / ritual。公開 feed 只看 manual。 */
	source: string;
};

export type Group = {
	id: string;
	code: string;
	title: string;
	knock_count: number;
};

export type RankRow = {
	id: string;
	nickname: string;
	knock_count: number;
};

export type UserRow = {
	id: string;
	nickname: string;
	knock_count: number;
	auth_id: string | null;
};

/** 沒設好環境變數時不要整頁炸掉——木魚照樣能敲，只是沒有共業。 */
export const isConfigured = Boolean(PUBLIC_SUPABASE_URL) && Boolean(PUBLIC_SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = isConfigured
	? createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
			// 要記得登入狀態，重整才不會被登出
			auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
			realtime: { params: { eventsPerSecond: 10 } }
		})
	: null;

/** 確保自己在 users 表裡有一筆。已存在就什麼都不做。 */
export async function ensureUser(): Promise<void> {
	if (!supabase) return;
	const me = getIdentity();
	const { error } = await supabase
		.from('users')
		.upsert({ id: me.id, nickname: me.nickname }, { onConflict: 'id', ignoreDuplicates: true });
	if (error) console.warn('[users] 註冊失敗：', error.message);
}

/**
 * 登入後把本機的匿名身分收編成帳號身分，回傳帳號那一列。
 *
 * 合併邏輯全在 DB 的 claim_identity() 裡（security definer），前端沒有
 * update users 的權限——不然誰都能改別人的暱稱和排行數字。
 */
export async function claimIdentity(): Promise<UserRow | null> {
	if (!supabase) return null;
	const me = getIdentity();
	const { data, error } = await supabase
		.rpc('claim_identity', { anon_id: me.id, fallback_nickname: me.nickname })
		.single<UserRow>();
	if (error) {
		console.warn('[auth] 身分收編失敗：', error.message);
		return null;
	}
	return data;
}

/**
 * 改暱稱。DB 沒接起來時也要能改，所以呼叫端不能只靠這裡的回傳值——
 * localStorage 那邊要各自更新。
 */
export async function updateNickname(nickname: string): Promise<string | null> {
	if (!supabase) return null;
	const me = getIdentity();
	const { error } = await supabase.rpc('set_nickname', {
		target: me.id,
		new_nickname: nickname
	});
	return error ? error.message : null;
}

/**
 * 刪除帳號。不可復原。
 *
 * 敲擊紀錄會留下但跟你脫鉤（user_id 設成 null）——「大家一共」是全站共有的
 * 數字，不該因為有人退出就當場倒退。暱稱、登入帳號、個人統計全部消失。
 *
 * 邏輯全在 DB 的 delete_account() 裡：前端沒有刪 auth.users 的權限。
 */
export async function deleteAccount(): Promise<string | null> {
	if (!supabase) return '沒有連上伺服器';
	const { error } = await supabase.rpc('delete_account');
	if (error) return error.message;
	await supabase.auth.signOut();
	return null;
}

/** 冷啟動用：抓最近的懺悔，讓 feed 一開始就有真實內容而不是空白。 */
export async function fetchRecentKnocks(limit = 30, groupId: string | null = null): Promise<Knock[]> {
	if (!supabase) return [];
	let q = supabase
		.from('knocks')
		.select('id, sin, fish, group_id, created_at, count, source')
		.order('id', { ascending: false })
		.limit(limit);
	// 個人/公開 feed 只看沒有群組的敲擊，免得別人的群組內容外流；
	// 而且只留手動懺悔——自動敲會洗版，超渡的內容比較私人
	q = groupId ? q.eq('group_id', groupId) : q.is('group_id', null).eq('source', 'manual');

	const { data, error } = await q;
	if (error) {
		console.warn('[knocks] 讀取歷史失敗：', error.message);
		return [];
	}
	return data ?? [];
}

/** 功德簿要的那包統計。算在 DB，不把整串 knocks 拉回前端。 */
export async function fetchMyStats(): Promise<Stats | null> {
	if (!supabase) return null;
	const me = getIdentity();
	const { data, error } = await supabase.rpc('knock_stats', { target: me.id });
	if (error) {
		console.warn('[stats] 讀取失敗：', error.message);
		return null;
	}
	return data as Stats;
}

/**
 * 至今總共敲了幾下（不分群組）。
 *
 * 要的是「幾下」不是「幾筆」，所以不能用 count: 'exact'——一筆可能代表
 * 自動敲的好幾十下。改用 users.knock_count 的總和，那是 trigger 維護的。
 */
export async function fetchTotalCount(): Promise<number> {
	if (!supabase) return 0;
	const { data, error } = await supabase.rpc('total_knocks');
	if (error) {
		console.warn('[knocks] 讀取總數失敗：', error.message);
		return 0;
	}
	return Number(data ?? 0);
}

/**
 * 寫入一筆敲擊。sin 只有個人模式有，group_id 只有群組模式有。
 *
 * count 讓一筆代表多下（自動敲批次寫入用）；source 決定它進不進公開 feed。
 */
export async function insertKnock(opts: {
	sin?: string | null;
	groupId?: string | null;
	fish?: string | null;
	count?: number;
	source?: 'manual' | 'auto' | 'ritual';
}): Promise<Knock | null> {
	if (!supabase) return null;
	const me = getIdentity();
	const { data, error } = await supabase
		.from('knocks')
		.insert({
			sin: opts.sin ?? null,
			group_id: opts.groupId ?? null,
			fish: opts.fish ?? null,
			count: Math.max(1, Math.min(5000, Math.round(opts.count ?? 1))),
			source: opts.source ?? 'manual',
			user_id: me.id
		})
		.select('id, sin, fish, group_id, created_at, count, source')
		.single();
	if (error) {
		console.warn('[knocks] 寫入失敗：', error.message);
		return null;
	}
	return data;
}

/** 訂閱敲擊。groupId 為 null 時只收個人/公開的那些。 */
export function subscribeToKnocks(
	onKnock: (knock: Knock) => void,
	groupId: string | null = null
): () => void {
	if (!supabase) return () => {};
	const channel: RealtimeChannel = supabase
		.channel(`knocks-${groupId ?? 'public'}`)
		.on(
			'postgres_changes',
			{
				event: 'INSERT',
				schema: 'public',
				table: 'knocks',
				...(groupId ? { filter: `group_id=eq.${groupId}` } : {})
			},
			(payload) => {
				const k = payload.new as Knock;
				// 公開 feed 要自己濾掉別人群組的敲擊（realtime 無法 filter is null），
				// 以及自動敲/超渡的紀錄
				if (!groupId && (k.group_id || k.source !== 'manual')) return;
				onKnock(k);
			}
		)
		.subscribe();

	return () => {
		void supabase?.removeChannel(channel);
	};
}

// ── 群組 ────────────────────────────────────────────────────

/** 開一個新群。邀請碼撞號就重試。 */
export async function createGroup(title: string): Promise<Group | null> {
	if (!supabase) return null;
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = makeGroupCode();
		const { data, error } = await supabase
			.from('groups')
			.insert({ code, title })
			.select('id, code, title, knock_count')
			.single();
		if (!error) return data;
		if (error.code !== '23505') {
			// 23505 = unique violation，撞號才重試，其他錯誤直接放棄
			console.warn('[groups] 建立失敗：', error.message);
			return null;
		}
	}
	console.warn('[groups] 邀請碼連續撞號，放棄');
	return null;
}

export async function fetchGroupByCode(code: string): Promise<Group | null> {
	if (!supabase) return null;
	const { data, error } = await supabase
		.from('groups')
		.select('id, code, title, knock_count')
		.eq('code', code.toUpperCase())
		.maybeSingle();
	if (error) {
		console.warn('[groups] 查詢失敗：', error.message);
		return null;
	}
	return data;
}

// ── 排行 ────────────────────────────────────────────────────

/** 敲最多的人。計數由 DB trigger 維護，不是前端算的。 */
export async function fetchRanking(limit = 20): Promise<RankRow[]> {
	if (!supabase) return [];
	const { data, error } = await supabase
		.from('users')
		.select('id, nickname, knock_count')
		.order('knock_count', { ascending: false })
		.limit(limit);
	if (error) {
		console.warn('[users] 讀取排行失敗：', error.message);
		return [];
	}
	return data ?? [];
}

/** 自己目前累積幾下（以 DB 為準，跨頁面重整也對得上）。 */
export async function fetchMyCount(): Promise<number | null> {
	if (!supabase) return null;
	const me = getIdentity();
	const { data, error } = await supabase
		.from('users')
		.select('knock_count')
		.eq('id', me.id)
		.maybeSingle();
	if (error || !data) return null;
	return data.knock_count;
}

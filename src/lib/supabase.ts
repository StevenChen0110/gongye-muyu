import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

// 用 dynamic（而非 static）env：static 版在變數缺席時會直接讓 build 失敗，
// 這個專案刻意允許「沒設 Supabase 也要 build/跑得起來」（見 isConfigured）。
const PUBLIC_SUPABASE_URL = env.PUBLIC_SUPABASE_URL ?? '';
const PUBLIC_SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY ?? '';

export type Knock = {
	id: number;
	sin: string;
	created_at: string;
};

/** 沒設好環境變數時不要整頁炸掉——木魚照樣能敲，只是沒有共業。 */
export const isConfigured =
	Boolean(PUBLIC_SUPABASE_URL) && Boolean(PUBLIC_SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = isConfigured
	? createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
			auth: { persistSession: false },
			realtime: { params: { eventsPerSecond: 10 } }
		})
	: null;

/** 冷啟動用：抓最近的懺悔，讓 feed 一開始就有真實內容而不是空白。 */
export async function fetchRecentKnocks(limit = 30): Promise<Knock[]> {
	if (!supabase) return [];
	const { data, error } = await supabase
		.from('knocks')
		.select('id, sin, created_at')
		.order('id', { ascending: false })
		.limit(limit);
	if (error) {
		console.warn('[knocks] 讀取歷史失敗：', error.message);
		return [];
	}
	return data ?? [];
}

/** 至今總共有幾個人承認造口業。 */
export async function fetchTotalCount(): Promise<number> {
	if (!supabase) return 0;
	const { count, error } = await supabase
		.from('knocks')
		.select('*', { count: 'exact', head: true });
	if (error) {
		console.warn('[knocks] 讀取總數失敗：', error.message);
		return 0;
	}
	return count ?? 0;
}

/** 寫入一筆懺悔，回傳寫進去的那一筆（讓自己的敲擊也能立刻進 feed 並用 id 去重）。 */
export async function insertKnock(sin: string): Promise<Knock | null> {
	if (!supabase) return null;
	const { data, error } = await supabase
		.from('knocks')
		.insert({ sin })
		.select('id, sin, created_at')
		.single();
	if (error) {
		console.warn('[knocks] 寫入失敗：', error.message);
		return null;
	}
	return data;
}

/** 訂閱別人的懺悔。回傳 unsubscribe。 */
export function subscribeToKnocks(onKnock: (knock: Knock) => void): () => void {
	if (!supabase) return () => {};
	const channel: RealtimeChannel = supabase
		.channel('knocks-feed')
		.on(
			'postgres_changes',
			{ event: 'INSERT', schema: 'public', table: 'knocks' },
			(payload) => onKnock(payload.new as Knock)
		)
		.subscribe();

	return () => {
		void supabase?.removeChannel(channel);
	};
}

/** 匿名 session id，只放在 localStorage，不進 DB。 */
export function getSessionId(): string {
	if (typeof localStorage === 'undefined') return 'anon';
	const KEY = 'muyu:session-id';
	let id = localStorage.getItem(KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(KEY, id);
	}
	return id;
}

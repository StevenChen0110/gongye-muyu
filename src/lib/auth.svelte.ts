/**
 * 登入。Email + 密碼，走 Supabase Auth。
 *
 * 這個 app 的前提是「不登入也能敲」，所以登入是選配：登入之後才把
 * localStorage 那顆匿名 id 收編成帳號（見 claimIdentity），跨裝置才對得上。
 */
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from './supabase';

type AuthState = {
	session: Session | null;
	/** 還沒問完 Supabase 之前不要急著畫「未登入」，會閃一下 */
	ready: boolean;
};

export const auth = $state<AuthState>({ session: null, ready: !isConfigured });

export const userEmail = () => auth.session?.user.email ?? null;

/** 已經替哪個帳號收編過了。SIGNED_IN 可能因為換頁籤、換 token 重複觸發。 */
let claimedFor: string | null = null;

/**
 * 開始監聽登入狀態。回傳解除訂閱的函式。
 *
 * 注意 callback 裡不能直接 await supabase 的呼叫（supabase-js 的已知死鎖），
 * 所以 handler 一律丟到下一個 tick 再跑。
 */
export function initAuth(handlers: {
	onSignedIn: (session: Session) => void | Promise<void>;
	onSignedOut: () => void | Promise<void>;
}): () => void {
	if (!supabase) {
		auth.ready = true;
		return () => {};
	}

	const { data } = supabase.auth.onAuthStateChange((event, session) => {
		auth.session = session;
		if (event === 'INITIAL_SESSION') auth.ready = true;

		if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
			if (claimedFor === session.user.id) return;
			claimedFor = session.user.id;
			setTimeout(() => void handlers.onSignedIn(session), 0);
		}

		if (event === 'SIGNED_OUT') {
			claimedFor = null;
			setTimeout(() => void handlers.onSignedOut(), 0);
		}
	});

	return () => data.subscription.unsubscribe();
}

/** 註冊。回傳 needsConfirm 代表信箱驗證還開著，要去收信才算數。 */
export async function signUp(
	email: string,
	password: string
): Promise<{ error: string | null; needsConfirm: boolean }> {
	if (!supabase) return { error: '還沒接上 Supabase。', needsConfirm: false };
	const { data, error } = await supabase.auth.signUp({ email, password });
	if (error) return { error: translate(error.message), needsConfirm: false };
	return { error: null, needsConfirm: !data.session };
}

export async function signIn(email: string, password: string): Promise<string | null> {
	if (!supabase) return '還沒接上 Supabase。';
	const { error } = await supabase.auth.signInWithPassword({ email, password });
	return error ? translate(error.message) : null;
}

export async function signOut(): Promise<void> {
	await supabase?.auth.signOut();
}

/** Supabase 的錯誤訊息是英文的，挑常見的幾種翻掉。 */
function translate(msg: string): string {
	const m = msg.toLowerCase();
	if (m.includes('invalid login credentials')) return '信箱或密碼不對。';
	if (m.includes('email not confirmed')) return '信箱還沒驗證，去收一下信。';
	if (m.includes('user already registered')) return '這個信箱已經註冊過了，直接登入吧。';
	if (m.includes('password should be at least')) return '密碼太短，至少 6 個字。';
	if (m.includes('invalid') && m.includes('email')) return '信箱格式看起來不對。';
	if (m.includes('rate limit') || m.includes('too many')) return '試太多次了，等一下再來。';
	return msg;
}

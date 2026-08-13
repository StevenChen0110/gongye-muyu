/**
 * 身分。預設是匿名：id 存在 localStorage，就是「你」。
 *
 * 代價講清楚：匿名狀態下換瀏覽器或清掉 localStorage 就變成新的人，累積的
 * 敲擊數找不回來。登入（見 auth.svelte.ts）會把這顆 id 收編成帳號，之後
 * 換裝置登入就會拿回同一個身分。
 */

const ID_KEY = 'muyu:user-id';
const NAME_KEY = 'muyu:nickname';

// 自嘲但不攻擊人的名字組合
const TRAITS = ['嘴快', '心軟', '嘴賤', '愛講', '無心', '後悔', '老實', '碎嘴', '好氣', '嘴硬'];
const ROLES = ['的香客', '的施主', '小沙彌', '的路人', '的居士', '的凡人'];

export const NICKNAME_MAX_LEN = 12;

/** 擲骰子用的隨機暱稱。 */
export function randomNickname(): string {
	const t = TRAITS[Math.floor(Math.random() * TRAITS.length)];
	const r = ROLES[Math.floor(Math.random() * ROLES.length)];
	return `${t}${r}`;
}

export type Identity = { id: string; nickname: string };

/** 取得（必要時建立）本機的匿名身分。 */
export function getIdentity(): Identity {
	if (typeof localStorage === 'undefined') {
		return { id: '00000000-0000-0000-0000-000000000000', nickname: '路過的凡人' };
	}

	let id = localStorage.getItem(ID_KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(ID_KEY, id);
	}

	let nickname = localStorage.getItem(NAME_KEY);
	if (!nickname) {
		nickname = randomNickname();
		localStorage.setItem(NAME_KEY, nickname);
	}

	return { id, nickname };
}

/** 登入收編之後，把本機記的身分換成帳號上的那一組。 */
export function setIdentity(id: string, nickname: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(ID_KEY, id);
	localStorage.setItem(NAME_KEY, nickname);
}

/**
 * 登出：換一個全新的匿名身分。
 *
 * 不是只把 session 丟掉就好——留著帳號的 id 會讓登出後的敲擊繼續記到那個
 * 帳號頭上，那不叫登出。
 */
export function resetIdentity(): Identity {
	if (typeof localStorage === 'undefined') return getIdentity();
	localStorage.removeItem(ID_KEY);
	localStorage.removeItem(NAME_KEY);
	localStorage.removeItem('muyu:merit');
	return getIdentity();
}

/** 群組邀請碼：去掉容易看錯的 0/O/1/I。 */
export function makeGroupCode(length = 6): string {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';
	for (let i = 0; i < length; i++) {
		code += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return code;
}

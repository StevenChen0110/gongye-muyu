<script lang="ts">
	/** 登入 / 註冊的彈窗。不登入也能用這個 app，所以這裡永遠是可以關掉的。 */
	import { auth, signIn, signUp, signOut } from './auth.svelte';

	let {
		open,
		nickname = '',
		merit = 0,
		onClose
	}: {
		open: boolean;
		nickname?: string;
		merit?: number;
		onClose: () => void;
	} = $props();

	let tab = $state<'in' | 'up'>('in');
	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	const signedIn = $derived(Boolean(auth.session));

	function reset() {
		error = '';
		notice = '';
		password = '';
	}

	function switchTab(t: 'in' | 'up') {
		tab = t;
		reset();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		const mail = email.trim();
		if (!mail || !password) {
			error = '信箱和密碼都要填。';
			return;
		}
		busy = true;
		error = '';
		notice = '';

		if (tab === 'in') {
			const err = await signIn(mail, password);
			busy = false;
			if (err) {
				error = err;
				return;
			}
			password = '';
			onClose();
		} else {
			const res = await signUp(mail, password);
			busy = false;
			if (res.error) {
				error = res.error;
				return;
			}
			password = '';
			// 信箱驗證還開著的話不會直接拿到 session，得先去收信
			if (res.needsConfirm) notice = `驗證信寄到 ${mail} 了，點完連結再回來登入。`;
			else onClose();
		}
	}

	async function out() {
		busy = true;
		await signOut();
		busy = false;
		onClose();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window on:keydown={onKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={onClose}></div>

	<div class="sheet" role="dialog" aria-modal="true" aria-label="施主">
		<button class="close" onclick={onClose} aria-label="關閉">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
		</button>

		{#if signedIn}
			<h2>施主資料</h2>
			<!-- 暱稱改在功德簿那頁編輯，這裡只留登入狀態 -->
			<dl class="info">
				<dt>暱稱</dt>
				<dd>{nickname}</dd>
				<dt>信箱</dt>
				<dd>{auth.session?.user.email}</dd>
				<dt>功德</dt>
				<dd>{merit.toLocaleString('en-US')} 下</dd>
			</dl>

			<button class="ghost" onclick={out} disabled={busy}>登出</button>
		{:else}
			<h2>施主</h2>
			<p class="lead">
				你現在叫「{nickname}」。不登入也能敲；註冊之後才能自己取名字，換裝置也找得回功德。
			</p>

			<div class="tabs" style="--i: {tab === 'in' ? 0 : 1}">
				<span class="thumb" aria-hidden="true"></span>
				<button class:active={tab === 'in'} onclick={() => switchTab('in')}>登入</button>
				<button class:active={tab === 'up'} onclick={() => switchTab('up')}>註冊</button>
			</div>

			<form onsubmit={submit}>
				<label>
					<span>信箱</span>
					<input
						type="email"
						bind:value={email}
						autocomplete="email"
						placeholder="you@example.com"
						required
					/>
				</label>
				<label>
					<span>密碼</span>
					<input
						type="password"
						bind:value={password}
						autocomplete={tab === 'in' ? 'current-password' : 'new-password'}
						placeholder={tab === 'up' ? '至少 6 個字' : ''}
						minlength="6"
						required
					/>
				</label>

				{#if error}<p class="error">{error}</p>{/if}
				{#if notice}<p class="notice">{notice}</p>{/if}

				<button class="primary" type="submit" disabled={busy}>
					{busy ? '請稍候…' : tab === 'in' ? '登入' : '建立帳號'}
				</button>
			</form>

			{#if tab === 'up'}
				<p class="fine">註冊時，你這台裝置目前累積的功德會一起帶進帳號。</p>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: rgba(42, 36, 29, 0.28);
		backdrop-filter: blur(2px);
		-webkit-backdrop-filter: blur(2px);
	}

	.sheet {
		position: fixed;
		z-index: 91;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(92vw, 360px);
		padding: 1.6rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lift);
	}

	.close {
		position: absolute;
		top: 0.85rem;
		right: 0.85rem;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: var(--r-full);
		color: var(--ink-faint);
		transition: background var(--fast), color var(--fast);
	}

	.close:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.close svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
	}

	h2 {
		margin: 0 0 0.3rem;
		font-family: var(--serif);
		font-size: 1.1rem;
		font-weight: 600;
		letter-spacing: 0.08em;
	}

	.lead {
		margin: 0 0 1rem;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}

	/* ── 施主資料 ── */
	.info {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.35rem 0.9rem;
		margin: 0.9rem 0 1.1rem;
		padding-bottom: 0.9rem;
		font-size: 0.82rem;
		border-bottom: 1px solid var(--line-soft);
	}

	.info dt {
		color: var(--ink-faint);
	}

	.info dd {
		margin: 0;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* 登出不該長得像主要動作 */
	.ghost {
		width: 100%;
		padding: 0.55rem;
		font-size: 0.84rem;
		color: var(--ink-soft);
		background: var(--surface-2);
		border-radius: var(--r-sm);
	}

	.ghost:hover {
		color: var(--ink);
	}

	/* 登入 / 註冊：跟木魚選擇器同一套 segmented control */
	.tabs {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 3px;
		margin-bottom: 1rem;
		background: var(--surface-2);
		border-radius: var(--r-sm);
	}

	.thumb {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 3px;
		width: calc(50% - 3px);
		background: var(--surface);
		border-radius: calc(var(--r-sm) - 3px);
		box-shadow: var(--shadow-soft);
		transform: translateX(calc(var(--i) * 100%));
		transition: transform var(--slow);
	}

	.tabs button {
		position: relative;
		z-index: 1;
		padding: 0.4rem;
		font-size: 0.84rem;
		color: var(--ink-soft);
		transition: color var(--fast);
	}

	.tabs button.active {
		color: var(--ink);
		font-weight: 600;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.76rem;
		color: var(--ink-soft);
	}

	input {
		padding: 0.6rem 0.7rem;
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		transition: border-color var(--fast);
	}

	input:focus {
		outline: none;
		border-color: var(--saffron);
	}

	.primary {
		margin-top: 0.3rem;
		padding: 0.62rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: #fff;
		background: var(--saffron);
		border-radius: var(--r-sm);
		transition: transform var(--fast), opacity var(--fast);
	}

	.primary:active {
		transform: scale(0.985);
	}

	.primary:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.error,
	.notice,
	.fine {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.5;
	}

	.error {
		color: #a2503a;
	}

	.notice {
		color: var(--celadon);
	}

	.fine {
		margin-top: 0.8rem;
		color: var(--ink-faint);
	}
</style>

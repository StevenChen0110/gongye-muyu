<script lang="ts">
	/**
	 * 「加到主畫面」的提示。
	 *
	 * 為什麼要自己做：Android/Chrome 會給 beforeinstallprompt，可以用一顆按鈕
	 * 直接裝；但 **iOS Safari 沒有這個事件**，只能教使用者按「分享 → 加入主畫面」。
	 * 不講的話幾乎沒有人會自己想到，而這個 app 加到主畫面之後才有 App 的樣子
	 * （全螢幕、有圖示、離線可用）。
	 *
	 * 出現時機刻意保守：敲過幾下、確定這個人有在用，才提。一進來就跳出來要人
	 * 安裝是最惹人厭的那種。關掉之後就不再出現。
	 */
	import { fly } from 'svelte/transition';

	let { knocks }: { knocks: number } = $props();

	const KEY = 'muyu:install-hint';
	/** 敲滿這麼多下才提——確定不是路過的人 */
	const AFTER = 12;

	let dismissed = $state(true); // 預設不顯示，onMount 讀完 localStorage 才決定
	let deferred = $state<BeforeInstallPromptEvent | null>(null);
	let isIOS = $state(false);
	let standalone = $state(true); // 同上，先假設已安裝

	type BeforeInstallPromptEvent = Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	};

	$effect(() => {
		dismissed = localStorage.getItem(KEY) === '1';

		const ua = navigator.userAgent;
		// iPadOS 13+ 的 UA 會偽裝成 Mac，用觸控點數再判一次
		isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

		standalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			// iOS 專屬的判斷方式
			(navigator as Navigator & { standalone?: boolean }).standalone === true;

		const onPrompt = (e: Event) => {
			e.preventDefault(); // 擋掉瀏覽器自己的橫幅，改由我們決定時機
			deferred = e as BeforeInstallPromptEvent;
		};
		window.addEventListener('beforeinstallprompt', onPrompt);
		return () => window.removeEventListener('beforeinstallprompt', onPrompt);
	});

	/** 已經裝了、關掉過、或還沒敲夠，都不要吵他 */
	const show = $derived(!standalone && !dismissed && knocks >= AFTER && (isIOS || !!deferred));

	function close() {
		dismissed = true;
		localStorage.setItem(KEY, '1');
	}

	async function install() {
		if (!deferred) return;
		await deferred.prompt();
		await deferred.userChoice;
		deferred = null;
		close();
	}
</script>

{#if show}
	<div class="hint" transition:fly={{ y: 16, duration: 280 }}>
		<div class="art" aria-hidden="true">
			<img src="/icon-192.png" alt="" />
		</div>
		<div class="words">
			<p class="title">把木魚放到桌面</p>
			{#if isIOS}
				<p class="how">
					按下面的
					<span class="ios-share" aria-hidden="true">
						<svg viewBox="0 0 24 24">
							<path
								d="M12 3v12M12 3l-3.5 3.5M12 3l3.5 3.5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
							<path
								d="M5 12v7.5h14V12"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
							/>
						</svg>
					</span>
					<span class="sr">分享</span>
					，選「加入主畫面」
				</p>
			{:else}
				<p class="how">裝起來就能全螢幕、離線也敲得動。</p>
			{/if}
		</div>
		{#if !isIOS && deferred}
			<button class="go" onclick={install}>安裝</button>
		{/if}
		<button class="x" onclick={close} aria-label="不用了">✕</button>
	</div>
{/if}

<style>
	.hint {
		position: fixed;
		/* 壓在底部 tab bar 上方，不要擋住它 */
		bottom: calc(4.6rem + env(safe-area-inset-bottom));
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: calc(100% - 2rem);
		max-width: 380px;
		padding: 0.7rem 0.8rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-lift);
	}

	.art img {
		display: block;
		width: 38px;
		height: 38px;
		border-radius: var(--r-xs);
	}

	.words {
		flex: 1;
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: 0.84rem;
		font-weight: 600;
		color: var(--ink);
	}

	.how {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		flex-wrap: wrap;
		margin: 0.1rem 0 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}

	.ios-share {
		display: inline-flex;
		color: #0a84ff; /* iOS 的系統藍，讓它一眼對應到那顆按鈕 */
	}

	.ios-share svg {
		width: 14px;
		height: 14px;
	}

	/* 圖示已經說明了，但螢幕閱讀器需要文字 */
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.go {
		flex-shrink: 0;
		padding: 0.4rem 0.8rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: #fffdf9;
		background: var(--saffron);
		border-radius: var(--r-sm);
	}

	.x {
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		font-size: 0.72rem;
		color: var(--ink-faint);
		border-radius: var(--r-full);
		transition: color var(--fast);
	}

	.x:hover {
		color: var(--ink);
	}

	@media (prefers-reduced-motion: reduce) {
		.hint {
			transition: none;
		}
	}
</style>

<script lang="ts">
	/**
	 * 導航。桌面是左側 rail（品牌 + 分頁 + 身分），手機是底部 tab bar。
	 * 只有一份 markup，靠 media query 換形態——避免兩套 DOM 走音。
	 */
	type Mode = 'solo' | 'me' | 'group' | 'community';

	let {
		currentMode,
		nickname = '',
		signedIn = false,
		onChange,
		onAccount
	}: {
		currentMode: Mode;
		nickname?: string;
		signedIn?: boolean;
		onChange: (m: Mode) => void;
		onAccount: () => void;
	} = $props();

	// 線性圖示：24×24、stroke 1.7、圓端。導航用線條，內容才用 emoji。
	const ICONS: Record<Mode, string> = {
		solo: 'M12 13.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5ZM4.5 20a7.5 7.5 0 0 1 15 0',
		// 攤開的書
		me: 'M12 6.6C10.4 5.2 8.3 4.5 5.5 4.5H4v13h1.5c2.8 0 4.9.7 6.5 2.1M12 6.6c1.6-1.4 3.7-2.1 6.5-2.1H20v13h-1.5c-2.8 0-4.9.7-6.5 2.1M12 6.6v13',
		group:
			'M9 12.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM2.5 20a6.5 6.5 0 0 1 13 0M16 5.6a3.75 3.75 0 0 1 0 6.8M18 14.4a6.5 6.5 0 0 1 3.5 5.6',
		community: 'M5 20v-6M12 20V4M19 20v-9'
	};

	const tabs: { id: Mode; label: string; desc: string }[] = [
		{ id: 'solo', label: '自己敲', desc: '個人功德' },
		{ id: 'group', label: '一起敲', desc: '群組懺悔' },
		{ id: 'community', label: '排行', desc: '敲擊排名' },
		// 放最後：手機底部 tab bar 的最右邊，慣例上就是「我的」
		{ id: 'me', label: '功德簿', desc: '你的紀錄與成就' }
	];
</script>

<aside class="rail">
	<div class="brand">
		<span class="logo" aria-hidden="true">🪷</span>
		<span class="name">淨心木魚</span>
	</div>

	<nav aria-label="主導航">
		{#each tabs as tab (tab.id)}
			<button
				class="item"
				class:active={currentMode === tab.id}
				onclick={() => onChange(tab.id)}
				aria-current={currentMode === tab.id ? 'page' : undefined}
				title={tab.desc}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d={ICONS[tab.id]} />
				</svg>
				<span class="label">{tab.label}</span>
			</button>
		{/each}
	</nav>

	{#if nickname}
		<button class="who" onclick={onAccount} title={signedIn ? '施主資料' : '登入或註冊'}>
			<span class="dot" class:on={signedIn} aria-hidden="true"></span>
			<span class="nick">{nickname}</span>
			<span class="cta">{signedIn ? '施主' : '登入'}</span>
		</button>
	{/if}
</aside>

<style>
	.rail {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		z-index: 50;
		width: 232px;
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
		padding: 1.5rem 0.9rem 1.2rem;
		background: var(--surface);
		border-right: 1px solid var(--line-soft);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0 0.55rem;
	}

	.logo {
		font-size: 1.35rem;
		line-height: 1;
	}

	.name {
		font-family: var(--serif);
		font-size: 1.02rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--ink);
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.65rem;
		font-size: 0.92rem;
		color: var(--ink-soft);
		border-radius: var(--r-sm);
		text-align: left;
		transition:
			background var(--fast),
			color var(--fast);
	}

	.item:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.item.active {
		background: var(--saffron-soft);
		color: var(--sandal-deep);
		font-weight: 600;
	}

	svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.item.active svg {
		stroke-width: 2;
	}

	.who {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		margin: auto 0 0;
		padding: 0.5rem 0.65rem;
		font-size: 0.76rem;
		color: var(--ink-faint);
		text-align: left;
		border-radius: var(--r-sm);
		transition: background var(--fast);
	}

	.who:hover {
		background: var(--surface-2);
	}

	.nick {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 登入前是灰的，登入後才亮起來——一眼看得出自己是不是留得住紀錄 */
	.cta {
		margin-left: auto;
		flex-shrink: 0;
		color: var(--sandal);
		font-weight: 600;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--line);
		flex-shrink: 0;
	}

	.dot.on {
		background: var(--celadon);
	}

	/* ── 手機：底部 tab bar ── */
	@media (max-width: 760px) {
		.rail {
			top: auto;
			right: 0;
			width: auto;
			flex-direction: row;
			gap: 0;
			padding: 0.3rem 0.5rem calc(0.3rem + env(safe-area-inset-bottom));
			border-right: none;
			border-top: 1px solid var(--line);
			background: rgba(255, 253, 249, 0.86);
			backdrop-filter: saturate(1.6) blur(14px);
			-webkit-backdrop-filter: saturate(1.6) blur(14px);
		}

		.brand,
		.who {
			display: none;
		}

		nav {
			flex-direction: row;
			width: 100%;
		}

		.item {
			flex: 1;
			flex-direction: column;
			gap: 0.15rem;
			padding: 0.45rem 0.2rem 0.35rem;
			font-size: 0.68rem;
			text-align: center;
			background: none;
		}

		.item.active {
			background: none;
			color: var(--saffron);
		}

		.item:hover {
			background: none;
		}

		svg {
			width: 23px;
			height: 23px;
		}
	}
</style>

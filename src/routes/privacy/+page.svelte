<script lang="ts">
	/**
	 * 隱私政策。App Store Connect 要求一個公開可讀的網址，Google Play 與
	 * GDPR 也是。
	 *
	 * 內容要跟程式實際做的事一致——寫了不做比不寫更糟。每一條都對得上
	 * 現在的程式碼：照片見 ritualPhoto.ts（只進 IndexedDB），刪帳號見
	 * supabase.sql 的 delete_account()。
	 */
	const UPDATED = '2026 年 9 月 20 日';
</script>

<svelte:head>
	<title>隱私政策 — 淨心木魚</title>
	<meta name="description" content="淨心木魚的隱私政策：我們收集什麼、不收集什麼。" />
</svelte:head>

<main>
	<article>
		<h1>隱私政策</h1>
		<p class="updated">最後更新：{UPDATED}</p>

		<p class="lede">
			淨心木魚是一個敲木魚的小工具。我們盡量少存東西，下面寫的就是全部。
		</p>

		<h2>照片完全不會上傳</h2>
		<p>
			超渡功能可以放一張照片。那張照片<strong>只存在你自己的裝置裡</strong>（瀏覽器的
			IndexedDB），不會傳到我們或任何第三方的伺服器。我們的伺服器連「你有沒有放照片」
			都不知道。
		</p>
		<p>
			儀式結束後照片會自動刪除。你也可以隨時按 ✕ 自己移除。
		</p>
		<p>
			照片在存進裝置前會先縮小並重新編碼，這個過程會把 EXIF 一併去掉，
			<strong>包含拍攝地點的 GPS 座標</strong>。
		</p>

		<h2>我們會存的東西</h2>
		<ul>
			<li>
				<strong>敲擊紀錄</strong>：每一筆包含時間、敲了幾下、以及你選的懺悔項目。
				不含任何足以指認你本人的資料。
			</li>
			<li>
				<strong>暱稱</strong>：預設是隨機產生的，你可以自己改。排行榜會顯示它。
			</li>
			<li>
				<strong>電子信箱</strong>：只有你註冊帳號時才會有，用來登入與復原帳號，
				由 Supabase Auth 保管。我們不會拿它寄行銷信。
			</li>
			<li>
				<strong>本機設定</strong>：木魚樣式、音量、速度等偏好存在你的瀏覽器
				localStorage，不會離開你的裝置。
			</li>
		</ul>

		<h2>我們不會做的事</h2>
		<ul>
			<li>不放廣告，也沒有任何第三方廣告或分析追蹤程式。</li>
			<li>不販售、不分享、不出租任何資料給第三方。</li>
			<li>不蒐集聯絡人、位置、裝置識別碼或瀏覽紀錄。</li>
			<li>不要求註冊也能用——不登入就只是一個匿名的隨機身分。</li>
		</ul>

		<h2>公開的部分</h2>
		<p>
			「大家的懺悔」會顯示其他人剛剛敲了什麼，內容只有你選的懺悔項目與自訂文字。
			<strong>自訂的懺悔文字是公開的，請不要寫入個人資料。</strong>
			自動敲與超渡的紀錄不會出現在這面牆上。
		</p>

		<h2>刪除你的資料</h2>
		<p>
			登入後到「功德簿」最下面可以<strong>刪除帳號</strong>。刪除後你的暱稱、
			電子信箱與登入帳號會立即永久消失，無法復原。
		</p>
		<p>
			敲擊紀錄本身會保留，但會與你完全脫鉤（不再連結到任何身分）——因為
			「大家一共敲了幾下」是所有人共有的數字，不該因為有人離開就倒退。
			那些紀錄在刪除後已經無法追溯到你。
		</p>
		<p>
			沒有註冊的匿名身分，只要清除瀏覽器資料就會消失。
		</p>

		<h2>資料放在哪裡</h2>
		<p>
			資料庫與帳號系統由 <a href="https://supabase.com/privacy" rel="noreferrer noopener" target="_blank">Supabase</a>
			提供，網站由 <a href="https://vercel.com/legal/privacy-policy" rel="noreferrer noopener" target="_blank">Vercel</a>
			託管。兩者都可能記錄標準的伺服器存取紀錄（如 IP 位址）以維運與防濫用。
		</p>

		<h2>兒童</h2>
		<p>本服務不針對 13 歲以下的兒童設計，也不會刻意蒐集他們的資料。</p>

		<h2>有問題的話</h2>
		<p>
			寫信到 <a href="mailto:stevenchen0110@gmail.com">stevenchen0110@gmail.com</a>。
		</p>

		<p class="back"><a href="/">← 回去敲木魚</a></p>
	</article>
</main>

<style>
	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 2.5rem 1.4rem 4rem;
	}

	article {
		color: var(--ink);
		line-height: 1.85;
		font-size: 0.92rem;
	}

	h1 {
		margin: 0 0 0.3rem;
		font-family: var(--serif);
		font-size: 1.5rem;
		letter-spacing: 0.04em;
	}

	.updated {
		margin: 0 0 1.6rem;
		font-size: 0.76rem;
		color: var(--ink-faint);
	}

	.lede {
		padding-bottom: 0.4rem;
		color: var(--ink-soft);
	}

	h2 {
		margin: 2rem 0 0.5rem;
		font-family: var(--serif);
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--sandal-deep);
	}

	p {
		margin: 0 0 0.8rem;
	}

	ul {
		margin: 0 0 0.8rem;
		padding-left: 1.2rem;
	}

	li {
		margin-bottom: 0.5rem;
	}

	strong {
		font-weight: 600;
	}

	a {
		color: var(--saffron);
		text-underline-offset: 3px;
	}

	.back {
		margin-top: 2.6rem;
		padding-top: 1.2rem;
		border-top: 1px solid var(--line-soft);
		font-size: 0.86rem;
	}

	.back a {
		color: var(--ink-soft);
		text-decoration: none;
	}

	.back a:hover {
		color: var(--ink);
	}
</style>

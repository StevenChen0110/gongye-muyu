<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade, slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import {
		PRESET_SINS,
		CUSTOM_MAX_LEN,
		addCustomSin,
		customLimitReached,
		isCustom,
		loadCustomSins,
		removeCustomSin,
		sinEmoji,
		sinLabel,
		CUSTOM_PREFIX,
		type Sin
	} from '$lib/sins';
	import { fishFromId, DEFAULT_FISH_ID } from '$lib/fish';
	import { setFishVolume, setAmbientVolume, cutFish } from '$lib/woodenFish';
	import { createMetronome, clampBpm, beatsForMinutes, type Metronome } from '$lib/metronome';
	import { setAmbient, type AmbientId } from '$lib/ambient';
	import { createKnockBuffer, type KnockBuffer } from '$lib/knockBuffer';
	import { savePhoto, loadPhoto, clearPhoto, MAX_INPUT_BYTES } from '$lib/ritualPhoto';
	import * as haptics from '$lib/haptics';
	import {
		getIdentity,
		setIdentity,
		resetIdentity,
		randomNickname,
		NICKNAME_MAX_LEN
	} from '$lib/identity';
	import { auth, initAuth } from '$lib/auth.svelte';
	import { EMPTY_STATS, evaluate, type Stats } from '$lib/achievements';
	import Knocker from '$lib/Knocker.svelte';
	import FishPicker from '$lib/FishPicker.svelte';
	import AutoControls from '$lib/AutoControls.svelte';
	import RitualPanel from '$lib/RitualPanel.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import AuthPanel from '$lib/AuthPanel.svelte';
	import {
		claimIdentity,
		ensureUser,
		fetchRecentKnocks,
		fetchTotalCount,
		fetchRanking,
		fetchMyCount,
		fetchMyStats,
		createGroup,
		fetchGroupByCode,
		insertKnock,
		updateNickname,
		subscribeToKnocks,
		isConfigured,
		type Knock,
		type Group,
		type RankRow
	} from '$lib/supabase';

	const FEED_MAX = 30;
	const MILESTONE = 108; // 百八煩惱

	type Mode = 'solo' | 'me' | 'group' | 'community';
	/** 木魚由誰驅動。共用同一顆木魚、同一組音量與功德計數。 */
	type Driver = 'manual' | 'auto' | 'ritual';

	const PHRASES = [
		(s: string) => `有人剛剛懺悔了「${s}」`,
		(s: string) => `某位施主承認了「${s}」`,
		(s: string) => `有人默默放下了「${s}」`,
		(s: string) => `一位路過的凡人坦承「${s}」`
	];

	let mode = $state<Mode>('solo');
	let me = $state({ id: '', nickname: '' });
	let authOpen = $state(false);
	const signedIn = $derived(Boolean(auth.session));

	// 木魚
	let fishId = $state(DEFAULT_FISH_ID);
	const fish = $derived(fishFromId(fishId));

	// 設定
	let muted = $state(false);
	let hapticsOn = $state(true);
	let hapticsSupported = $state(false);

	// 個人
	let merit = $state(0);
	let selectedSin = $state<string | null>(null);
	let pickerOpen = $state(false);
	let hintPicker = $state(false);
	let blessing = $state(false);

	// 自動敲。手動/自動是同一個畫面的兩種驅動方式，不是兩個分頁。
	let driver = $state<Driver>('manual');
	let bpm = $state(60);
	let autoMinutes = $state(5);
	let autoRunning = $state(false);
	let autoKnocked = $state(0);
	let autoRemaining = $state(0);
	const DRIVERS: { id: Driver; label: string; desc: string }[] = [
		{ id: 'manual', label: '自己敲', desc: '一下一下自己來' },
		{ id: 'auto', label: '自動敲', desc: '設好節奏，木魚自己敲' },
		{ id: 'ritual', label: '超渡', desc: '寫下一件事，敲掉它' }
	];
	const driverIdx = $derived(DRIVERS.findIndex((d) => d.id === driver));

	// 超渡
	let ritualText = $state('');
	let ritualMinutes = $state(3);
	let ritualDone = $state(false);
	/** 本機照片的 object URL。null = 沒放。影像本身不離開這台裝置。 */
	let ritualPhoto = $state<string | null>(null);
	let photoError = $state<string | null>(null);
	/** 有沒有要在木魚後面立起那個龕。只有超渡模式、而且真的放了照片才有。 */
	const showShrine = $derived(mode === 'solo' && driver === 'ritual' && !!ritualPhoto);

	let slowDown = $state(false);
	let ambient = $state<AmbientId>('none');
	let ambientVol = $state(0.6);
	let metro: Metronome | null = null;
	let autoTimer: ReturnType<typeof setInterval> | null = null;
	let autoEndsAt = 0;
	/** 自動敲的批次寫入。超渡不走這條——它只在完成時寫一筆。 */
	let buffer: KnockBuffer | null = null;

	// 自訂懺悔內容
	let customSins = $state<Sin[]>([]);
	let composing = $state(false);
	let draft = $state('');
	const allSins = $derived([...PRESET_SINS, ...customSins]);

	// 木魚與效果那一區可以收起來，收起來時用一行字交代現況
	let controlsOpen = $state(false);
	const summary = $derived(
		[
			// fish.label 已經含木材（例如「中型樟木」），不用再接一次
			fish.label,
			muted ? '靜音' : '有聲',
			!hapticsSupported ? '無震動' : hapticsOn ? '震動開' : '震動關'
		].join(' · ')
	);

	// 公開 / 群組 feed
	let total = $state(0);
	let feed = $state<Knock[]>([]);
	let loading = $state(true);

	// 群組
	let group = $state<Group | null>(null);
	let groupTitle = $state('');
	let joinCode = $state('');
	let groupBusy = $state(false);
	let groupError = $state('');
	let groupKnocks = $state(0);

	// 排行
	let ranking = $state<RankRow[]>([]);
	let rankLoading = $state(false);

	// 功德簿
	let stats = $state<Stats>(EMPTY_STATS);
	let statsLoading = $state(false);
	let draftName = $state('');
	let nameBusy = $state(false);
	let nameError = $state('');
	let nameSaved = $state(false);
	const nameDirty = $derived(draftName.trim() !== '' && draftName.trim() !== me.nickname);
	const earned = $derived(evaluate(stats));
	const doneCount = $derived(earned.filter((a) => a.done).length);

	let now = $state(Date.now());
	let pendingKnock = false;
	let counted = new Set<number>();
	let unsubscribe: (() => void) | null = null;
	let knocker = $state<Knocker | null>(null);

	const selectedLabel = $derived(selectedSin ? sinLabel(selectedSin) : null);

	onMount(() => {
		me = getIdentity();
		fishId = localStorage.getItem('muyu:fish') ?? DEFAULT_FISH_ID;
		selectedSin = localStorage.getItem('muyu:sin');
		merit = Number(localStorage.getItem('muyu:merit') ?? 0) || 0;
		muted = localStorage.getItem('muyu:muted') === '1';
		customSins = loadCustomSins();
		controlsOpen = localStorage.getItem('muyu:controls-open') === '1';
		bpm = clampBpm(Number(localStorage.getItem('muyu:bpm') ?? 60));
		autoMinutes = Number(localStorage.getItem('muyu:auto-minutes') ?? 5) || 5;
		driver = localStorage.getItem('muyu:driver') === 'auto' ? 'auto' : 'manual';
		slowDown = localStorage.getItem('muyu:slow-down') === '1';
		ritualMinutes = Number(localStorage.getItem('muyu:ritual-minutes') ?? 3) || 3;
		// 選好照片才重整不該白選一次。儀式跑完會自動清掉，所以這裡撿回來的
		// 只會是「還沒開始的那一張」
		void loadPhoto().then((url) => {
			if (url) ritualPhoto = url;
		});
		ambient = (localStorage.getItem('muyu:ambient') as AmbientId | null) ?? 'none';
		ambientVol = Number(localStorage.getItem('muyu:ambient-vol') ?? 0.6);
		hapticsOn = haptics.isEnabled();
		hapticsSupported = haptics.isSupported();
		setFishVolume(muted ? 0 : 1);

		void ensureUser();

		const params = new URLSearchParams(location.search);

		// 深連結：?tab=community 可以直接分享排行
		const tab = params.get('tab');
		if (tab === 'me' || tab === 'group' || tab === 'community') void switchMode(tab);

		// 有人把群組連結分享給你：?g=CODE
		const code = params.get('g');
		if (code) {
			mode = 'group';
			void joinGroup(code);
		}

		void loadPublic();

		const stopAuth = initAuth({ onSignedIn, onSignedOut });

		const clock = setInterval(() => (now = Date.now()), 20_000);
		return () => {
			unsubscribe?.();
			stopAuth();
			clearInterval(clock);
			stopAuto(); // 離開頁面時別讓節拍器繼續跑
			setAmbient('none');
		};
	});

	/** 登入後身分換成帳號那一組，功德數以 DB 為準（匿名累積的已經併進去了）。 */
	async function onSignedIn() {
		const row = await claimIdentity();
		if (!row) return;
		setIdentity(row.id, row.nickname);
		me = { id: row.id, nickname: row.nickname };
		merit = row.knock_count;
		localStorage.setItem('muyu:merit', String(merit));
		if (mode === 'community') ranking = await fetchRanking(20);
	}

	/** 登出後變回一個全新的路人，之後敲的不會再記到剛才那個帳號上。 */
	async function onSignedOut() {
		me = resetIdentity();
		merit = 0;
		await ensureUser();
	}

	async function loadPublic() {
		loading = true;
		const [recent, count, mine] = await Promise.all([
			fetchRecentKnocks(FEED_MAX),
			fetchTotalCount(),
			fetchMyCount()
		]);
		resetFeed(recent);
		total = count;
		// DB 的數字才是真相（含伺服器端被清空的情況）；沒接 DB 時才退回 localStorage
		if (mine !== null) {
			merit = mine;
			localStorage.setItem('muyu:merit', String(merit));
		}
		loading = false;
		listen(null);
	}

	function listen(groupId: string | null) {
		unsubscribe?.();
		unsubscribe = subscribeToKnocks((k) => pushToFeed(k, groupId), groupId);
	}

	/**
	 * 進 feed 並計數。回傳這筆是不是新的。
	 *
	 * 自己敲的那筆會走兩條路進來：insert 的回傳值，以及 realtime 把它推回來。
	 * 計數必須跟去重綁在一起，不然同一下會被算兩次。feed 只留 30 筆，所以
	 * 另外用 counted 記 id，不能靠 feed 本身判斷。
	 */
	function pushToFeed(k: Knock, groupId: string | null = null): boolean {
		if (counted.has(k.id)) return false;
		counted.add(k.id);
		feed = [k, ...feed].slice(0, FEED_MAX);
		// 一筆可能代表好幾十下
		if (groupId) groupKnocks += k.count;
		else total += k.count;
		return true;
	}

	/** 換 feed（公開 ↔ 群組）時重新鋪底，計數改以伺服器的數字為準。 */
	function resetFeed(rows: Knock[]) {
		counted = new Set(rows.map((r) => r.id));
		feed = rows;
	}

	function pickFish(sizeId: string, woodId: string) {
		fishId = `${sizeId}-${woodId}`;
		localStorage.setItem('muyu:fish', fishId);
		knocker?.strike(); // 換了就先聽一下
	}

	// ── 個人模式 ──────────────────────────────────────
	function onSoloKnock() {
		merit += 1;
		localStorage.setItem('muyu:merit', String(merit));
		if (merit === MILESTONE) {
			blessing = true;
			setTimeout(() => (blessing = false), 5200);
		}

		if (!selectedSin) {
			pendingKnock = true;
			pickerOpen = true;
			hintPicker = true;
			setTimeout(() => (hintPicker = false), 1400);
			return;
		}
		void confess(selectedSin);
	}

	async function confess(sin: string) {
		const row = await insertKnock({ sin, fish: fishId });
		if (row) pushToFeed(row);
	}

	// ── 長按連敲 ──────────────────────────────────────
	/**
	 * 按住不放時的每一下。
	 *
	 * 不走 confess()：連敲一秒有 9 下，一下一筆會把「大家的懺悔」整面牆洗掉，
	 * 也白白吃掉寫入額度。改跟自動敲一樣批次寫，一筆代表好幾十下。
	 */
	function onHoldKnock() {
		merit += 1;
		total += 1;
		localStorage.setItem('muyu:merit', String(merit));
		if (merit === MILESTONE) {
			blessing = true;
			setTimeout(() => (blessing = false), 5200);
		}
		buffer?.add(1);
	}

	/** 連敲開始／結束時開關批次寫入。 */
	function onHoldChange(holding: boolean) {
		if (holding) {
			// 手動模式不會有自動敲在跑（切換驅動時會先 stopAuto），所以這個
			// slot 一定是空的
			buffer ??= createKnockBuffer({
				// 連敲帶著當下選的懺悔內容，這樣功德簿的「最常懺悔」才對得上
				write: (count) =>
					insertKnock({ sin: selectedSin, fish: fishId, count, source: 'auto' }),
				// 不推進 feed：連敲不該洗掉真人打字的懺悔。功德與總數在
				// onHoldKnock 就即時加過了
				onWritten: () => {}
			});
			return;
		}
		if (buffer) {
			void buffer.flush();
			buffer.dispose();
			buffer = null;
		}
	}

	// ── 自動敲 ────────────────────────────────────────
	function setBpm(v: number) {
		bpm = clampBpm(v);
		localStorage.setItem('muyu:bpm', String(bpm));
		metro?.setBpm(bpm); // 跑到一半改速度不會打斷節奏
	}

	function setAutoMinutes(v: number) {
		autoMinutes = v;
		localStorage.setItem('muyu:auto-minutes', String(v));
		if (autoRunning) stopAuto(); // 改時間就重來，不然倒數會對不上
	}

	function setSlowDown(v: boolean) {
		slowDown = v;
		localStorage.setItem('muyu:slow-down', v ? '1' : '0');
		if (autoRunning) stopAuto(); // 斜率會變，重來比較單純
	}

	/**
	 * 選背景音。
	 *
	 * `ambient` 是「使用者選了什麼」，跟「現在有沒有在播」是兩回事——
	 * 沒在自動敲的時候先試聽，按開始才正式跟著跑。
	 */
	function pickAmbient(id: AmbientId) {
		ambient = id;
		localStorage.setItem('muyu:ambient', id);
		setAmbientVolume(ambientVol);
		setAmbient(id); // 選了就先試聽，不用等按開始
	}

	function setAmbientVol(v: number) {
		ambientVol = v;
		localStorage.setItem('muyu:ambient-vol', String(v));
		setAmbientVolume(v);
	}

	/** 漸慢的終點速度：原速的一半，但不低於下限。 */
	const slowTarget = $derived(Math.max(30, Math.round(bpm / 2)));

	function toggleAuto() {
		if (autoRunning) stopAuto();
		else startAuto();
	}

	/**
	 * 啟動節拍器。自動敲與超渡共用——差別只在時長與結束時做什麼。
	 */
	function runMetronome(minutes: number, onDone: () => void) {
		// 上一輪停止時把 bus 拉到 0 壓掉殘餘的排程音，這裡要放回來
		setFishVolume(muted ? 0 : 1);
		if (ambient !== 'none') {
			setAmbientVolume(ambientVol);
			setAmbient(ambient);
		}

		autoKnocked = 0;
		autoRemaining = minutes * 60;
		autoEndsAt = Date.now() + minutes * 60_000;

		metro = createMetronome({
			bpm,
			limit: beatsForMinutes(minutes, bpm, slowDown ? slowTarget : undefined),
			slowTo: slowDown ? slowTarget : undefined,
			// 計數掛在排程這條路：聲音一定會響，但 onAudible 是 rAF 驅動的，
			// 分頁切到背景會被節流，掛在那裡會變成「有敲到卻沒算到」
			onSchedule: (t) => {
				knocker?.playAt(t.at);
				autoKnocked += 1;
				merit += 1;
				total += 1; // 自動敲也算進「大家一共」
				localStorage.setItem('muyu:merit', String(merit));
				// 只有自動敲會掛 buffer；超渡不走這條，它在完成時寫一筆。
				// realtime 會濾掉非 manual 的回音，所以這裡不會重複計數。
				buffer?.add(1);
			},
			onAudible: () => knocker?.animate(),
			onComplete: onDone
		});
		metro.start();
		autoRunning = true;

		// 倒數只是顯示用，用牆鐘時間算就夠了
		autoTimer = setInterval(() => {
			autoRemaining = Math.max(0, Math.round((autoEndsAt - Date.now()) / 1000));
		}, 250);
	}

	function startAuto() {
		if (autoRunning) return;
		// 自動敲要批次寫 DB；超渡不掛，它只在完成時寫一筆
		buffer = createKnockBuffer({
			write: (count) => insertKnock({ fish: fishId, count, source: 'auto' }),
			// 不推進 feed：自動敲的紀錄不該出現在「大家的懺悔」那面牆上。
			// 功德與總數在 onSchedule 就即時加過了，這裡只負責寫 DB。
			onWritten: () => {}
		});
		runMetronome(autoMinutes, stopAuto);
	}

	// ── 超渡 ──────────────────────────────────────────
	function setRitualText(v: string) {
		ritualText = v;
	}

	/**
	 * 放一張照片。只存在這台裝置，永遠不上傳。
	 *
	 * 伺服器連影像都拿不到，DB 只會多一個「這次有附圖」的布林值。理由見
	 * ritualPhoto.ts——讓使用者放別人的臉的功能，照片一旦上雲就是另一種產品。
	 */
	async function setRitualPhoto(file: File) {
		try {
			if (ritualPhoto) URL.revokeObjectURL(ritualPhoto);
			ritualPhoto = await savePhoto(file);
		} catch (e) {
			console.warn('[ritual] 照片存不進去：', e);
			photoError = file.size > MAX_INPUT_BYTES ? '這張照片太大了' : '這張照片讀不進來';
			setTimeout(() => (photoError = null), 2600);
		}
	}

	function clearRitualPhoto() {
		if (ritualPhoto) URL.revokeObjectURL(ritualPhoto);
		ritualPhoto = null;
		void clearPhoto();
	}

	function setRitualMinutes(v: number) {
		ritualMinutes = v;
		localStorage.setItem('muyu:ritual-minutes', String(v));
		if (autoRunning) stopAuto();
	}

	function toggleRitual() {
		if (autoRunning) {
			stopAuto();
			return;
		}
		if (!ritualText.trim()) return;
		ritualDone = false;
		runMetronome(ritualMinutes, finishRitual);
	}

	/** 敲完了。寫一筆 source='ritual'，然後播儀式。 */
	function finishRitual() {
		const knocks = autoKnocked;
		const target = ritualText.trim();
		stopAuto();
		autoKnocked = knocks; // stopAuto 會扣掉沒響到的，這裡保留給儀式顯示
		ritualDone = true;

		// 超渡是原子的：半途而廢不該留紀錄，所以只在完成時寫一筆。
		// 注意只寫文字，照片不在這裡——影像永遠不離開這台裝置。
		if (target) {
			void insertKnock({
				sin: CUSTOM_PREFIX + target,
				fish: fishId,
				count: knocks,
				source: 'ritual'
			});
		}
	}

	function dismissRitual() {
		ritualDone = false;
		ritualText = '';
		// 儀式結束就把照片清掉：這是一次性的告別，不是在累積一份名單
		clearRitualPhoto();
	}

	function stopAuto() {
		// 先停再讀 unheard——stop() 會把 pending 的數量留在那裡
		metro?.stop();
		const metroUnheard = metro?.unheard ?? 0;
		metro = null;
		if (autoTimer !== null) clearInterval(autoTimer);
		autoTimer = null;
		autoRunning = false;
		autoRemaining = 0;

		// 已經排程出去的音攔不掉，只能把整條 bus 壓掉。那些被壓掉的拍在排程時
		// 已經計過功德，要扣回來——不然會有「聽不到卻算到」的功德。
		// 這段必須在 flush 之前，不然那些拍會被寫進 DB。
		if (metroUnheard > 0) {
			autoKnocked = Math.max(0, autoKnocked - metroUnheard);
			merit = Math.max(0, merit - metroUnheard);
			total = Math.max(0, total - metroUnheard);
			localStorage.setItem('muyu:merit', String(merit));
			buffer?.add(-metroUnheard);
		}

		// 扣完帳才把剩下的寫出去
		if (buffer) {
			void buffer.flush();
			buffer.dispose();
			buffer = null;
		}

		cutFish();
		setTimeout(() => setFishVolume(muted ? 0 : 1), 250);

		// 背景音跟著這一輪結束，不要讓它在停止後繼續播
		setAmbient('none');
	}

	function switchDriver(d: Driver) {
		if (d === driver) return;
		if (autoRunning) stopAuto();
		// 只有自動敲與超渡有背景音，手動模式不該有雨聲
		if (d === 'manual') setAmbient('none');
		else if (ambient !== 'none') {
			setAmbientVolume(ambientVol);
			setAmbient(ambient);
		}
		driver = d;
		localStorage.setItem('muyu:driver', d);
	}

	function selectSin(id: string) {
		selectedSin = id;
		localStorage.setItem('muyu:sin', id);
		pickerOpen = false;
		composing = false;
		if (pendingKnock) {
			pendingKnock = false;
			void confess(id); // 剛剛那一敲也算數
		}
	}

	/** 加一則自訂懺悔，順手選起來。 */
	function commitDraft() {
		const { list, added } = addCustomSin(customSins, draft);
		customSins = list;
		draft = '';
		composing = false;
		if (added) selectSin(added.id);
	}

	function dropCustom(id: string) {
		customSins = removeCustomSin(customSins, id);
		if (selectedSin === id) {
			selectedSin = null;
			localStorage.removeItem('muyu:sin');
		}
	}

	/** 改暱稱。DB 先寫，寫成功才換本機的——不然排行榜跟自己看到的會不一樣。 */
	async function rename(name: string): Promise<string | null> {
		const err = await updateNickname(name);
		if (err) return err;
		me = { ...me, nickname: name };
		setIdentity(me.id, name);
		if (mode === 'community') ranking = await fetchRanking(20);
		return null;
	}

	function toggleControls() {
		controlsOpen = !controlsOpen;
		localStorage.setItem('muyu:controls-open', controlsOpen ? '1' : '0');
	}

	// ── 群組模式 ──────────────────────────────────────
	async function makeGroup() {
		const title = groupTitle.trim();
		if (!title) {
			groupError = '先寫下大家要一起敲的是什麼事。';
			return;
		}
		groupBusy = true;
		groupError = '';
		const g = await createGroup(title);
		groupBusy = false;
		if (!g) {
			groupError = '開群失敗，請再試一次。';
			return;
		}
		enterGroup(g);
	}

	async function joinGroup(code: string) {
		const c = code.trim().toUpperCase();
		if (c.length < 4) {
			groupError = '邀請碼看起來不完整。';
			return;
		}
		groupBusy = true;
		groupError = '';
		const g = await fetchGroupByCode(c);
		groupBusy = false;
		if (!g) {
			groupError = `找不到邀請碼 ${c}。`;
			return;
		}
		enterGroup(g);
	}

	async function enterGroup(g: Group) {
		group = g;
		groupKnocks = g.knock_count;
		joinCode = '';
		groupError = '';
		resetFeed(await fetchRecentKnocks(FEED_MAX, g.id));
		listen(g.id);
		history.replaceState(null, '', `?g=${g.code}`);
	}

	function leaveGroup() {
		group = null;
		history.replaceState(null, '', location.pathname);
		void loadPublic();
	}

	function onGroupKnock() {
		if (!group) return;
		void (async () => {
			const row = await insertKnock({ groupId: group!.id, fish: fishId });
			if (row) pushToFeed(row, group!.id);
		})();
	}

	async function copyInvite() {
		if (!group) return;
		const url = `${location.origin}${location.pathname}?g=${group.code}`;
		try {
			await navigator.clipboard.writeText(url);
			groupError = '邀請連結已複製。';
			setTimeout(() => (groupError = ''), 2200);
		} catch {
			groupError = url;
		}
	}

	// ── 排行 / 功德簿 ─────────────────────────────────
	async function switchMode(m: Mode) {
		mode = m;
		if (m === 'community') {
			rankLoading = true;
			ranking = await fetchRanking(20);
			rankLoading = false;
		}
		if (m === 'me') await loadStats();
	}

	async function loadStats() {
		statsLoading = true;
		// 第一次進站時 users 那列可能還沒建好，加入時間會是 null——先確保它在
		await ensureUser();
		const s = await fetchMyStats();
		// 沒接 DB 時至少讓「總功德」有東西看
		stats = s ?? { ...EMPTY_STATS, total: merit };
		draftName = me.nickname;
		nameError = '';
		nameSaved = false;
		statsLoading = false;
	}

	function rollName() {
		// 骰到一樣的就再骰一次，不然按下去像壞了
		let next = randomNickname();
		for (let i = 0; i < 5 && next === draftName; i++) next = randomNickname();
		draftName = next;
		nameSaved = false;
		nameError = '';
	}

	async function saveName() {
		const name = draftName.trim();
		if (!name || name === me.nickname) return;
		nameBusy = true;
		nameError = '';
		const err = await rename(name);
		nameBusy = false;
		if (err) {
			nameError = err;
			return;
		}
		nameSaved = true;
		setTimeout(() => (nameSaved = false), 1800);
	}

	/** 「2026 年 8 月 9 日 · 第 3 天」 */
	function joinedText(iso: string): string {
		const d = new Date(iso);
		const day = Math.max(1, Math.floor((Date.now() - d.getTime()) / 86_400_000) + 1);
		return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 第 ${day} 天`;
	}

	// ── 設定 ──────────────────────────────────────────
	function toggleMute() {
		muted = !muted;
		localStorage.setItem('muyu:muted', muted ? '1' : '0');
		setFishVolume(muted ? 0 : 1);
	}

	function toggleHaptics() {
		hapticsOn = !hapticsOn;
		haptics.setEnabled(hapticsOn);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.code !== 'Space') return;
		const el = e.target as HTMLElement | null;
		if (el && ['BUTTON', 'A', 'INPUT', 'TEXTAREA'].includes(el.tagName)) return;
		if (mode === 'community') return;
		e.preventDefault();
		knocker?.keyDown();
	}

	function onKeyup(e: KeyboardEvent) {
		if (e.code === 'Space') knocker?.keyUp();
	}

	function phraseFor(k: Knock): string {
		if (k.sin) return PHRASES[k.id % PHRASES.length](sinLabel(k.sin));
		// 一筆可能代表批次的好幾十下
		return k.count > 1 ? `有人一口氣敲了 ${k.count.toLocaleString('en-US')} 下` : '有人敲了一下';
	}

	function timeAgo(iso: string): string {
		const diff = Math.max(0, now - new Date(iso).getTime());
		const m = Math.floor(diff / 60_000);
		if (m < 1) return '剛剛';
		if (m < 60) return `${m} 分鐘前`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} 小時前`;
		return `${Math.floor(h / 24)} 天前`;
	}
</script>

<svelte:window on:keydown={onKeydown} on:keyup={onKeyup} />

<Sidebar
	currentMode={mode}
	nickname={me.nickname}
	{signedIn}
	onChange={switchMode}
	onAccount={() => (authOpen = true)}
/>

<AuthPanel
	open={authOpen}
	nickname={me.nickname}
	{merit}
	onClose={() => (authOpen = false)}
/>

<div class="page">
	<header class="topbar">
		<span class="logo" aria-hidden="true">🪷</span>
		<h1>淨心木魚</h1>
		<!-- 手機版側欄變成底部 tab bar，帳號入口就改掛在這裡 -->
		<button class="account" onclick={() => (authOpen = true)} aria-label="施主">
			<span class="dot" class:on={signedIn} aria-hidden="true"></span>
			{signedIn ? '施主' : '登入'}
		</button>
	</header>

	{#if mode === 'me'}
		<main class="single">
			<section class="card panel">
				<div class="card-head">
					<h2>功德簿</h2>
				</div>

				<!-- 施主資料。暱稱只有登入後能改（DB 那邊也擋著） -->
				<div class="profile">
					<label class="field" for="my-nickname">暱稱</label>
					<div class="name-row">
						<input
							id="my-nickname"
							class="name"
							bind:value={draftName}
							maxlength={NICKNAME_MAX_LEN}
							placeholder="取個名字"
							disabled={!signedIn}
							onkeydown={(e) => e.key === 'Enter' && saveName()}
						/>
						<button
							class="dice"
							onclick={rollName}
							disabled={!signedIn}
							title="隨機取一個"
							aria-label="隨機取名"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<rect x="3.5" y="3.5" width="17" height="17" rx="4" />
								<circle cx="8.6" cy="8.6" r="1.4" />
								<circle cx="15.4" cy="15.4" r="1.4" />
								<circle cx="15.4" cy="8.6" r="1.4" />
								<circle cx="8.6" cy="15.4" r="1.4" />
							</svg>
						</button>
						<button class="save" onclick={saveName} disabled={!signedIn || !nameDirty || nameBusy}>
							{nameSaved ? '已改' : '改名'}
						</button>
					</div>

					{#if nameError}
						<p class="error">{nameError}</p>
					{:else if !signedIn}
						<p class="hint-line">
							現在是隨機給的名字。
							<button class="link" onclick={() => (authOpen = true)}>註冊或登入</button>
							之後就能自己取。
						</p>
					{/if}

					<dl class="info">
						{#if signedIn}
							<dt>信箱</dt>
							<dd>{auth.session?.user.email}</dd>
						{/if}
						<dt>加入時間</dt>
						<dd>{stats.joined ? joinedText(stats.joined) : '—'}</dd>
					</dl>
				</div>

				{#if statsLoading}
					<p class="empty">正在翻簿子…</p>
				{:else}
					<div class="ledger">
						<div class="stat">
							<span class="value">{stats.total.toLocaleString('en-US')}</span>
							<span class="key">總功德</span>
						</div>
						<div class="stat">
							<span class="value">{stats.today.toLocaleString('en-US')}</span>
							<span class="key">今天</span>
						</div>
						<div class="stat">
							<span class="value">{stats.streak}</span>
							<span class="key">連續天數</span>
						</div>
						<div class="stat">
							<span class="value">{stats.days}</span>
							<span class="key">敲過幾天</span>
						</div>
					</div>

					{#if stats.top_sin}
						<p class="most">
							最常懺悔的是
							<b>{sinEmoji(stats.top_sin)} {sinLabel(stats.top_sin)}</b>
						</p>
					{/if}

					<div class="ach-head">
						<h3>成就</h3>
						<span class="ach-count">{doneCount} / {earned.length}</span>
					</div>

					<ul class="achievements">
						{#each earned as a (a.id)}
							<li class:done={a.done}>
								<span class="badge" aria-hidden="true">{a.emoji}</span>
								<span class="ach-body">
									<span class="ach-name">{a.name}</span>
									<span class="ach-desc">{a.desc}</span>
									{#if !a.done}
										<span class="bar" aria-hidden="true">
											<span class="fill" style="width: {a.ratio * 100}%"></span>
										</span>
									{/if}
								</span>
								<span class="ach-num">
									{a.done ? '✓' : `${Math.min(a.value, a.goal)}/${a.goal}`}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</main>
	{:else if mode === 'community'}
		<main class="single">
			<section class="card panel">
				<div class="card-head">
					<h2>排行</h2>
					<p class="lead">敲得最勤的人。</p>
				</div>

				{#if !isConfigured}
					<p class="empty">還沒接上 Supabase，所以還沒有排行。</p>
				{:else if rankLoading}
					<p class="empty">正在排名…</p>
				{:else if ranking.length === 0}
					<p class="empty">還沒有人敲過。你可以當第一個。</p>
				{:else}
					<ol class="rank">
						{#each ranking as r, i (r.id)}
							<li class:me={r.id === me.id}>
								<span class="pos" class:top={i < 3}>{i + 1}</span>
								<span class="who">{r.nickname}{r.id === me.id ? '（你）' : ''}</span>
								<span class="num">{r.knock_count.toLocaleString('en-US')}</span>
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		</main>
	{:else}
		<main>
			<section class="col">
				{#if mode === 'group' && !group}
					<div class="card group-form">
						<div class="card-head">
							<h2>一起敲</h2>
							<p class="lead">開一個群，大家針對同一件事一起敲。</p>
						</div>

						{#if !isConfigured}
							<p class="empty">要先接上 Supabase 才能開群。</p>
						{:else}
							<label>
								<span>要一起敲的是什麼事？</span>
								<input
									bind:value={groupTitle}
									placeholder="例如：這次開會大家都少講兩句"
									maxlength="60"
									onkeydown={(e) => e.key === 'Enter' && makeGroup()}
								/>
							</label>
							<button class="btn primary" onclick={makeGroup} disabled={groupBusy}>
								{groupBusy ? '開群中…' : '開一個群'}
							</button>

							<div class="or"><span>或</span></div>

							<label>
								<span>有邀請碼？</span>
								<input
									bind:value={joinCode}
									placeholder="6 碼邀請碼"
									maxlength="8"
									style="text-transform: uppercase"
									onkeydown={(e) => e.key === 'Enter' && joinGroup(joinCode)}
								/>
							</label>
							<button class="btn ghost" onclick={() => joinGroup(joinCode)} disabled={groupBusy}>
								加入
							</button>
						{/if}

						{#if groupError}
							<p class="note">{groupError}</p>
						{/if}
					</div>
				{:else}
					<div class="card altar">
						{#if mode === 'solo'}
							<div class="stats" aria-live="polite">
								<div class="stat">
									<span class="value">{merit.toLocaleString('en-US')}</span>
									<span class="key">你的功德</span>
								</div>
								<span class="divider" aria-hidden="true"></span>
								<div class="stat">
									<span class="value soft">
										{loading ? '—' : total.toLocaleString('en-US')}
									</span>
									<span class="key">大家一共</span>
								</div>
							</div>
						{:else if group}
							<div class="group-bar">
								<p class="group-title">{group.title}</p>
								<p class="group-meta">
									<span>邀請碼 <b>{group.code}</b></span>
									<span>已敲 <b>{groupKnocks.toLocaleString('en-US')}</b> 下</span>
								</p>
								<div class="group-actions">
									<button class="chip-btn" onclick={copyInvite}>複製邀請連結</button>
									<button class="chip-btn" onclick={leaveGroup}>離開</button>
								</div>
							</div>
						{/if}

						{#if mode === 'solo'}
							<!-- 三種驅動共用下面那顆木魚，差別只在誰敲、敲完做什麼 -->
							<div class="drivers" style="--i: {driverIdx}">
								<span class="d-thumb" aria-hidden="true"></span>
								{#each DRIVERS as d (d.id)}
									<button
										class="d-opt"
										class:active={driver === d.id}
										onclick={() => switchDriver(d.id)}
										aria-pressed={driver === d.id}
										title={d.desc}>{d.label}</button
									>
								{/each}
							</div>
						{/if}

						<!--
							超渡的龕。照片不是貼在木魚上，是立在木魚「後面」、被木魚的光托著。
							z-index 木魚(2) 在照片(1) 前面——這個前後關係就是整個設計的重點：
							照片在前 = 對著誰；照片在後 = 供著誰。
						-->
						<div
							class="shrine"
							class:has-photo={showShrine}
							class:lit={showShrine && autoRunning}
							class:releasing={ritualDone}
						>
							{#if showShrine || ritualDone}
								<div class="enshrine" aria-hidden="true">
									<div class="halo"></div>
									<figure class="frame">
										<img src={ritualPhoto} alt="" />
									</figure>
								</div>
								{#if !autoRunning && !ritualDone}
									<button class="shrine-x" onclick={clearRitualPhoto} aria-label="移除照片">
										✕
									</button>
								{/if}
							{/if}

							<Knocker
								bind:this={knocker}
								{fish}
								haptics={hapticsOn}
								onKnock={mode === 'solo' ? onSoloKnock : onGroupKnock}
								onHold={mode === 'solo' && driver === 'manual'}
								{onHoldKnock}
								{onHoldChange}
							/>
						</div>

						{#if mode === 'solo' && driver === 'auto'}
							<AutoControls
								{bpm}
								minutes={autoMinutes}
								running={autoRunning}
								remaining={autoRemaining}
								knocked={autoKnocked}
								{slowDown}
								{ambient}
								{ambientVol}
								onBpm={setBpm}
								onMinutes={setAutoMinutes}
								onToggle={toggleAuto}
								onSlowDown={setSlowDown}
								onAmbient={pickAmbient}
								onAmbientVol={setAmbientVol}
							/>
						{/if}

						{#if mode === 'solo' && driver === 'ritual'}
							<RitualPanel
								text={ritualText}
								minutes={ritualMinutes}
								running={autoRunning}
								remaining={autoRemaining}
								knocked={autoKnocked}
								done={ritualDone}
								photo={ritualPhoto}
								onText={setRitualText}
								onMinutes={setRitualMinutes}
								onToggle={toggleRitual}
								onDismiss={dismissRitual}
								onPhoto={setRitualPhoto}
							/>
							{#if photoError}
								<p class="photo-err" transition:fade={{ duration: 200 }}>{photoError}</p>
							{/if}
						{/if}

						{#if mode === 'solo' && driver === 'manual'}
							{#if blessing}
								<p class="blessing" transition:fade={{ duration: 400 }}>
									敲滿 {MILESTONE} 下，百八煩惱先放一邊 🙏
								</p>
							{/if}

							<div class="sin-zone">
								{#if selectedSin && !pickerOpen}
									<button class="current" onclick={() => (pickerOpen = true)}>
										<span class="tag">正在懺悔</span>
										<span class="cur-label">{sinEmoji(selectedSin)} {selectedLabel}</span>
										<span class="change">換一個</span>
									</button>
								{:else}
									<div class="sins" class:hint={hintPicker}>
										{#each allSins as sin (sin.id)}
											<span class="sin-wrap">
												<button
													class="sin"
													class:active={sin.id === selectedSin}
													onclick={() => selectSin(sin.id)}
												>
													<span aria-hidden="true">{sin.emoji}</span>{sin.label}
												</button>
												{#if isCustom(sin.id)}
													<button
														class="drop"
														onclick={() => dropCustom(sin.id)}
														aria-label="刪掉「{sin.label}」"
													>
														<svg viewBox="0 0 24 24" aria-hidden="true">
															<path d="M6 6l12 12M18 6L6 18" />
														</svg>
													</button>
												{/if}
											</span>
										{/each}

										{#if composing}
											<!-- svelte-ignore a11y_autofocus -->
											<input
												class="draft"
												bind:value={draft}
												maxlength={CUSTOM_MAX_LEN}
												placeholder="自己寫一句…"
												autofocus
												onkeydown={(e) => {
													if (e.key === 'Enter') commitDraft();
													if (e.key === 'Escape') {
														composing = false;
														draft = '';
													}
												}}
												onblur={commitDraft}
											/>
										{:else if !customLimitReached(customSins)}
											<button class="sin add" onclick={() => (composing = true)}>
												<span aria-hidden="true">＋</span>自訂
											</button>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<div class="card controls" class:open={controlsOpen}>
						<!-- 一行字交代現在的設定，折疊的小三角形就跟在同一行 -->
						<div class="ctrl-line">
							<span class="ctrl-now">{summary}</span>
							<button
								class="fold"
								onclick={toggleControls}
								aria-expanded={controlsOpen}
								aria-controls="controls-body"
								aria-label={controlsOpen ? '收起木魚與效果' : '展開木魚與效果'}
							>
								<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M0 0h10L5 6z" /></svg>
							</button>
						</div>

						{#if controlsOpen}
							<div class="controls-body" id="controls-body" transition:slide={{ duration: 220 }}>
								<FishPicker sizeId={fish.size.id} woodId={fish.wood.id} onPick={pickFish} />
								<p class="fish-desc">{fish.label} · {fish.wood.desc}</p>

								<div class="switches">
									<button class="switch" role="switch" aria-checked={!muted} onclick={toggleMute}>
										<span>聲音</span>
										<span class="track" aria-hidden="true"><span class="knob"></span></span>
									</button>
									<button
										class="switch"
										role="switch"
										aria-checked={hapticsSupported && hapticsOn}
										disabled={!hapticsSupported}
										title={hapticsSupported ? '' : 'iOS Safari 不支援 Vibration API'}
										onclick={toggleHaptics}
									>
										<span>震動{hapticsSupported ? '' : '（不支援）'}</span>
										<span class="track" aria-hidden="true"><span class="knob"></span></span>
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</section>

			<aside class="card feed">
				<h2 class="feed-head">
					<span class="live" aria-hidden="true"></span>
					{group ? '這個群的敲擊' : '大家的懺悔'}
				</h2>
				{#if !isConfigured}
					<p class="empty">
						還沒接上 Supabase，暫時只有你一個人在敲。<br />照 README 設好
						<code>.env</code> 就會有人陪你了。
					</p>
				{:else if loading}
					<p class="empty">正在連上眾生…</p>
				{:else if feed.length === 0}
					<p class="empty">目前一片清淨。<br />你可以當第一個。</p>
				{:else}
					<ul>
						{#each feed as k, i (k.id)}
							<li
								animate:flip={{ duration: 280 }}
								in:fly={{ y: -16, duration: 360 }}
								out:fade={{ duration: 220 }}
								style="--dim:{Math.max(0.35, 1 - i / (FEED_MAX * 0.85))}"
							>
								<span class="bell">{k.sin ? sinEmoji(k.sin) : '🔔'}</span>
								<span class="text">{phraseFor(k)}</span>
								<span class="when">{timeAgo(k.created_at)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</aside>
		</main>
	{/if}

	<footer>這裡只懺悔自己，不檢舉別人。</footer>
</div>


<style>
	/* ── 版面 ──
	   桌面：左側 rail 固定，內容讓開 232px。
	   手機：rail 變成底部 tab bar，內容改讓開下方。 */
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		padding-left: 232px;
	}

	.topbar {
		display: none;
	}

	/* 桌面版的帳號入口在左側 rail 底部，這顆只給手機用 */
	.account {
		display: none;
	}

	main {
		flex: 1;
		width: 100%;
		max-width: 1100px;
		margin: 0 auto;
		padding: 2.4rem 1.6rem 1.4rem;
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
		gap: 1.2rem;
		align-items: start;
	}

	main.single {
		grid-template-columns: minmax(0, 560px);
		justify-content: center;
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		min-width: 0;
	}

	/* ── 卡片：全站唯一的容器樣式 ── */
	.card {
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-soft);
		padding: 1.5rem;
		min-width: 0;
	}

	.card-head {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.4rem;
	}

	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--ink);
	}

	.lead {
		margin: 0;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}

	footer {
		padding: 1.6rem 1.6rem 2rem;
		text-align: center;
		font-size: 0.74rem;
		color: var(--ink-faint);
	}

	/* ── 木魚區 ── */
	.altar {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.4rem;
		padding: 1.8rem 1.5rem 1.6rem;
	}

	.stats {
		display: flex;
		align-items: center;
		gap: 1.6rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
	}

	.value {
		font-family: var(--serif);
		font-size: 1.7rem;
		font-weight: 600;
		line-height: 1.15;
		color: var(--sandal-deep);
		font-variant-numeric: tabular-nums;
	}

	.value.soft {
		color: var(--ink-faint);
		font-size: 1.25rem;
		line-height: 1.55;
	}

	.key {
		font-size: 0.7rem;
		letter-spacing: 0.14em;
		color: var(--ink-faint);
	}

	.divider {
		width: 1px;
		height: 30px;
		background: var(--line);
	}

	/* ── 超渡的龕 ────────────────────────────────────
	   照片立在木魚後面，被木魚上方的光托著。整組設計的重點是前後關係：
	   木魚(z-index 2) 永遠在照片(1) 前面，所以你敲的是擋在照片前面的木頭，
	   不是照片本身。照片在前是「對著誰」，照片在後是「供著誰」。 */
	.shrine {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		--photo-w: 176px;
		--photo-h: 224px;
		--shrine-rise: 0px;
		--knock-shrink: 1;
		padding-top: var(--shrine-rise);
		transition: padding-top 0.35s cubic-bezier(0.3, 0.8, 0.4, 1);
	}

	/* 放了照片：木魚縮到 0.78 讓出上方空間。--knock-shrink 會跟 fish.scale
	   相乘，尺寸預設（手持 0.74 / 中型 0.88 / 大殿 1）完全不受影響。 */
	/* 超渡的主角是被超渡的那個人事物，不是木魚：照片放大、木魚退到 0.62。
	   rise 是算出來的——照片高 224、要有 18% 塞進木魚後面，扣掉木頭頂端在
	   畫布內的內縮（約 24px），所以 224*0.82-24 ≈ 159。 */
	.shrine.has-photo {
		--shrine-rise: 159px;
		--knock-shrink: 0.62;
	}

	/* 儀式進行到照片已經升走了，木魚才長回原本大小——壇重新空出來 */
	.shrine.releasing {
		--shrine-rise: 0px;
		--knock-shrink: 1;
		transition-delay: 1.4s;
	}

	.shrine.releasing :global(.wrap) {
		transition-delay: 1.4s;
	}

	.shrine :global(.wrap) {
		position: relative;
		z-index: 2;
	}

	/*
	 * 功德浮字預設從木魚頂端往上飄 104px，在這裡會正好穿過照片的臉。
	 * 那等於每敲一下就有東西打在照片上——正是這個設計要避免的畫面。
	 * 放了照片時改成從木魚中段起、只飄 52px，在碰到龕之前就淡掉。
	 */
	.shrine.has-photo :global(.floater) {
		top: 66%;
		animation-name: rise-low;
	}

	@keyframes rise-low {
		0% {
			opacity: 0;
			transform: translate(calc(-50% + var(--dx)), 10px) scale(0.75) rotate(var(--rot));
		}
		22% {
			opacity: 1;
			transform: translate(calc(-50% + var(--dx)), 0) scale(1.04) rotate(var(--rot));
		}
		100% {
			opacity: 0;
			transform: translate(calc(-50% + var(--dx)), -52px) scale(1) rotate(var(--rot));
		}
	}

	/* 整層不吃點擊：木魚是個 button，上面不能有東西攔住它 */
	.enshrine {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
	}

	.frame {
		position: absolute;
		top: 0;
		left: 50%;
		width: var(--photo-w);
		height: var(--photo-h);
		margin: 0;
		/* 直立的橢圓，下半略飽滿——正圓像蛋，這個比例才像龕 */
		border-radius: 50% / 46% 46% 54% 54%;
		overflow: hidden;
		background: var(--surface-2);
		/* 中間那層 4px 的紙襯很關鍵：少了它照片會像直接鑲在木魚上（同一個
		   物件＝貼在你要敲的東西上），有了它才是一張被裱起來、另外立著的像 */
		box-shadow:
			0 0 0 1px var(--line),
			0 0 0 4px var(--surface),
			0 0 0 5px rgba(176, 124, 78, 0.28),
			var(--shadow-lift);
		/* 稍微退一點彩度，讓現代照片融進這套暖色；太飽和會整個跳到最前面 */
		opacity: 0.88;
		filter: saturate(0.92);
		/* 從底部升起：它是從供台上離開，不是朝你放大 */
		transform: translateX(-50%);
		transform-origin: 50% 88%;
		transition:
			opacity var(--slow),
			filter var(--slow),
			transform var(--slow),
			box-shadow var(--slow);
	}

	.frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* 大部分照片的臉在中線偏上 */
		object-position: 50% 32%;
	}

	/* 開始超渡：像整個亮起來、對上焦，而不是有什麼被敲到 */
	.shrine.lit .frame {
		opacity: 1;
		filter: saturate(1);
		transform: translateX(-50%) translateY(-3px);
		box-shadow:
			0 0 0 1px var(--line),
			0 0 0 4px var(--surface),
			0 0 0 5px rgba(176, 124, 78, 0.42),
			var(--shadow-lift);
	}

	/* 光從接縫升起——木魚是燈，照片是被照亮的那個。由上往下打光像審問 */
	.halo {
		position: absolute;
		top: calc(var(--shrine-rise) - 38px);
		left: 50%;
		width: 234px;
		height: 108px;
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(
			ellipse at 50% 60%,
			rgba(200, 135, 60, 0.2) 0%,
			rgba(220, 178, 137, 0.12) 42%,
			rgba(220, 178, 137, 0) 72%
		);
		opacity: 0;
		transition: opacity var(--slow);
		pointer-events: none;
	}

	.shrine.has-photo .halo {
		opacity: 0.85;
	}

	.shrine.lit .halo {
		opacity: 1;
		animation: breathe 4.2s var(--ease) infinite;
	}

	/* 4.2 秒約一次慢呼吸，刻意不跟敲擊同步——光一跟著敲就變成照片在閃躲 */
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.72;
			transform: translateX(-50%) scale(1);
		}
		50% {
			opacity: 1;
			transform: translateX(-50%) scale(1.07);
		}
	}

	.shrine-x {
		position: absolute;
		top: 2px;
		left: calc(50% + var(--photo-w) / 2 - 4px);
		z-index: 3;
		width: 28px;
		height: 28px;
		font-size: 0.75rem;
		color: var(--ink-faint);
		background: var(--surface);
		border-radius: var(--r-full);
		box-shadow: var(--shadow-soft);
		transition:
			color var(--fast),
			opacity var(--fast);
	}

	.shrine-x:hover {
		color: var(--ink);
	}

	/*
	 * 儀式：框先鬆手（0.9s），照片才升走（3.4s）。
	 *
	 * 順序不能反。框跟著照片一起升＝把一個東西搬走；框先化掉、照片才升＝
	 * 放手。這是整段儀式最重要的一拍。
	 */
	.shrine.releasing .frame {
		animation: ascend 3.4s var(--ease) forwards;
		box-shadow:
			0 0 0 1px transparent,
			0 0 0 4px transparent,
			0 0 0 5px transparent;
		transition: box-shadow 0.9s var(--ease);
	}

	.shrine.releasing .halo {
		animation: halo-release 1.6s var(--ease) forwards;
	}

	/* 每個 keyframe 都要帶 translateX(-50%)，不然動畫一開始照片會彈到左邊。
	   放大只到 1.14（不是 1.22）：從底部放大太多會變成朝你逼近，
	   小幅放大＋長距離上升才是「遠離、上去」 */
	@keyframes ascend {
		0% {
			opacity: 1;
			transform: translateX(-50%) scale(1);
			filter: brightness(1) blur(0);
		}
		30% {
			opacity: 0.85;
			transform: translateX(-50%) scale(1.03) translateY(-10px);
			filter: brightness(1.35) blur(1px);
		}
		100% {
			opacity: 0;
			transform: translateX(-50%) scale(1.14) translateY(-54px);
			filter: brightness(2.3) blur(14px);
		}
	}

	@keyframes halo-release {
		0% {
			opacity: 1;
			transform: translateX(-50%) scale(1);
		}
		35% {
			opacity: 0.55;
			transform: translateX(-50%) scale(1.4);
		}
		100% {
			opacity: 0;
			transform: translateX(-50%) scale(1.75);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.shrine,
		.frame,
		.halo {
			transition: none;
		}

		.halo {
			animation: none;
		}

		/* 保留狀態差異，只拿掉呼吸 */
		.shrine.lit .halo {
			opacity: 1;
		}

		/* 不動也要讀得出「幾乎不在了」。臉留在 35% 會比文字更有存在感，所以更低 */
		.shrine.releasing .frame {
			animation: none;
			opacity: 0.18;
			filter: brightness(1.6);
			box-shadow: none;
			transform: translateX(-50%);
		}

		.shrine.releasing .halo {
			animation: none;
			opacity: 0;
		}
	}

	.photo-err {
		margin: 0.4rem 0 0;
		text-align: center;
		font-size: 0.76rem;
		color: var(--ink-faint);
	}

	.blessing {
		margin: 0;
		font-size: 0.8rem;
		color: var(--sandal-deep);
		background: var(--saffron-soft);
		border-radius: var(--r-full);
		padding: 0.35rem 0.95rem;
	}

	/* ── 手動 / 自動 ── */
	.drivers {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		width: 100%;
		max-width: 264px;
		padding: 3px;
		background: var(--surface-2);
		border-radius: var(--r-full);
	}

	.d-thumb {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 3px;
		width: calc((100% - 6px) / 3);
		background: var(--surface);
		border-radius: var(--r-full);
		box-shadow: var(--shadow-soft);
		transform: translateX(calc(var(--i) * 100%));
		transition: transform var(--slow);
	}

	.d-opt {
		position: relative;
		z-index: 1;
		padding: 0.34rem 0.3rem;
		font-size: 0.8rem;
		color: var(--ink-soft);
		border-radius: var(--r-full);
		transition: color var(--fast);
	}

	.d-opt:hover {
		color: var(--ink);
	}

	.d-opt.active {
		color: var(--ink);
		font-weight: 600;
	}

	/* ── 口業 ── */
	.sin-zone {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.sins {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem;
	}

	.sins.hint {
		animation: nudge 0.5s var(--ease);
	}

	@keyframes nudge {
		0%,
		100% {
			transform: translateY(0);
		}
		40% {
			transform: translateY(-4px);
		}
	}

	.sin {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.42rem 0.8rem;
		font-size: 0.83rem;
		color: var(--ink-soft);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-full);
		transition:
			background var(--fast),
			border-color var(--fast),
			color var(--fast);
	}

	.sin:hover {
		border-color: var(--sandal-light);
		color: var(--ink);
	}

	.sin.active {
		background: var(--saffron);
		border-color: var(--saffron);
		color: #fffdf9;
		font-weight: 500;
	}

	/* ── 自訂 ── */
	.sin-wrap {
		position: relative;
		display: inline-flex;
	}

	/* 刪除鈕疊在膠囊右上角，只有 hover / focus 才現身，平常不干擾閱讀 */
	.drop {
		position: absolute;
		top: -5px;
		right: -5px;
		display: grid;
		place-items: center;
		width: 17px;
		height: 17px;
		color: var(--ink-soft);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-full);
		opacity: 0;
		transition:
			opacity var(--fast),
			color var(--fast);
	}

	.sin-wrap:hover .drop,
	.drop:focus-visible {
		opacity: 1;
	}

	.drop:hover {
		color: #a2503a;
	}

	.drop svg {
		width: 9px;
		height: 9px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.4;
		stroke-linecap: round;
	}

	.sin.add {
		border-style: dashed;
		color: var(--ink-faint);
	}

	.draft {
		width: 9.5rem;
		padding: 0.42rem 0.8rem;
		font: inherit;
		font-size: 0.83rem;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--saffron);
		border-radius: var(--r-full);
	}

	.draft:focus {
		outline: none;
	}

	.current {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem 0.35rem 0.4rem;
		background: var(--surface-2);
		border-radius: var(--r-full);
		transition: background var(--fast);
	}

	.current:hover {
		background: var(--saffron-soft);
	}

	.tag {
		font-size: 0.65rem;
		letter-spacing: 0.08em;
		color: #fffdf9;
		background: var(--saffron);
		border-radius: var(--r-full);
		padding: 0.16rem 0.5rem;
	}

	.cur-label {
		font-size: 0.88rem;
		font-weight: 500;
		color: var(--ink);
	}

	.change {
		font-size: 0.72rem;
		color: var(--ink-faint);
	}

	/* ── 控制列：可折疊的木魚選擇 + 開關 ── */
	.controls {
		position: relative;
		padding: 0.6rem 1.2rem;
	}

	.ctrl-line {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
	}

	.ctrl-now {
		font-size: 0.76rem;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 小三角形，跟著設定那行走 */
	.fold {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		border-radius: var(--r-full);
		transition: background var(--fast);
	}

	.fold:hover {
		background: var(--surface-2);
	}

	.fold svg {
		width: 9px;
		height: 6px;
		fill: var(--ink-faint);
		transition: transform var(--slow);
	}

	.controls.open .fold svg {
		transform: rotate(180deg);
	}

	.controls-body {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.55rem;
		padding: 0.85rem 0 0.7rem;
	}

	.fish-desc {
		margin: 0;
		font-size: 0.74rem;
		color: var(--ink-faint);
	}

	.switches {
		display: flex;
		gap: 1.4rem;
		width: 100%;
		max-width: 340px;
		margin-top: 0.35rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line-soft);
	}

	.switch {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.3rem 0.1rem;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}

	.switch:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.track {
		position: relative;
		width: 38px;
		height: 22px;
		flex-shrink: 0;
		background: var(--surface-2);
		border-radius: var(--r-full);
		transition: background var(--fast);
	}

	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 16px;
		height: 16px;
		background: var(--surface);
		border-radius: 50%;
		box-shadow: 0 1px 3px rgba(60, 45, 25, 0.25);
		transition: transform var(--fast);
	}

	.switch[aria-checked='true'] .track {
		background: var(--saffron);
	}

	.switch[aria-checked='true'] .knob {
		transform: translateX(16px);
	}

	/* ── 群組 ── */
	.group-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.78rem;
		color: var(--ink-soft);
	}

	input {
		font: inherit;
		font-size: 0.92rem;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 0.62rem 0.8rem;
		transition:
			border-color var(--fast),
			box-shadow var(--fast);
	}

	input::placeholder {
		color: var(--ink-faint);
	}

	input:focus {
		outline: none;
		border-color: var(--saffron);
		box-shadow: 0 0 0 3px var(--saffron-soft);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.66rem 1.1rem;
		font-size: 0.9rem;
		font-weight: 600;
		border-radius: var(--r-sm);
		transition:
			background var(--fast),
			opacity var(--fast),
			transform var(--fast);
	}

	.btn:active {
		transform: scale(0.985);
	}

	.btn.primary {
		color: #fffdf9;
		background: var(--sandal-deep);
	}

	.btn.primary:hover {
		background: #5c3b22;
	}

	.btn.ghost {
		color: var(--ink);
		background: var(--surface-2);
	}

	.btn.ghost:hover {
		background: var(--saffron-soft);
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.or {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		font-size: 0.72rem;
		color: var(--ink-faint);
	}

	.or::before,
	.or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line-soft);
	}

	.note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--sandal-deep);
		word-break: break-all;
	}

	.group-bar {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}

	.group-title {
		margin: 0;
		font-family: var(--serif);
		font-size: 1.02rem;
		color: var(--ink);
	}

	.group-meta {
		display: flex;
		gap: 1rem;
		margin: 0;
		font-size: 0.75rem;
		color: var(--ink-faint);
	}

	.group-meta b {
		color: var(--sandal-deep);
		letter-spacing: 0.06em;
		font-variant-numeric: tabular-nums;
	}

	.group-actions {
		display: flex;
		gap: 0.35rem;
	}

	.chip-btn {
		padding: 0.32rem 0.75rem;
		font-size: 0.76rem;
		color: var(--ink-soft);
		background: var(--surface-2);
		border-radius: var(--r-full);
		transition:
			background var(--fast),
			color var(--fast);
	}

	.chip-btn:hover {
		background: var(--saffron-soft);
		color: var(--sandal-deep);
	}

	/* ── 排行 ── */
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* ── 功德簿：施主資料 ── */
	.field {
		display: block;
		margin-bottom: 0.3rem;
		font-size: 0.76rem;
		color: var(--ink-soft);
	}

	.name-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.name {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0.7rem;
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		transition: border-color var(--fast);
	}

	.name:focus {
		outline: none;
		border-color: var(--saffron);
	}

	.name:disabled {
		color: var(--ink-soft);
		background: var(--surface-2);
		cursor: default;
	}

	.dice {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		color: var(--ink-soft);
		background: var(--surface-2);
		border-radius: var(--r-sm);
		transition:
			transform var(--fast),
			color var(--fast),
			opacity var(--fast);
	}

	.dice:hover:not(:disabled) {
		color: var(--sandal-deep);
	}

	/* 按下去像真的擲了一把 */
	.dice:active:not(:disabled) {
		transform: rotate(-24deg) scale(0.94);
	}

	.dice:disabled,
	.save:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.dice svg {
		width: 19px;
		height: 19px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
	}

	.dice svg circle {
		fill: currentColor;
		stroke: none;
	}

	.save {
		flex-shrink: 0;
		padding: 0.55rem 0.7rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--sandal-deep);
		background: var(--saffron-soft);
		border-radius: var(--r-sm);
		transition: opacity var(--fast);
	}

	.hint-line {
		margin: 0.45rem 0 0;
		font-size: 0.74rem;
		color: var(--ink-faint);
	}

	.link {
		padding: 0;
		font-size: inherit;
		color: var(--saffron);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.info {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.3rem 0.9rem;
		margin: 0.85rem 0 0;
		font-size: 0.79rem;
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

	/* ── 功德簿：紀錄 ── */
	.ledger {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
		margin: 0.4rem 0 0.2rem;
		padding: 0.9rem 0;
		border-top: 1px solid var(--line-soft);
		border-bottom: 1px solid var(--line-soft);
	}

	.ledger .stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
	}

	.ledger .value {
		font-family: var(--serif);
		font-size: 1.35rem;
		line-height: 1.2;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.ledger .key {
		font-size: 0.7rem;
		color: var(--ink-faint);
	}

	/* 四個數字擠在窄螢幕一排會太緊，換成 2×2 */
	@media (max-width: 480px) {
		.ledger {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.9rem 0.5rem;
		}

		/* 窄螢幕的木魚本來就小，照片跟著收一點，但仍然是畫面的主角 */
		.shrine.has-photo {
			--photo-w: 158px;
			--photo-h: 200px;
			--shrine-rise: 142px;
		}

		.halo {
			width: 208px;
			height: 98px;
		}
	}

	.most {
		margin: 0.6rem 0 0.2rem;
		font-size: 0.8rem;
		color: var(--ink-soft);
	}

	.most b {
		font-weight: 600;
		color: var(--ink);
	}

	.ach-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin-top: 1rem;
	}

	.ach-head h3 {
		margin: 0;
		font-family: var(--serif);
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: 0.1em;
	}

	.ach-count {
		margin-left: auto;
		font-size: 0.76rem;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.achievements {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.achievements li {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem 0.2rem;
	}

	.achievements li + li {
		box-shadow: inset 0 1px 0 var(--line-soft);
	}

	/* 沒解鎖的徽章去色，一眼分得出拿到沒有 */
	.badge {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 34px;
		height: 34px;
		font-size: 1.05rem;
		background: var(--surface-2);
		border-radius: var(--r-full);
		filter: grayscale(1);
		opacity: 0.5;
		transition:
			filter var(--slow),
			opacity var(--slow);
	}

	.achievements li.done .badge {
		background: var(--saffron-soft);
		filter: none;
		opacity: 1;
	}

	.ach-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}

	.ach-name {
		font-size: 0.86rem;
		color: var(--ink-faint);
	}

	.achievements li.done .ach-name {
		color: var(--ink);
		font-weight: 600;
	}

	.ach-desc {
		font-size: 0.72rem;
		color: var(--ink-faint);
	}

	.bar {
		height: 3px;
		margin-top: 0.3rem;
		background: var(--surface-2);
		border-radius: var(--r-full);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--sandal-light);
		border-radius: var(--r-full);
		transition: width var(--slow);
	}

	.ach-num {
		flex-shrink: 0;
		font-size: 0.74rem;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.achievements li.done .ach-num {
		color: var(--saffron);
		font-weight: 700;
	}

	.rank {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
	}

	.rank li {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.6rem 0.6rem;
		border-radius: var(--r-sm);
		font-size: 0.88rem;
	}

	.rank li + li {
		box-shadow: inset 0 1px 0 var(--line-soft);
	}

	.rank li.me {
		background: var(--saffron-soft);
		box-shadow: none;
	}

	.pos {
		width: 1.7em;
		text-align: right;
		font-family: var(--serif);
		font-size: 0.85rem;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.pos.top {
		color: var(--saffron);
		font-weight: 600;
	}

	.who {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.num {
		font-family: var(--serif);
		color: var(--sandal-deep);
		font-variant-numeric: tabular-nums;
	}

	/* ── feed ── */
	.feed {
		position: sticky;
		top: 1.6rem;
		padding: 1.3rem 1.4rem 0.4rem;
		max-height: calc(100vh - 4.5rem);
		display: flex;
		flex-direction: column;
	}

	.feed-head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0 0 0.9rem;
		font-size: 0.92rem;
		letter-spacing: 0.12em;
		color: var(--ink-soft);
	}

	.live {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--celadon);
		flex-shrink: 0;
		animation: pulse 2.8s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 1;
		}
	}

	.feed ul {
		list-style: none;
		margin: 0;
		padding: 0 0 1.4rem;
		overflow-y: auto;
		mask-image: linear-gradient(to bottom, #000 85%, transparent 100%);
	}

	.feed li {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		padding: 0.55rem 0;
		font-size: 0.855rem;
		line-height: 1.6;
		opacity: var(--dim);
	}

	.feed li + li {
		box-shadow: inset 0 1px 0 var(--line-soft);
	}

	.bell {
		flex-shrink: 0;
	}

	.text {
		flex: 1;
		color: var(--ink);
	}

	.when {
		flex-shrink: 0;
		font-size: 0.7rem;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.empty {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.9;
		color: var(--ink-soft);
	}

	code {
		font-size: 0.9em;
		background: var(--surface-2);
		border-radius: var(--r-xs);
		padding: 0.05em 0.35em;
	}

	/* ── RWD 桌面→平板 ── */
	@media (max-width: 980px) {
		main {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
			padding: 1.8rem 1.2rem 1rem;
		}

		.feed {
			position: static;
			max-height: none;
		}

		.feed ul {
			max-height: 44vh;
		}
	}

	/* ── RWD 手機：rail 變底部 tab bar ── */
	@media (max-width: 760px) {
		.page {
			padding-left: 0;
			padding-bottom: calc(4.4rem + env(safe-area-inset-bottom));
		}

		.topbar {
			position: sticky;
			top: 0;
			z-index: 20;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 0.45rem;
			padding: 0.7rem 1rem;
			background: rgba(246, 242, 234, 0.85);
			backdrop-filter: saturate(1.6) blur(14px);
			-webkit-backdrop-filter: saturate(1.6) blur(14px);
			border-bottom: 1px solid var(--line-soft);
		}

		/* 絕對定位，標題才能維持在正中間 */
		.account {
			position: absolute;
			right: 0.9rem;
			top: 50%;
			transform: translateY(-50%);
			display: inline-flex;
			align-items: center;
			gap: 0.32rem;
			padding: 0.28rem 0.6rem;
			font-size: 0.76rem;
			color: var(--ink-soft);
			background: var(--surface);
			border: 1px solid var(--line);
			border-radius: var(--r-full);
		}

		.account .dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: var(--line);
		}

		.account .dot.on {
			background: var(--celadon);
		}

		h1 {
			margin: 0;
			font-family: var(--serif);
			font-size: 1.02rem;
			font-weight: 600;
			letter-spacing: 0.16em;
			text-indent: 0.16em;
		}

		.logo {
			font-size: 1.1rem;
		}

		main {
			padding: 1rem 0.9rem 0.5rem;
		}

		.card {
			padding: 1.2rem 1rem;
			border-radius: var(--r-md);
		}

		.altar {
			padding: 1.4rem 1rem;
		}

		footer {
			padding: 1rem 1rem 0.5rem;
		}
	}
</style>

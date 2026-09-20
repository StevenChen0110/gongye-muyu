/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Service worker：讓「加到主畫面」之後可以離線敲木魚。
 *
 * 木魚本身完全不需要網路——聲音是 Web Audio 即時合成的、木魚是 Canvas 畫的、
 * 背景音也是程式產生的。會用到網路的只有共業數字與公開 feed，那些沒有就沒有，
 * 不該擋住敲木魚這件事。
 *
 * 快取策略刻意分成兩種：
 * - 打包產物（$build，檔名帶 hash）→ cache first。內容不會變，永遠不用重抓。
 * - 靜態檔（$files：圖示、manifest）→ 同上，但更新時會被新版 SW 換掉。
 * - Supabase 的 API → 完全不碰。功德數字快取了只會顯示錯的數字，
 *   而寫入更不能離線重放（會重複計數）。
 */
import { build, files, version } from '$service-worker';

const CACHE = `muyu-${version}`;

/** 要預先抓下來的東西：打包產物 + 靜態檔。 */
const PRECACHE = [...build, ...files];

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			// 新版裝好就直接接手，不用等所有分頁關掉
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	// 只處理 GET：POST 是寫入，離線重放會重複計數
	if (req.method !== 'GET') return;

	const url = new URL(req.url);

	// 跨網域（Supabase、字型 CDN）一律直接走網路，不快取。
	// 功德數字快取了只會顯示錯的數字。
	if (url.origin !== self.location.origin) return;

	// 打包產物與靜態檔：檔名帶 hash 或不會變，直接拿快取
	const isPrecached = PRECACHE.includes(url.pathname);

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			if (isPrecached) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}

			// 其餘（HTML 導覽等）先試網路，失敗才退回快取——
			// 這樣線上時永遠拿得到最新版，離線時仍然打得開
			try {
				const res = await fetch(req);
				// 只快取成功的、同源的回應
				if (res.ok && res.status === 200 && res.type === 'basic') {
					cache.put(req, res.clone());
				}
				return res;
			} catch {
				const hit = await cache.match(req);
				if (hit) return hit;
				// 導覽請求離線時退回首頁（SPA 的 fallback）
				if (req.mode === 'navigate') {
					const shell = await cache.match('/');
					if (shell) return shell;
				}
				throw new Error('離線且沒有快取');
			}
		})()
	);
});

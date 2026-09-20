import adapterAuto from '@sveltejs/adapter-auto';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/*
 * 兩個 adapter：
 * - 平常（Vercel）用 adapter-auto，維持現在的部署方式不變。
 * - BUILD_TARGET=app 時輸出純靜態檔，給 Capacitor 包進 iOS/Android App 用。
 *
 * 這個 app 本來就沒有任何 +server / .server 檔案，+layout.ts 也已經是
 * ssr = false + prerender = true，所以靜態輸出不需要改任何程式碼。
 */
const forApp = process.env.BUILD_TARGET === 'app';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: forApp
			? adapterStatic({ pages: 'build', assets: 'build', fallback: 'index.html', precompress: false })
			: adapterAuto()
	}
};

export default config;

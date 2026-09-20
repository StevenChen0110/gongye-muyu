/**
 * 超渡用的照片。
 *
 * 只存在這台裝置，永遠不上傳。伺服器連「有沒有照片」都只知道一個布林值，
 * 拿不到影像本身。
 *
 * 為什麼堅持不上傳：這個功能讓使用者放別人的臉。一旦那些照片進了我們的
 * 伺服器，就變成「某個 App 存了一堆被詛咒的人的臉」——個資責任、儲存費用、
 * 被拿來散布惡意內容的風險全部上身。留在本機，這些問題一個都不存在。
 *
 * 存 IndexedDB 而不是 localStorage：localStorage 只能放字串，照片要轉成
 * base64 會膨脹約 33%，而且整個 localStorage 通常只有 5MB。IndexedDB 可以
 * 直接存 Blob，容量也寬得多。
 */

const DB_NAME = 'muyu';
const STORE = 'ritual-photo';
/** 只會有一張，用固定 key 覆蓋。 */
const KEY = 'current';

/** 縮到這個邊長以內再存。原圖動輒 4000px，儀式只需要看得清楚。 */
const MAX_EDGE = 900;
/** 壓縮後的目標品質。 */
const QUALITY = 0.82;
/** 超過這個大小的原始檔直接拒絕，免得讀一張 50MB 的 RAW 把分頁卡死。 */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export const ACCEPT = 'image/*';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const t = db.transaction(STORE, mode);
				const req = run(t.objectStore(STORE));
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
				t.oncomplete = () => db.close();
			})
	);
}

/**
 * 把選到的圖縮小、壓成 JPEG。
 *
 * 順帶一個隱私好處：重畫到 canvas 會把 EXIF 整段丟掉，包含拍攝地點的 GPS
 * 座標。使用者不會想到自己挑的那張照片裡帶著定位。
 */
async function shrink(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		bitmap.close();
		throw new Error('canvas 不可用');
	}
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();

	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
	if (!blob) throw new Error('壓縮失敗');
	return blob;
}

/** 存一張（會覆蓋舊的）。回傳可以直接丟進 img src 的 URL。 */
export async function savePhoto(file: File): Promise<string> {
	if (file.size > MAX_INPUT_BYTES) throw new Error('照片太大了');
	const blob = await shrink(file);
	await tx('readwrite', (s) => s.put(blob, KEY));
	return URL.createObjectURL(blob);
}

/** 讀回上次那張。沒有就回 null。 */
export async function loadPhoto(): Promise<string | null> {
	try {
		const blob = await tx<Blob | undefined>('readonly', (s) => s.get(KEY));
		return blob ? URL.createObjectURL(blob) : null;
	} catch {
		// 無痕模式 / 擋了 IndexedDB 都會走到這裡。沒照片不影響超渡本身。
		return null;
	}
}

export async function clearPhoto(): Promise<void> {
	try {
		await tx('readwrite', (s) => s.delete(KEY));
	} catch {
		// 清不掉也不該擋住使用者，下次存會覆蓋
	}
}

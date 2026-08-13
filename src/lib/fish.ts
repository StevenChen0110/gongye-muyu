/**
 * 木魚目錄：尺寸 × 木材 的交集，3 × 3 = 9 種。
 *
 * 尺寸決定音高與長短（物理上：體積越大、共鳴越低越長）。
 * 木材決定音色與顏色（密度越高、越硬 → 越亮、收得越快）。
 *
 * 要加新木材就往 WOODS 加一筆，不用改別的地方。
 */
import type { WoodenFishOptions } from './woodenFish';

export type SizeId = 'small' | 'medium' | 'large';
export type WoodId = 'camphor' | 'cypress' | 'rosewood';

/** 中型樟木 = 基準音，其他都是相對它的倍率 */
const BASE_FREQUENCY = 245;
const BASE_DECAYS = [0.135, 0.085, 0.05, 0.028];

export type Size = {
	id: SizeId;
	label: string;
	desc: string;
	/** 音高倍率 */
	freq: number;
	/** 衰減倍率 */
	decay: number;
	/** 畫面上的相對大小 */
	scale: number;
	/** 震動毫秒數：越大顆震得越沉 */
	vibrate: number;
};

export const SIZES: Size[] = [
	{ id: 'small', label: '手持', desc: '小巧清脆，敲得快', freq: 1.72, decay: 0.6, scale: 0.74, vibrate: 16 },
	{ id: 'medium', label: '中型', desc: '日常順手，聲音居中', freq: 1, decay: 1, scale: 0.88, vibrate: 28 },
	{ id: 'large', label: '大殿', desc: '低沉綿長，一敲一嘆', freq: 0.58, decay: 1.8, scale: 1, vibrate: 48 }
];

export type Wood = {
	id: WoodId;
	label: string;
	desc: string;
	/** canvas 用的木頭配色，由受光處到暗處 */
	palette: string[];
	/** 衰減再乘一次：硬木收得快、軟木拖得久 */
	decayMul: number;
	sound: Partial<WoodenFishOptions>;
};

export const WOODS: Wood[] = [
	{
		id: 'camphor',
		label: '樟木',
		desc: '廟裡最常見，聲音溫和居中',
		palette: ['#E6BD8E', '#C68F5F', '#A06D41', '#7A4C2C'],
		decayMul: 1,
		sound: {
			modeRatios: [1, 2.42, 3.94, 6.1],
			modeGains: [1, 0.42, 0.22, 0.1],
			lowpass: 4600,
			malletFrequency: 1600,
			malletQ: 0.8,
			malletDecay: 0.011,
			malletLevel: 0.42
		}
	},
	{
		id: 'cypress',
		label: '檜木',
		desc: '質地軟，聲音悶而甜',
		palette: ['#F1D6B0', '#DBB385', '#B98D5E', '#8C6337'],
		decayMul: 1.25,
		sound: {
			modeRatios: [1, 2.26, 3.68, 5.4],
			modeGains: [1, 0.36, 0.16, 0.06],
			lowpass: 3100,
			malletFrequency: 1020,
			malletQ: 0.6,
			malletDecay: 0.019,
			malletLevel: 0.3,
			airLevel: 0.22
		}
	},
	{
		id: 'rosewood',
		label: '花梨木',
		desc: '硬且密，聲音亮、收得快',
		palette: ['#CE8F66', '#AC6742', '#8A4A2C', '#5C2E19'],
		decayMul: 0.78,
		sound: {
			modeRatios: [1, 2.58, 4.32, 6.95],
			modeGains: [1, 0.5, 0.3, 0.16],
			lowpass: 7000,
			malletFrequency: 2450,
			malletQ: 1.1,
			malletDecay: 0.008,
			malletLevel: 0.5,
			airLevel: 0.1
		}
	}
];

export type Fish = {
	/** 例如 'large-rosewood' */
	id: string;
	size: Size;
	wood: Wood;
	/** 例如 '大殿花梨木' */
	label: string;
	/** 畫面上的相對大小 */
	scale: number;
	/** 震動毫秒數 */
	vibrate: number;
	palette: string[];
	sound: Partial<WoodenFishOptions>;
};

export const DEFAULT_FISH_ID = 'medium-camphor';

function bySize(id: string) {
	return SIZES.find((s) => s.id === id);
}

function byWood(id: string) {
	return WOODS.find((w) => w.id === id);
}

/** 組出一隻木魚。給不認得的 id 就回到預設那隻。 */
export function buildFish(sizeId: string, woodId: string): Fish {
	const size = bySize(sizeId) ?? SIZES[1];
	const wood = byWood(woodId) ?? WOODS[0];

	return {
		id: `${size.id}-${wood.id}`,
		size,
		wood,
		label: `${size.label}${wood.label}`,
		scale: size.scale,
		vibrate: size.vibrate,
		palette: wood.palette,
		sound: {
			...wood.sound,
			frequency: BASE_FREQUENCY * size.freq,
			modeDecays: BASE_DECAYS.map((d) => d * size.decay * wood.decayMul),
			volume: size.id === 'large' ? 0.62 : 0.55
		}
	};
}

/** 從 'large-rosewood' 這種 id 反解回木魚。 */
export function fishFromId(id: string | null): Fish {
	const [sizeId, woodId] = (id ?? DEFAULT_FISH_ID).split('-');
	return buildFish(sizeId, woodId);
}

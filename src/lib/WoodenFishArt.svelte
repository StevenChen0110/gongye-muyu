<svg viewBox="0 0 260 240" aria-hidden="true">
	<defs>
		<radialGradient id="muyuWood" cx="36%" cy="20%" r="86%">
			<stop offset="0%" stop-color="#e9c090" />
			<stop offset="50%" stop-color="#c28c5d" />
			<stop offset="100%" stop-color="#8a5b36" />
		</radialGradient>
		<linearGradient id="muyuCushion" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="#d8a771" />
			<stop offset="100%" stop-color="#a97445" />
		</linearGradient>
		<clipPath id="muyuClip">
			<ellipse cx="128" cy="122" rx="98" ry="80" />
		</clipPath>
	</defs>

	<!-- 蒲團：先畫，讓魚身壓在上面，看起來是「坐進去」而不是浮著 -->
	<ellipse cx="128" cy="196" rx="106" ry="24" fill="url(#muyuCushion)" />
	<ellipse cx="128" cy="192" rx="106" ry="24" fill="#e0b17c" />

	<!-- 魚身 -->
	<ellipse cx="128" cy="122" rx="98" ry="80" fill="url(#muyuWood)" />

	<g clip-path="url(#muyuClip)">
		<!-- 鱗紋刻痕 -->
		<g fill="none" stroke="#7a4f2d" stroke-width="2.5" opacity="0.17">
			<path d="M152 56c26 12 42 32 46 56" />
			<path d="M176 52c26 14 42 34 46 60" />
			<path d="M200 50c26 16 40 36 44 64" />
			<path d="M224 50c24 18 36 38 40 66" />
		</g>
		<!-- 沿著頂緣的刻槽 -->
		<path
			d="M46 112c6-32 38-56 82-56s76 24 82 56"
			fill="none"
			stroke="#6d4527"
			stroke-width="3"
			stroke-linecap="round"
			opacity="0.22"
		/>

		<!-- 開縫上緣的第二道刻槽，讓「嘴」有厚度 -->
		<path
			d="M44 128c34 26 100 26 148-2"
			fill="none"
			stroke="#6d4527"
			stroke-width="2.5"
			stroke-linecap="round"
			opacity="0.2"
		/>
	</g>

	<!-- 開縫（魚嘴）：水平、貫穿式，這是木魚最關鍵的辨識點 -->
	<path d="M38 146 L192 140 C176 154 58 157 38 146 Z" fill="#472b17" opacity="0.95" />

	<!-- 高光 -->
	<path
		d="M60 92c10-20 28-33 48-38"
		fill="none"
		stroke="#fbe4c4"
		stroke-width="9"
		stroke-linecap="round"
		opacity="0.3"
	/>
</svg>

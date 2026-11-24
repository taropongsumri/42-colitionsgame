<script lang="ts">
	import { onMount } from 'svelte';
	import { HOUSES, type HouseId } from '$lib/shared/types';

	/** Boss arena ported from the old prototype's boss.html look and controls. */
	export let house: HouseId;
	export let boss: { id: string; name: string; title: string; question: string; hp: number };
	export let words: string[] = [];
	export let wordIndex = 0;
	export let hp = 1000;
	export let maxHp = 1000;
	export let playerHp = 100;
	export let shield = 0;
	export let mode: 'idle' | 'typing' | 'attack' | 'audition' | 'stunned' = 'typing';
	export let combo = 0;
	export let auditionLength = 0;
	export let moveLabel = '';
	export let lockUntil: number | null = null;
	export let swapReadyAt = 0;
	export let invulnUntil = 0;
	export let feedback = '';
	export let onWord: (word: string) => void;
	export let onAnswer: (answer: string) => void;
	export let onMode: (mode: 'typing' | 'attack') => void;
	export let onSwap: () => void;
	export let onLeave: () => void;

	type Float = { text: string; color: string; x: number; y: number; life: number };

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let playerImage: HTMLImageElement;
	let petImage: HTMLImageElement;
	let bossImage: HTMLImageElement;
	let typed = '';
	let blind = '';
	let localMode: 'typing' | 'attack' = 'typing';
	let lastMode = mode;
	let lastBossHp = hp;
	let floats: Float[] = [];
	let now = Date.now();

	const playerColor = HOUSES[house].color;
	const accent = HOUSES[house].accent;

	$: target = words[wordIndex] ?? '';
	$: lockedSeconds = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
	$: swapSeconds = Math.max(0, Math.ceil((swapReadyAt - now) / 1000));
	$: immune = now < invulnUntil;
	$: fighting = mode === 'typing' || mode === 'attack';

	$: if (mode !== lastMode) {
		lastMode = mode;
		if (mode === 'typing' || mode === 'attack') {
			localMode = mode;
			typed = '';
		}
	}

	$: if (hp < lastBossHp) {
		floats = [...floats, { text: `-${Math.round(lastBossHp - hp)}`, color: '#ffd23f', x: 236, y: 52, life: 1 }];
		lastBossHp = hp;
	} else if (hp > lastBossHp) {
		lastBossHp = hp;
	}

	function image(src: string): HTMLImageElement {
		const element = new Image();
		element.src = src;
		return element;
	}

	function text(value: string, x: number, y: number, size: number, color: string) {
		if (!ctx) return;
		ctx.save();
		ctx.font = `${size}px "Press Start 2P", ui-monospace, monospace`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#000';
		ctx.fillText(value, Math.round(x) + 1, Math.round(y) + 1);
		ctx.fillStyle = color;
		ctx.fillText(value, Math.round(x), Math.round(y));
		ctx.restore();
	}

	function bar(x: number, y: number, width: number, height: number, value: number, max: number, color: string) {
		if (!ctx) return;
		const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
		ctx.fillStyle = '#1b1420';
		ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
		ctx.fillStyle = '#2a2233';
		ctx.fillRect(x, y, width, height);
		ctx.fillStyle = color;
		ctx.fillRect(x, y, Math.round(width * ratio), height);
	}

	function draw(time: number) {
		if (!ctx) return;
		const t = time / 1000;
		ctx.clearRect(0, 0, 320, 180);
		// Backrooms staff stage: yellow wall, dark tile floor, flickering lamps.
		ctx.fillStyle = '#b8a24a';
		ctx.fillRect(0, 0, 320, 112);
		for (let x = 0; x < 320; x += 8) {
			ctx.fillStyle = '#a8923e';
			ctx.fillRect(x, 0, 1, 112);
		}
		ctx.fillStyle = '#c9b65c';
		ctx.fillRect(0, 26, 320, 1);
		for (let i = 0; i < 4; i += 1) {
			const lx = 18 + i * 80;
			const off = Math.sin(t * 17 + i * 9) > 0.985;
			ctx.fillStyle = off ? '#7d7458' : '#fff8d0';
			ctx.fillRect(lx, 3, 44, 4);
			if (!off) {
				ctx.globalAlpha = 0.12;
				ctx.fillStyle = '#fff8d0';
				ctx.fillRect(lx - 10, 7, 64, 30);
				ctx.globalAlpha = 1;
			}
		}
		ctx.fillStyle = '#6e5f2a';
		ctx.fillRect(0, 108, 320, 4);
		ctx.fillStyle = '#8f7f3e';
		ctx.fillRect(0, 112, 320, 68);
		for (let y = 116; y < 180; y += 6) {
			ctx.fillStyle = '#857538';
			ctx.fillRect(0, y, 320, 1);
		}
		ctx.fillStyle = 'rgba(70,20,110,0.22)';
		ctx.fillRect(0, 0, 320, 180);

		const bob = Math.round(Math.sin(t * 2.2));
		ctx.shadowColor = 'rgba(0,0,0,0.4)';
		ctx.shadowBlur = 4;
		if (bossImage.complete) ctx.drawImage(bossImage, 230, 46 + bob, 64, 76);
		if (petImage.complete) ctx.drawImage(petImage, 96, 126 + Math.round(Math.sin(t * 5)));
		if (playerImage.complete) {
			ctx.globalAlpha = immune && Math.floor(t * 12) % 2 ? 0.35 : 1;
			ctx.drawImage(playerImage, 58, 96 + Math.round(Math.sin(t * 4)));
			ctx.globalAlpha = 1;
		}
		ctx.shadowBlur = 0;

		floats = floats.filter((float) => float.life > 0);
		for (const float of floats) {
			text(float.text, float.x, float.y - (1 - float.life) * 18, 8, float.color);
		}

		bar(70, 10, 180, 6, hp, maxHp, '#e04050');
		ctx.fillStyle = '#ffd23f';
		ctx.fillRect(70 + Math.round(180 * 0.1), 9, 1, 8);
		text(boss.title, 160, 24, 6, '#ffffff');
		bar(16, 158, 70, 5, playerHp, 100, '#6be38a');
		bar(16, 167, 70, 4, shield, 100, '#5fd3ff');
		text('HP', 10, 160, 5, '#6be38a');
		text('SH', 10, 169, 5, '#5fd3ff');
		if (lockedSeconds > 0 && mode !== 'stunned') {
			text(`ANSWER LOCK ${lockedSeconds}s`, 300, 160, 6, '#ff6b7a');
		}
		text(swapSeconds > 0 ? `ESC ${swapSeconds}s` : 'ESC READY', 300, 170, 5, swapSeconds > 0 ? '#9a90b0' : '#5fd3ff');
		if (mode === 'attack' || localMode === 'attack') {
			text('ATTACK MODE - NO SHIELD', 160, 40, 6, '#ff6b7a');
		}
		if (mode === 'stunned') {
			text('NO-CLIPPED', 160, 72, 13, '#ff3b6b');
			text(`STUNNED ${Math.max(0, Math.ceil(((lockUntil ?? now) - now) / 1000))}s`, 160, 94, 7, '#ffffff');
		}
		if (auditionLength > 0) {
			text(`${'■'.repeat(Math.min(18, combo))}${'·'.repeat(Math.max(0, auditionLength - combo))}`, 160, 48, 9, '#ffd23f');
			if (moveLabel) text(moveLabel, 160, 64, 6, accent);
			text(`x${combo} COMBO`, 160, 76, 6, playerColor);
		}
		if (feedback) text(feedback, 160, 112, 6, /denied|lock|wrong/i.test(feedback) ? '#ff6b7a' : '#6be38a');
	}

	onMount(() => {
		ctx = canvas.getContext('2d');
		if (ctx) ctx.imageSmoothingEnabled = false;
		playerImage = image(`/sprites/player_${HOUSES[house].animal}.png`);
		petImage = image(`/sprites/pet_${HOUSES[house].animal}.png`);
		bossImage = image('/sprites/boss_staff.png');
		let raf = 0;
		let previous = 0;
		const frame = (time: number) => {
			const dt = Math.min(0.05, (time - previous) / 1000);
			previous = time;
			now = Date.now();
			for (const float of floats) float.life -= dt;
			draw(time);
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	});

	function toggleMode() {
		if (!fighting) return;
		localMode = localMode === 'typing' ? 'attack' : 'typing';
		typed = '';
		blind = '';
		onMode(localMode);
	}

	function submitWord() {
		if (!target || !fighting || localMode !== 'typing') return;
		if (typed !== target) {
			feedback = 'MISS · retype the highlighted word';
			typed = '';
			return;
		}
		onWord(typed);
		typed = '';
	}

	function submitAnswer() {
		if (!blind || !fighting || localMode !== 'attack') return;
		if (lockedSeconds > 0) return;
		onAnswer(blind);
		blind = '';
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Tab') {
			event.preventDefault();
			toggleMode();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			onSwap();
			return;
		}
		if (!fighting) return;
		if (localMode === 'typing') {
			if (event.key === 'Backspace') {
				event.preventDefault();
				typed = typed.slice(0, -1);
				return;
			}
			if (event.key === ' ' || event.key === 'Enter') {
				event.preventDefault();
				submitWord();
				return;
			}
			if (event.key.length === 1 && /^[a-z0-9]$/i.test(event.key)) {
				event.preventDefault();
				const expected = target[typed.length] ?? '';
				if (event.key.toLowerCase() === expected.toLowerCase()) typed += event.key.toLowerCase();
				else feedback = 'MISS · wrong key';
			}
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			submitAnswer();
			return;
		}
		if (event.key === 'Backspace') {
			event.preventDefault();
			blind = blind.slice(0, -1);
			return;
		}
		if (event.key.length === 1 && blind.length < 40) {
			event.preventDefault();
			blind += event.key;
			feedback = '';
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="boss-layer">
	<div class="boss-panel" role="dialog" aria-label="Boss fight">
		<div class="bar">
			<span>{boss.title} · {boss.name} · {HOUSES[house].name}</span>
			<button type="button" onclick={onLeave} aria-label="Leave boss fight">Leave</button>
		</div>

		<canvas bind:this={canvas} width="320" height="180" aria-label="Boss arena"></canvas>

		<div class="typebox" class:err={/denied|lock|miss|wrong/i.test(feedback)} class:attack={localMode === 'attack'}>
			<div class="mode">
				{#if mode === 'stunned'}
					STUNNED · rebooting…
				{:else if mode === 'audition'}
					AUDITION · watch the combo
				{:else if localMode === 'typing'}
					MONKEY TYPING · type the word then press Space
				{:else}
					ATTACK · type the answer then Enter · no shield
				{/if}
			</div>
			<div class="question">{boss.question}</div>
			{#if fighting && localMode === 'typing'}
				<div class="words">
					<span class="done">{target.slice(0, typed.length)}</span><span class="next">{target[typed.length] ?? '␣'}</span><span class="rest">{target.slice(typed.length + 1)}</span>
					<span class="up">{words.slice(wordIndex + 1, wordIndex + 7).join(' ')}</span>
				</div>
			{:else if fighting && localMode === 'attack'}
				<div class="blind">{blind ? '■ '.repeat(blind.length) : '…'}</div>
			{/if}
			<div class="hint">
				<kbd>Space</kbd> send word · <kbd>Tab</kbd> attack mode · <kbd>Enter</kbd> submit · <kbd>Esc</kbd> swap
			</div>
		</div>

		<div class="stats">
			<div><span>BOSS</span>{Math.round(hp)} / {maxHp}</div>
			<div><span>HP</span>{Math.round(playerHp)} / 100</div>
			<div><span>SHIELD</span>{Math.round(shield)} / 100</div>
			<div><span>COMBO</span>x{combo}</div>
		</div>
	</div>
</div>

<style>
	.boss-layer {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(8, 6, 12, 0.82);
		padding: clamp(0.4rem, 2vw, 1rem);
		overflow: auto;
	}
	.boss-panel {
		width: min(680px, 96vw);
		max-height: 96vh;
		overflow: auto;
		background: #1f1a2b;
		border: 2px solid #3a3150;
		color: #efe8ff;
		font-family: ui-monospace, monospace;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 6px 10px;
		background: #15111c;
		font-size: clamp(0.6rem, 2vw, 0.75rem);
		color: #c4b5fd;
	}
	button {
		background: #2a2233;
		color: #efe8ff;
		border: 1px solid #5b4d70;
		padding: 2px 8px;
		cursor: pointer;
		font-size: 0.7rem;
	}
	button:hover { border-color: #f5b301; }
	canvas {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: #000;
		image-rendering: pixelated;
	}
	.typebox {
		margin: 8px;
		border: 2px solid #3a3150;
		background: #15111c;
		padding: 10px;
		min-height: 96px;
	}
	.typebox.err { border-color: #ff5d6c; }
	.typebox.attack { border-color: #ff5d6c; border-style: dashed; }
	.mode { color: #9a90b0; font-size: 0.7rem; margin-bottom: 6px; }
	.question { font-size: clamp(0.7rem, 2.2vw, 0.85rem); margin-bottom: 8px; }
	.words { font-family: 'Press Start 2P', ui-monospace, monospace; font-size: clamp(0.7rem, 2.2vw, 1rem); line-height: 1.8; word-break: break-word; }
	.done { color: #6be38a; }
	.next { text-decoration: underline; text-decoration-thickness: 3px; text-underline-offset: 4px; }
	.rest { color: #efe8ff; }
	.up { color: #6f6780; margin-left: 12px; }
	.blind { font-family: 'Press Start 2P', ui-monospace, monospace; color: #ff5d6c; letter-spacing: 4px; min-height: 28px; }
	.hint { color: #7c748c; font-size: 0.65rem; margin-top: 8px; }
	kbd { border: 1px solid currentColor; padding: 0 4px; border-radius: 3px; }
	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 6px;
		margin: 0 8px 8px;
		font-size: 0.7rem;
	}
	.stats div { background: #15111c; border: 1px solid #3a3150; padding: 6px; }
	.stats span { display: block; color: #9a90b0; font-size: 0.6rem; }
	@media (max-width: 520px) {
		.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>

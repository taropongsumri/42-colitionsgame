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
	export let attackReadyAt = 0;
	export let attackCost = 25;
	export let shieldMax = 100;
	export let feedback = '';
	export let wordPulse = 0;
	export let attackPulse = 0;
	export let deathPulse = 0;
	export let lastChip = 0;
	export let onWord: (word: string) => void;
	export let onAnswer: (answer: string) => void;
	export let onMode: (mode: 'typing' | 'attack') => void;
	export let onSwap: () => void;
	export let onAttack: () => void;
	export let onLeave: () => void;

	type Float = { text: string; color: string; x: number; y: number; life: number };
	type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let playerImage: HTMLImageElement;
	let petImage: HTMLImageElement;
	let bossImage: HTMLImageElement;
	let arenaImage: HTMLImageElement;
	let typed = '';
	let blind = '';
	let localMode: 'typing' | 'attack' = 'typing';
	let lastMode = mode;
	let lastBossHp = hp;
	let lastWordPulse = wordPulse;
	let lastAttackPulse = attackPulse;
	let lastDeathPulse = deathPulse;
	let floats: Float[] = [];
	let particles: Particle[] = [];
	let localFeedback = '';
	let shake = 0;
	let slash = 0;
	let now = Date.now();
	let audio: AudioContext | null = null;

	const playerColor = HOUSES[house].color;
	const accent = HOUSES[house].accent;

	$: target = words[wordIndex] ?? '';
	$: lockedSeconds = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
	$: swapSeconds = Math.max(0, Math.ceil((swapReadyAt - now) / 1000));
	$: immune = now < invulnUntil;
	$: fighting = mode === 'typing' || mode === 'attack';
	$: deathSeconds = mode === 'stunned' && lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
	$: attackSeconds = Math.max(0, (attackReadyAt - now) / 1000);
	$: canAfford = shield >= attackCost;
	$: attackLabel = attackSeconds > 0
		? `ATTACK ${attackSeconds.toFixed(1)}s`
		: canAfford
			? `⚔ ATTACK · ${attackCost} SH`
			: `NEED ${attackCost} SHIELD`;
	$: shownFeedback = localFeedback || feedback;

	$: if (mode !== lastMode) {
		lastMode = mode;
		typed = '';
		blind = '';
		localFeedback = '';
		if (mode === 'typing' || mode === 'attack') localMode = mode;
	}

	$: if (hp < lastBossHp) {
		const amount = Math.round(lastBossHp - hp);
		floats = [
			...floats,
			{ text: `-${amount}`, color: '#ffd23f', x: 242, y: 52, life: 1 }
		];
		lastBossHp = hp;
	} else if (hp > lastBossHp) {
		lastBossHp = hp;
	}

	$: if (wordPulse !== lastWordPulse) {
		lastWordPulse = wordPulse;
		if (wordPulse > 0 && combo > 0) {
			localFeedback = '';
			playWordSound(combo);
			shake = Math.min(4, 1 + combo * 0.12);
			burst(238, 86, combo >= 5 ? '#ffd23f' : '#6be38a', 8 + Math.min(combo, 16));
			if (combo >= 3) {
				floats = [
					...floats,
					{
						text: combo >= 5 ? `COMBO x${combo}` : `CHAIN x${combo}`,
						color: combo >= 5 ? '#ff9f1c' : playerColor,
						x: 160,
						y: 44,
						life: 1.15
					}
				];
			}
			if (combo >= 5 && lastChip > 0) {
				floats = [...floats, { text: `CHIP -${Math.round(lastChip)}`, color: '#6be38a', x: 94, y: 116, life: 0.9 }];
			}
		}
	}

	$: if (attackPulse !== lastAttackPulse) {
		lastAttackPulse = attackPulse;
		if (attackPulse > 0) {
			localFeedback = '';
			playAttackSound();
			shake = 7;
			slash = 1;
			burst(246, 82, '#ff5d6c', 26);
			burst(246, 82, accent, 14);
		}
	}

	$: if (deathPulse !== lastDeathPulse) {
		lastDeathPulse = deathPulse;
		if (deathPulse > 0) {
			localFeedback = '';
			typed = '';
			blind = '';
			playDeathSound();
			shake = 10;
			burst(160, 92, '#ff3b6b', 34);
		}
	}

	function image(src: string): HTMLImageElement {
		const element = new Image();
		element.src = src;
		return element;
	}

	function unlockAudio() {
		if (typeof window === 'undefined') return;
		if (!audio) {
			const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AudioCtor) return;
			audio = new AudioCtor();
		}
		if (audio.state === 'suspended') void audio.resume();
	}

	function tone(frequency: number, duration: number, type: OscillatorType, volume: number, delay = 0) {
		unlockAudio();
		if (!audio) return;
		const start = audio.currentTime + delay;
		const oscillator = audio.createOscillator();
		const gain = audio.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, start);
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
		oscillator.connect(gain).connect(audio.destination);
		oscillator.start(start);
		oscillator.stop(start + duration + 0.02);
	}

	function playWordSound(currentCombo: number) {
		tone(620 + Math.min(currentCombo, 12) * 35, 0.07, 'square', 0.035);
		tone(880 + Math.min(currentCombo, 12) * 45, 0.09, 'square', 0.028, 0.055);
		if (currentCombo > 0 && currentCombo % 5 === 0) {
			tone(1320, 0.16, 'triangle', 0.05, 0.11);
			tone(1760, 0.13, 'triangle', 0.035, 0.15);
		}
	}

	function playAttackSound() {
		tone(110, 0.14, 'sawtooth', 0.055);
		tone(260, 0.1, 'square', 0.045, 0.03);
		tone(520, 0.08, 'square', 0.03, 0.06);
	}

	function playDeathSound() {
		tone(220, 0.3, 'sawtooth', 0.06);
		tone(165, 0.35, 'sawtooth', 0.05, 0.12);
		tone(110, 0.5, 'sine', 0.06, 0.26);
		tone(70, 0.7, 'sawtooth', 0.045, 0.4);
	}

	function burst(x: number, y: number, color: string, count: number) {
		for (let i = 0; i < count; i += 1) {
			const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
			const speed = 18 + Math.random() * 55;
			particles.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - 12,
				life: 0.5 + Math.random() * 0.45,
				color
			});
		}
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

	const noise = (seed: number) => {
		const value = Math.sin(seed * 127.1) * 43758.5453;
		return value - Math.floor(value);
	};

	function drawWall(t: number) {
		if (!ctx) return;
		const glow = ctx.createLinearGradient(0, 0, 0, 112);
		glow.addColorStop(0, '#b9a64f');
		glow.addColorStop(0.55, '#a49343');
		glow.addColorStop(1, '#756832');
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, 320, 112);

		// Old-prototype wall seams, now with dungeon mortar and grime.
		for (let y = 0; y < 112; y += 14) {
			const offset = (y / 14) % 2 ? 0 : 12;
			ctx.fillStyle = 'rgba(62,52,25,0.38)';
			ctx.fillRect(0, y, 320, 1);
			for (let x = -offset; x < 320; x += 24) {
				ctx.fillRect(x, y, 1, 14);
				if (noise(x + y) > 0.76) {
					ctx.fillStyle = 'rgba(40,32,18,0.22)';
					ctx.fillRect(x + 2, y + 3 + noise(x) * 6, 6, 1);
					ctx.fillStyle = 'rgba(62,52,25,0.38)';
				}
			}
		}

		ctx.fillStyle = '#c9b65c';
		ctx.fillRect(0, 26, 320, 1);
		ctx.fillStyle = 'rgba(38,30,17,0.3)';
		ctx.fillRect(0, 27, 320, 2);

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

		// Hanging chains and cobwebs.
		ctx.strokeStyle = 'rgba(28,22,34,0.75)';
		ctx.lineWidth = 1;
		for (const x of [28, 294]) {
			for (let y = 0; y < 32; y += 5) {
				ctx.beginPath();
				ctx.ellipse(x + Math.sin(t * 0.8 + y) * 1.5, y + 4, 2, 3, Math.PI / 2, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
		ctx.strokeStyle = 'rgba(220,215,235,0.18)';
		for (let i = 0; i < 7; i += 1) {
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(18 + i * 3, 2 + i * 4);
			ctx.stroke();
		}
		for (let i = 0; i < 6; i += 1) {
			ctx.beginPath();
			ctx.moveTo(320, 0);
			ctx.lineTo(302 - i * 3, 3 + i * 5);
			ctx.stroke();
		}
	}

	function drawDoorway(t: number) {
		if (!ctx) return;
		const x = 142;
		const y = 42;
		const w = 58;
		const h = 72;

		const halo = ctx.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, 52);
		halo.addColorStop(0, 'rgba(126,58,176,0.35)');
		halo.addColorStop(1, 'rgba(126,58,176,0)');
		ctx.fillStyle = halo;
		ctx.fillRect(x - 46, y - 34, w + 92, h + 66);

		ctx.fillStyle = '#302338';
		ctx.beginPath();
		ctx.moveTo(x, y + h);
		ctx.lineTo(x, y + 14);
		ctx.quadraticCurveTo(x + w / 2, y - 12, x + w, y + 14);
		ctx.lineTo(x + w, y + h);
		ctx.closePath();
		ctx.fill();

		ctx.fillStyle = '#0d0813';
		ctx.beginPath();
		ctx.moveTo(x + 5, y + h);
		ctx.lineTo(x + 5, y + 16);
		ctx.quadraticCurveTo(x + w / 2, y - 4, x + w - 5, y + 16);
		ctx.lineTo(x + w - 5, y + h);
		ctx.closePath();
		ctx.fill();

		ctx.strokeStyle = 'rgba(210,168,255,0.35)';
		ctx.lineWidth = 1;
		for (let i = 0; i < 3; i += 1) {
			const pulse = 0.5 + Math.sin(t * 2 + i) * 0.2;
			ctx.globalAlpha = pulse;
			ctx.beginPath();
			ctx.ellipse(x + w / 2, y + 32 + i * 18, 14 + i * 3, 5 + i, 0, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}

	function drawTorch(x: number, y: number, t: number, seed: number) {
		if (!ctx) return;
		const flicker = Math.sin(t * 12 + seed) + Math.sin(t * 19 + seed * 2);
		const glow = ctx.createRadialGradient(x, y, 1, x, y, 34 + flicker * 2);
		glow.addColorStop(0, 'rgba(255,174,54,0.42)');
		glow.addColorStop(1, 'rgba(255,120,20,0)');
		ctx.fillStyle = glow;
		ctx.fillRect(x - 40, y - 40, 80, 80);

		ctx.fillStyle = '#2b1d17';
		ctx.fillRect(x - 2, y, 4, 14);
		ctx.fillStyle = '#6a4c2a';
		ctx.fillRect(x - 5, y + 12, 10, 3);
		ctx.fillStyle = flicker > 0.4 ? '#ffd23f' : '#ff7b28';
		ctx.beginPath();
		ctx.moveTo(x, y - 12 - flicker * 2);
		ctx.quadraticCurveTo(x + 7, y - 2, x + 2, y + 3);
		ctx.quadraticCurveTo(x - 6, y + 2, x, y - 12 - flicker * 2);
		ctx.fill();
		ctx.fillStyle = '#fff1a8';
		ctx.fillRect(x - 1, y - 5, 2, 5);
	}

	function drawFloor(t: number) {
		if (!ctx) return;
		ctx.fillStyle = '#8f7f3e';
		ctx.fillRect(0, 112, 320, 68);
		const floor = ctx.createLinearGradient(0, 112, 0, 180);
		floor.addColorStop(0, 'rgba(255,236,150,0.12)');
		floor.addColorStop(1, 'rgba(22,10,30,0.45)');
		ctx.fillStyle = floor;
		ctx.fillRect(0, 112, 320, 68);

		for (let y = 116; y < 180; y += 6) {
			ctx.fillStyle = '#857538';
			ctx.fillRect(0, y, 320, 1);
		}
		for (let x = -20; x < 340; x += 18) {
			ctx.strokeStyle = 'rgba(58,48,24,0.35)';
			ctx.beginPath();
			ctx.moveTo(160 + (x - 160) * 0.55, 112);
			ctx.lineTo(x, 180);
			ctx.stroke();
		}
		ctx.fillStyle = '#6e5f2a';
		ctx.fillRect(0, 108, 320, 4);

		// Puddles and drifting dust catch the torch light.
		for (let i = 0; i < 5; i += 1) {
			const px = 18 + noise(i * 31) * 280;
			const py = 132 + noise(i * 17) * 38;
			ctx.fillStyle = `rgba(126,58,176,${0.06 + noise(i) * 0.09})`;
			ctx.beginPath();
			ctx.ellipse(px, py, 10 + noise(i + 9) * 18, 2 + noise(i + 4) * 2, 0, 0, Math.PI * 2);
			ctx.fill();
		}
		for (let i = 0; i < 18; i += 1) {
			const dx = (noise(i * 11) * 320 + t * (4 + noise(i) * 8)) % 320;
			const dy = 118 + noise(i * 7) * 58 + Math.sin(t + i) * 2;
			ctx.fillStyle = `rgba(255,240,190,${0.08 + noise(i * 3) * 0.18})`;
			ctx.fillRect(dx, dy, 1, 1);
		}
	}

	function drawCrates() {
		if (!ctx) return;
		ctx.fillStyle = '#3a2a1d';
		ctx.fillRect(8, 90, 26, 20);
		ctx.fillStyle = '#5c4228';
		ctx.fillRect(10, 88, 24, 20);
		ctx.strokeStyle = '#2e2017';
		ctx.strokeRect(10.5, 88.5, 23, 19);
		ctx.beginPath();
		ctx.moveTo(10, 89);
		ctx.lineTo(33, 107);
		ctx.moveTo(33, 89);
		ctx.lineTo(10, 107);
		ctx.stroke();

		ctx.fillStyle = '#24202d';
		ctx.fillRect(270, 96, 34, 14);
		ctx.fillStyle = '#393248';
		ctx.fillRect(272, 94, 30, 14);
		ctx.fillStyle = '#5fd3ff';
		ctx.fillRect(276, 98, 14, 2);
		ctx.fillStyle = '#f5b301';
		ctx.fillRect(276, 103, 8, 2);
	}

	function draw(time: number) {
		if (!ctx) return;
		const t = time / 1000;
		ctx.clearRect(0, 0, 320, 180);

		ctx.save();
		if (shake > 0.05) {
			ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
		}

		drawWall(t);
		drawDoorway(t);
		drawTorch(72, 58, t, 1);
		drawTorch(250, 58, t, 5);
		drawCrates();
		drawFloor(t);

		if (arenaImage.complete && arenaImage.naturalWidth > 0) {
			ctx.globalAlpha = 0.13;
			ctx.drawImage(arenaImage, 0, 0, 320, 180);
			ctx.globalAlpha = 1;
		}

		const bob = Math.round(Math.sin(t * 2.2));
		ctx.shadowColor = 'rgba(0,0,0,0.5)';
		ctx.shadowBlur = 5;
		if (bossImage.complete && bossImage.naturalWidth > 0) ctx.drawImage(bossImage, 228, 46 + bob, 64, 76);
		if (petImage.complete) ctx.drawImage(petImage, 96, 126 + Math.round(Math.sin(t * 5)));
		if (playerImage.complete) {
			ctx.globalAlpha = immune && Math.floor(t * 12) % 2 ? 0.35 : 1;
			ctx.drawImage(playerImage, 58, 96 + Math.round(Math.sin(t * 4)));
			ctx.globalAlpha = 1;
		}
		ctx.shadowBlur = 0;

		if (slash > 0) {
			ctx.save();
			ctx.globalAlpha = slash;
			ctx.strokeStyle = '#fff4b8';
			ctx.lineWidth = 3;
			ctx.shadowColor = accent;
			ctx.shadowBlur = 8;
			ctx.beginPath();
			ctx.arc(250, 82, 26 + (1 - slash) * 14, -1.5, 1.1);
			ctx.stroke();
			ctx.strokeStyle = '#ff5d6c';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(250, 82, 34 + (1 - slash) * 12, -1.2, 0.9);
			ctx.stroke();
			ctx.restore();
		}

		for (const particle of particles) {
			ctx.globalAlpha = Math.max(0, particle.life);
			ctx.fillStyle = particle.color;
			ctx.fillRect(Math.round(particle.x), Math.round(particle.y), 2, 2);
		}
		ctx.globalAlpha = 1;

		floats = floats.filter((float) => float.life > 0);
		for (const float of floats) {
			text(float.text, float.x, float.y - (1 - float.life) * 18, 8, float.color);
		}

		ctx.restore();

		// HUD stays fixed while the arena shakes.
		ctx.fillStyle = 'rgba(8,6,12,0.5)';
		ctx.fillRect(0, 0, 320, 34);
		bar(70, 10, 180, 6, hp, maxHp, '#e04050');
		ctx.fillStyle = '#ffd23f';
		ctx.fillRect(70 + Math.round(180 * 0.1), 9, 1, 8);
		text(boss.title, 160, 24, 6, '#ffffff');
		bar(16, 158, 70, 5, playerHp, 100, '#6be38a');
		bar(16, 167, 70, 4, shield, shieldMax, '#5fd3ff');
		text('HP', 10, 160, 5, '#6be38a');
		text('SH', 10, 169, 5, '#5fd3ff');
		if (lockedSeconds > 0 && mode !== 'stunned') {
			text(`ANSWER LOCK ${lockedSeconds}s`, 300, 160, 6, '#ff6b7a');
		}
		text(swapSeconds > 0 ? `ESC ${swapSeconds}s` : 'ESC READY', 300, 170, 5, swapSeconds > 0 ? '#9a90b0' : '#5fd3ff');
		if (mode === 'attack' || localMode === 'attack') {
			text('AUDITION MODE', 160, 40, 6, '#ff6b7a');
		}
		if (mode === 'stunned') {
			text('YOU DIED', 160, 72, 13, '#ff3b6b');
			text(`EXITING IN ${deathSeconds}s`, 160, 94, 7, '#ffffff');
		}
		if (auditionLength > 0) {
			text(`${'■'.repeat(Math.min(18, combo))}${'·'.repeat(Math.max(0, auditionLength - combo))}`, 160, 48, 9, '#ffd23f');
			if (moveLabel) text(moveLabel, 160, 64, 6, accent);
			text(`x${combo} COMBO`, 160, 76, 6, playerColor);
		}
		if (shownFeedback) text(shownFeedback, 160, 112, 6, /denied|lock|wrong|miss|need|cooldown/i.test(shownFeedback) ? '#ff6b7a' : '#6be38a');
	}

	onMount(() => {
		ctx = canvas.getContext('2d');
		if (ctx) ctx.imageSmoothingEnabled = false;
		playerImage = image(`/sprites/player_${HOUSES[house].animal}.png`);
		petImage = image(`/sprites/pet_${HOUSES[house].animal}.png`);
		bossImage = image(boss.id === 'janitor' ? '/sprites/boss_staff.png' : `/sprites/boss_${boss.id}.png`);
		arenaImage = image('/sprites/arena.png');
		let raf = 0;
		let previous = 0;
		const frame = (time: number) => {
			const dt = Math.min(0.05, (time - previous) / 1000);
			previous = time;
			now = Date.now();
			shake = Math.max(0, shake - dt * 18);
			slash = Math.max(0, slash - dt * 2.6);
			for (const particle of particles) {
				particle.x += particle.vx * dt;
				particle.y += particle.vy * dt;
				particle.vy += 95 * dt;
				particle.life -= dt;
			}
			particles = particles.filter((particle) => particle.life > 0);
			for (const float of floats) float.life -= dt;
			draw(time);
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		return () => {
			cancelAnimationFrame(raf);
			if (audio) void audio.close();
		};
	});

	function toggleMode() {
		if (!fighting) return;
		localMode = localMode === 'typing' ? 'attack' : 'typing';
		typed = '';
		blind = '';
		localFeedback = '';
		onMode(localMode);
	}

	function attack() {
		if (!fighting) return;
		unlockAudio();
		onAttack();
	}

	function submitWord() {
		if (!target || !fighting || localMode !== 'typing') return;
		if (typed !== target) {
			localFeedback = 'MISS · retype the highlighted word';
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
		// A dead player waits for the server-side exit; no attack/swap/typing input
		// should sneak through during the stunned or audition phases.
		if (!fighting) {
			if (['Tab', 'ArrowRight', 'Escape', ' ', 'Enter'].includes(event.key)) event.preventDefault();
			return;
		}
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
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			attack();
			return;
		}
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
				else localFeedback = 'MISS · wrong key';
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
			localFeedback = '';
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="boss-layer">
	<div class="boss-panel" role="dialog" aria-label="Boss fight">
		<div class="bar">
			<span class="title">{boss.title} · {boss.name} · {HOUSES[house].name}</span>
			<div class="bar-actions">
				<button type="button" onclick={attack} class:ready={attackSeconds <= 0 && canAfford} title="Spend shield for a server-validated hit">
					{attackLabel}
				</button>
				<button type="button" onclick={onLeave} aria-label="Leave boss fight">Leave</button>
			</div>
		</div>

		<div class="stage">
			<canvas bind:this={canvas} width="320" height="180" aria-label="Boss arena"></canvas>
			{#if combo >= 3}
				<div class="combo-burst" class:hot={combo >= 5} style:left={`${Math.min(88, 12 + combo * 3)}%`}>
					<span>COMBO</span><strong>x{combo}</strong>
				</div>
			{/if}
			{#if mode === 'stunned'}
				<div class="death-overlay" role="alert">
					<div class="death-title">YOU DIED</div>
					<div class="death-count">EXITING DUNGEON IN {deathSeconds}s</div>
					<div class="death-note">Penalty applied · returning to the floor</div>
				</div>
			{/if}
		</div>

		<div class="typebox" class:err={/denied|lock|miss|wrong|need|cooldown/i.test(shownFeedback)} class:attack={localMode === 'attack'}>
			<div class="mode">
				{#if mode === 'stunned'}
					YOU DIED · exiting in {deathSeconds}s…
				{:else if mode === 'audition'}
					AUDITION · watch the combo
				{:else if localMode === 'typing'}
					MONKEY TYPING · type the word then Space
				{:else}
					AUDITION · type the hidden answer then Enter
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
			{#if shownFeedback}<div class="feedback">{shownFeedback}</div>{/if}
			<div class="hint">
				<kbd>Space</kbd> word · <kbd>Tab</kbd> audition · <kbd>Enter</kbd> answer · <kbd>→</kbd> attack · <kbd>Esc</kbd> swap
			</div>
		</div>

		<div class="stats">
			<div><span>BOSS</span>{Math.round(hp)} / {maxHp}</div>
			<div><span>HP</span>{Math.round(playerHp)} / 100</div>
			<div><span>SHIELD</span>{Math.round(shield)} / {shieldMax}</div>
			<div class:combo-hot={combo >= 5}><span>COMBO</span>x{combo}</div>
		</div>
	</div>
</div>

<style>
	.boss-layer {
		position: absolute;
		inset: 0;
		z-index: 20;
		background: #06040a;
		overflow: hidden;
	}
	.boss-panel {
		position: relative;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto auto;
		width: 100vw;
		height: 100vh;
		height: 100dvh;
		background: radial-gradient(circle at 50% 35%, #241a31 0, #0b0710 70%);
		color: #efe8ff;
		font-family: ui-monospace, monospace;
		overflow: hidden;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: clamp(5px, 1vh, 10px) clamp(8px, 2vw, 20px);
		background: rgba(13, 9, 20, 0.96);
		border-bottom: 2px solid #3a3150;
		font-size: clamp(0.6rem, 1.8vw, 0.82rem);
		color: #c4b5fd;
	}
	.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bar-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
	button {
		background: #2a2233;
		color: #efe8ff;
		border: 1px solid #5b4d70;
		padding: clamp(4px, 0.8vh, 8px) clamp(8px, 1.5vw, 14px);
		cursor: pointer;
		font: inherit;
		font-size: clamp(0.62rem, 1.7vw, 0.78rem);
		white-space: nowrap;
	}
	button:hover { border-color: #f5b301; }
	button.ready {
		border-color: #ff5d6c;
		color: #fff4b8;
		box-shadow: 0 0 12px rgba(255, 93, 108, 0.35), inset 0 0 8px rgba(255, 93, 108, 0.18);
	}
	.stage { position: relative; min-height: 0; overflow: hidden; background: #0b0710; }
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		image-rendering: pixelated;
	}
	.combo-burst {
		position: absolute;
		top: 38%;
		transform: translate(-50%, -50%) rotate(-8deg);
		display: flex;
		flex-direction: column;
		align-items: center;
		color: #6be38a;
		text-shadow: 0 0 14px currentColor;
		pointer-events: none;
		animation: burst 0.7s ease-out both;
	}
	.combo-burst.hot { color: #ffd23f; }
	.combo-burst span { font-size: clamp(0.6rem, 2vw, 0.9rem); letter-spacing: 0.2em; }
	.combo-burst strong { font-size: clamp(1.6rem, 7vw, 4.5rem); line-height: 1; }
	@keyframes burst {
		0% { opacity: 0; scale: 0.4; }
		35% { opacity: 1; scale: 1.18; }
		100% { opacity: 0; scale: 1.4; translate: 0 -24px; }
	}
	.death-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		gap: 0.35rem;
		text-align: center;
		background: radial-gradient(circle, rgba(84, 8, 28, 0.82), rgba(6, 4, 10, 0.92));
		pointer-events: none;
	}
	.death-title { color: #ff3b6b; font-size: clamp(1.4rem, 7vw, 4rem); letter-spacing: 0.12em; text-shadow: 0 0 20px currentColor; }
	.death-count { color: #ffd23f; font-size: clamp(0.7rem, 2.6vw, 1.2rem); }
	.death-note { color: #bdb4c2; font-size: clamp(0.6rem, 1.8vw, 0.8rem); }
	.typebox {
		margin: clamp(4px, 1vh, 10px) clamp(6px, 1.5vw, 16px) 0;
		border: 2px solid #3a3150;
		background: rgba(13, 9, 20, 0.96);
		padding: clamp(6px, 1.2vh, 12px) clamp(8px, 1.8vw, 16px);
		max-height: 30vh;
		overflow: auto;
	}
	.typebox.err { border-color: #ff5d6c; }
	.typebox.attack { border-color: #ff5d6c; border-style: dashed; }
	.mode { color: #9a90b0; font-size: clamp(0.6rem, 1.6vw, 0.72rem); margin-bottom: 4px; }
	.question { font-size: clamp(0.7rem, 2.2vw, 0.9rem); margin-bottom: 6px; }
	.words { font-family: 'Press Start 2P', ui-monospace, monospace; font-size: clamp(0.7rem, 2.2vw, 1rem); line-height: 1.8; word-break: break-word; }
	.done { color: #6be38a; }
	.next { text-decoration: underline; text-decoration-thickness: 3px; text-underline-offset: 4px; }
	.rest { color: #efe8ff; }
	.up { color: #6f6780; margin-left: 12px; }
	.blind { font-family: 'Press Start 2P', ui-monospace, monospace; color: #ff5d6c; letter-spacing: 4px; min-height: 28px; }
	.feedback { color: #ffd23f; font-size: clamp(0.62rem, 1.8vw, 0.76rem); margin-top: 4px; }
	.hint { color: #7c748c; font-size: clamp(0.58rem, 1.6vw, 0.68rem); margin-top: 6px; }
	kbd { border: 1px solid currentColor; padding: 0 4px; border-radius: 3px; }
	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: clamp(4px, 1vw, 10px);
		margin: clamp(4px, 1vh, 10px) clamp(6px, 1.5vw, 16px) clamp(5px, 1vh, 10px);
		font-size: clamp(0.62rem, 1.8vw, 0.76rem);
	}
	.stats div { background: rgba(13, 9, 20, 0.96); border: 1px solid #3a3150; padding: clamp(4px, 0.9vh, 8px); }
	.stats span { display: block; color: #9a90b0; font-size: 0.6rem; }
	.stats .combo-hot { border-color: #ffd23f; color: #ffd23f; box-shadow: 0 0 14px rgba(255, 210, 63, 0.3); }
	@media (max-width: 560px) {
		.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.typebox { max-height: 34vh; }
		.hint { line-height: 1.6; }
	}
	@media (max-height: 520px) {
		.typebox { max-height: 38vh; }
		.question { margin-bottom: 2px; }
		.hint { display: none; }
		.stats { padding-bottom: 2px; }
	}
</style>

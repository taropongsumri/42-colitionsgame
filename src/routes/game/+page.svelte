<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { advanceBossWords } from '$lib/client/bossWords';
	import { createGame, type BossOption, type Ghost, type Hud } from '$lib/client/game';
	import BossFight from '$lib/components/game/BossFight.svelte';
	import Terminal from '$lib/components/game/Terminal.svelte';
	import { realTableFor } from '$lib/shared/dungeon';
	import { HOUSES, HOUSE_IDS, type HouseId } from '$lib/shared/types';

	type Session = { token: string; code: string; house: HouseId | null; accepted: boolean };
	type HouseState = {
		id: HouseId;
		room: number;
		hp: number;
		score: number;
		solvedRooms: number[];
		answerLockUntil: number | null;
		status: string;
		boss?: { active: boolean; hp: number; maxHp: number };
	};
	type Scoreboard = {
		rows: { house: HouseId; score: number; room: number; hp: number }[];
		timeLeftMs: number;
		paused: boolean;
		announcement: string | null;
	};
	type BossView = {
		boss: BossOption;
		words: string[];
		wordIndex: number;
		hp: number;
		maxHp: number;
		playerHp: number;
		shield: number;
		mode: 'idle' | 'typing' | 'attack' | 'audition' | 'stunned';
		combo: number;
		auditionLength: number;
		move: string;
		lockUntil: number | null;
		swapReadyAt: number;
		invulnUntil: number;
		attackReadyAt: number;
		attackCost: number;
		shieldMax: number;
	};

	let canvas: HTMLCanvasElement;
	let session: Session | null = null;
	let socket: WebSocket | undefined;
	let game: ReturnType<typeof createGame> | undefined;

	let house: HouseId = 'h1';
	let socketStatus = 'connecting…';
	let state: HouseState | null = null;
	let rooms: { number: number; status: string }[] = [];
	let shadows: { house: HouseId; room: number; connected: boolean }[] = [];
	let scoreboard: Scoreboard | null = null;
	let terminal: { prompt: string; hint: string | null } | null = null;
	let hud: Hud = { floor: 1, prompt: null };
	let feedback = '';
	let terminalRoomId: string | null = null;
	let terminalSolved = false;
	let notice = '';
	let lockUntil: number | null = null;
	let bossOptions: BossOption[] = [];
	let boss: BossView | null = null;
	let bossFeedback = '';
	let wordPulse = 0;
	let attackPulse = 0;
	let deathPulse = 0;
	let lastChip = 0;
	let bossAudio: HTMLAudioElement | null = null;
	let now = Date.now();

	$: lockRemaining = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
	$: timeLeft = scoreboard ? formatTime(scoreboard.timeLeftMs) : '--:--';

	function formatTime(ms: number): string {
		const total = Math.max(0, Math.floor(ms / 1000));
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	function send(message: unknown) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
	}

	function closeTerminal() {
		terminal = null;
		terminalRoomId = null;
		terminalSolved = false;
		feedback = '';
		game?.setPaused(false);
	}

	function submit(value: string) {
		const roomId = terminalRoomId ?? realTableFor(house, state?.room ?? 1);
		if (!value.trim() || lockRemaining > 0 || terminalSolved) return;
		send({ type: 'answer', roomId, answer: value });
	}

	function startBossAudio() {
		if (!bossAudio) {
			bossAudio = new Audio('/audio/soundtrack_pplam.mp3');
			bossAudio.loop = true;
			bossAudio.volume = 0.45;
		}
		// Autoplay is unlocked by the key/click that opened the lift dialog.
		void bossAudio.play().catch(() => undefined);
	}

	function stopBossAudio() {
		if (!bossAudio) return;
		bossAudio.pause();
		bossAudio.currentTime = 0;
	}

	function enterBoss(bossId: string) {
		if (state && rooms.length && state.solvedRooms.length < rooms.length) return;
		game?.setPaused(true);
		bossFeedback = '';
		wordPulse = 0;
		attackPulse = 0;
		deathPulse = 0;
		lastChip = 0;
		startBossAudio();
		send({ type: 'enterBoss', bossId });
	}

	function closeBoss() {
		send({ type: 'leaveBoss' });
		boss = null;
		bossFeedback = '';
		stopBossAudio();
		game?.setBossActive(false);
		game?.setPaused(false);
	}

	onDestroy(stopBossAudio);

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 250);
		let disposed = false;

		const start = async () => {
			const response = await fetch('/api/session');
			const data = (await response.json()) as { session: Session | null };
			if (!data.session?.house || !data.session.accepted) {
				await goto('/');
				return;
			}
			if (disposed) return;

			session = data.session;
			house = data.session.house;
			game = createGame({
				canvas,
				house,
				onInteract: (tableId) => send({ type: 'interact', tableId }),
				onHud: (next) => (hud = next),
				onMove: (position) => send({ type: 'move', ...position }),
				onEnterBoss: enterBoss
			});

			const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			const host = import.meta.env.DEV ? `${location.hostname}:3000` : location.host;
			socket = new WebSocket(`${protocol}//${host}/ws/play`);

			socket.onopen = () => (socketStatus = 'open');
			socket.onerror = () => (socketStatus = 'error');
			socket.onclose = (event) => (socketStatus = `closed (${event.code})`);
			socket.onmessage = (event) => {
				const message = JSON.parse(String(event.data)) as {
					type: string;
					[key: string]: unknown;
				};
				switch (message.type) {
					case 'welcome':
						socketStatus = 'accepted';
						break;
					case 'state': {
						state = message.state as HouseState;
						lockUntil = state.answerLockUntil;
						game?.setRoom(state.room);
						game?.setSolved(state.solvedRooms.map((room) => realTableFor(house, room)));
						game?.setBossReady(rooms.length > 0 && state.solvedRooms.length >= rooms.length);
						game?.setBossActive(Boolean(state.boss?.active));
						break;
					}
					case 'dungeon':
						rooms = message.rooms as typeof rooms;
						game?.setBossReady(state ? state.solvedRooms.length >= rooms.length : false);
						break;
					case 'boss.list':
						bossOptions = message.bosses as BossOption[];
						game?.setBossOptions(bossOptions);
						break;
					case 'shadows':
						shadows = message.houses as typeof shadows;
						break;
					case 'ghosts':
						game?.setGhosts(message.houses as Ghost[]);
						break;
					case 'scoreboard':
						scoreboard = message as unknown as Scoreboard;
						break;
					case 'question':
						terminal = {
							prompt: String(message.prompt),
							hint: message.hint ? String(message.hint) : null
						};
						terminalRoomId = realTableFor(house, Number(message.room ?? state?.room ?? 1));
						terminalSolved = false;
						feedback = '';
						game?.setPaused(true);
						break;
					case 'answerResult': {
						const result = message as unknown as {
							correct: boolean;
							lockUntil: number | null;
						};
						lockUntil = result.lockUntil;
						if (result.correct) {
							terminalSolved = true;
							feedback = 'ACCESS GRANTED';
						} else {
							const seconds = result.lockUntil
								? Math.max(1, Math.ceil((result.lockUntil - Date.now()) / 1000))
								: 0;
							feedback = `ACCESS DENIED · the plug sparks! Locked for ${seconds}s`;
						}
						break;
					}
					case 'boss.start': {
						const view = message as unknown as BossView & {
							attackAt: number;
						};
						boss = {
							...view,
							combo: view.combo ?? 0,
							auditionLength: view.auditionLength ?? 0,
							move: view.move ?? '',
							shieldMax: view.shieldMax ?? 100
						};
						bossFeedback = '';
						wordPulse = 0;
						attackPulse = 0;
						deathPulse = 0;
						startBossAudio();
						game?.setBossActive(true);
						game?.setPaused(true);
						break;
					}
					case 'boss.word': {
						const result = message as unknown as {
							correct: boolean;
							nextWord: string;
							shield: number;
							bossHp: number;
							combo: number;
							chip: number;
						};
						if (boss) {
							if (result.correct) {
								const advanced = advanceBossWords(boss.words, boss.wordIndex, result.nextWord);
								boss.words = advanced.words;
								boss.wordIndex = advanced.wordIndex;
							}
							boss.shield = result.shield;
							boss.hp = result.bossHp;
							boss.combo = result.combo;
						}
						if (result.correct) {
							wordPulse += 1;
							lastChip = result.chip;
							bossFeedback = result.combo >= 5
								? `COMBO x${result.combo}! · -${Math.round(result.chip)}`
								: `WORD OK · -${Math.round(result.chip)} HP`;
						} else {
							bossFeedback = 'MISS · combo reset';
						}
						break;
					}
					case 'boss.playerAttack': {
						const hit = message as unknown as {
							damage: number;
							shield: number;
							bossHp: number;
							combo: number;
							readyAt: number;
							reason?: string;
							move: string;
						};
						if (boss) {
							boss.shield = hit.shield;
							boss.hp = hit.bossHp;
							boss.combo = hit.combo;
							boss.attackReadyAt = hit.readyAt;
							boss.move = hit.move;
						}
						if (hit.reason === 'NO_SHIELD') bossFeedback = 'NO SHIELD · type words to charge';
						else if (hit.reason === 'COOLDOWN') bossFeedback = 'ATTACK COOLING DOWN';
						else if (hit.reason === 'BOSS_BUSY') bossFeedback = 'BOSS IS BUSY';
						else {
							attackPulse += 1;
							bossFeedback = `${hit.move}! · -${Math.round(hit.damage)} HP`;
						}
						break;
					}
					case 'boss.attack': {
						const attack = message as unknown as {
							immune: boolean;
							absorbed: number;
							damage: number;
							hp: number;
							shield: number;
							move: string;
						};
						if (boss) {
							boss.playerHp = attack.hp;
							boss.shield = attack.shield;
						}
						bossFeedback = attack.immune
							? 'IMMUNE'
							: attack.absorbed > 0
								? `${attack.move} · shield absorbed ${Math.round(attack.absorbed)}`
								: `${attack.move} · -${Math.round(attack.damage)} HP`;
						break;
					}
					case 'boss.audition':
						if (boss) {
							boss.mode = 'audition';
							boss.combo = 0;
							boss.auditionLength = Number(message.length);
						}
						bossFeedback = 'ACCESS GRANTED · AUDITION';
						break;
					case 'boss.answerResult': {
						const result = message as unknown as { message: string };
						bossFeedback = result.message;
						break;
					}
					case 'boss.hit': {
						const hit = message as unknown as {
							move: string;
							damage: number;
							bossHp: number;
							combo: number;
							finisher?: boolean;
						};
						if (boss) {
							boss.hp = hit.bossHp;
							boss.combo = hit.combo;
							boss.move = hit.finisher ? 'FINISH!' : hit.move;
						}
						bossFeedback = `${hit.move} · -${Math.round(hit.damage)}`;
						break;
					}
					case 'boss.stun': {
						const stun = message as unknown as { until: number; seconds: number; penalty: number };
						if (boss) {
							boss.mode = 'stunned';
							boss.playerHp = 0;
							boss.shield = 0;
							boss.combo = 0;
							boss.auditionLength = 0;
							boss.lockUntil = stun.until;
						}
						deathPulse += 1;
						bossFeedback = `YOU DIED · -${stun.penalty} points · exiting in ${stun.seconds}s`;
						stopBossAudio();
						break;
					}
					case 'boss.ready': {
						const ready = message as unknown as { playerHp: number; shield: number };
						if (boss) {
							boss.mode = 'typing';
							boss.playerHp = ready.playerHp;
							boss.shield = ready.shield;
						}
						bossFeedback = 'BACK ONLINE';
						break;
					}
					case 'boss.swap': {
						const swap = message as unknown as { readyAt: number; invulnUntil: number };
						if (boss) {
							boss.swapReadyAt = swap.readyAt;
							boss.invulnUntil = swap.invulnUntil;
						}
						bossFeedback = 'SWAP!';
						break;
					}
					case 'boss.end': {
						const end = message as unknown as { won: boolean; score: number; reason?: string };
						notice = end.won
							? `BOSS DEFEATED · ${end.score} points`
							: end.reason === 'knockout'
								? 'KNOCKED OUT · returned to the floor'
								: 'Boss fight left';
						setTimeout(() => (notice = ''), 5000);
						boss = null;
						bossFeedback = '';
						stopBossAudio();
						game?.setBossActive(false);
						game?.setPaused(false);
						break;
					}
					case 'boss.reset':
						boss = null;
						bossFeedback = 'Boss reset · connection lost';
						stopBossAudio();
						game?.setBossActive(false);
						game?.setPaused(false);
						break;
					case 'notice':
						notice = String(message.text);
						setTimeout(() => (notice = ''), 5000);
						break;
					case 'error':
						feedback = String(message.message);
						break;
				}
			};
		};

		void start();
		return () => {
			disposed = true;
			clearInterval(timer);
			socket?.close();
			stopBossAudio();
			game?.destroy();
		};
	});
</script>

<svelte:head>
	<title>Game · Coalition Backrooms</title>
</svelte:head>

<div class="game">
	<canvas bind:this={canvas} aria-label="Coalition Backrooms game world"></canvas>

	<div class="hud top-left">
		<div class="brand">COALITION BACKROOMS</div>
		<div class="house" style:color={HOUSES[house].color}>
			{HOUSES[house].name} <span>· machine {session?.code ?? '····'}</span>
		</div>
		<div class="stats">
			<span>F{hud.floor}</span>
			<span>Room {state?.room ?? 1}</span>
			<span>HP {state?.hp ?? 100}</span>
			<span class="score">{state?.score ?? 0} pts</span>
			<span class="clock">{timeLeft}</span>
		</div>
		<div class="players">
			{#each HOUSE_IDS as id}
				<span style:color={HOUSES[id].color}>
					{HOUSES[id].name.slice(0, 3)} {shadows.find((item) => item.house === id)?.room ?? 1}
				</span>
			{/each}
		</div>
		<div class="links"><a href="/scoreboard">Board</a> · <a href="/">Leave</a></div>
	</div>

	<div class="rooms">
		{#each rooms as room}
			<span class:open={room.status === 'open'} class:solved={room.status === 'solved'}>
				{room.number}
			</span>
		{/each}
	</div>

	{#if hud.prompt && !terminal}
		<div class="prompt">{hud.prompt}</div>
	{/if}

	{#if notice}<div class="toast">{notice}</div>{/if}

	{#if !state}
		<div class="overlay">
			<div class="panel">
				<h2>Loading the backrooms…</h2>
				<p>Connecting to machine {session?.code ?? '····'}.</p>
			</div>
		</div>
	{/if}

	{#if terminal && terminalRoomId}
		<Terminal
			roomId={terminalRoomId}
			prompt={terminal.prompt}
			hint={terminal.hint}
			{lockRemaining}
			{feedback}
			solved={terminalSolved}
			onClose={closeTerminal}
			onSubmit={submit}
		/>
	{/if}

	{#if boss && boss.boss}
		<BossFight
			{house}
			boss={boss.boss}
			words={boss.words}
			wordIndex={boss.wordIndex}
			hp={boss.hp}
			maxHp={boss.maxHp}
			playerHp={boss.playerHp}
			shield={boss.shield}
			mode={boss.mode}
			combo={boss.combo}
			auditionLength={boss.auditionLength}
			moveLabel={boss.move}
			lockUntil={boss.lockUntil}
			swapReadyAt={boss.swapReadyAt}
			invulnUntil={boss.invulnUntil}
			attackReadyAt={boss.attackReadyAt}
			attackCost={boss.attackCost}
			shieldMax={boss.shieldMax}
			feedback={bossFeedback}
			wordPulse={wordPulse}
			attackPulse={attackPulse}
			deathPulse={deathPulse}
			lastChip={lastChip}
			onWord={(word) => send({ type: 'typing', word })}
			onAnswer={(answer) => send({ type: 'auditionSubmit', answer })}
			onMode={(mode) => send({ type: 'bossMode', mode })}
			onSwap={() => send({ type: 'bossSwap' })}
			onAttack={() => send({ type: 'bossAttack' })}
			onLeave={closeBoss}
		/>
	{/if}
</div>

<style>
	:global(html), :global(body) {
		margin: 0;
		padding: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #0b080e;
	}
	:global(body) {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: #f4f0f5;
	}
	.game { position: fixed; inset: 0; }
	canvas {
		display: block;
		width: 100vw;
		height: 100vh;
		image-rendering: pixelated;
	}
	.hud {
		position: absolute;
		background: rgba(10, 8, 14, 0.78);
		border: 1px solid rgba(245, 179, 1, 0.3);
		padding: 0.6rem 0.8rem;
		font-size: 0.72rem;
		line-height: 1.5;
		pointer-events: none;
		text-shadow: 0 1px 2px #000;
	}
	.top-left {
		top: max(0.75rem, env(safe-area-inset-top));
		left: max(0.75rem, env(safe-area-inset-left));
		max-width: min(20rem, calc(50vw - 1.1rem));
	}
	.brand { color: #f5b301; letter-spacing: 0.16em; font-size: 0.6rem; }
	.house { font-size: 0.9rem; font-weight: 700; margin-top: 0.2rem; }
	.house span { color: #9f95a6; font-size: 0.7rem; font-weight: 400; }
	.stats { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.25rem; }
	.stats .score { color: #6ee7a8; }
	.stats .clock { color: #ffd166; font-weight: 700; }
	.players { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-top: 0.2rem; font-size: 0.65rem; }
	.links { margin-top: 0.35rem; pointer-events: auto; }
	a { color: #c4b5fd; }
	.rooms {
		position: absolute;
		bottom: max(0.75rem, env(safe-area-inset-bottom));
		left: max(0.75rem, env(safe-area-inset-left));
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		max-width: calc(100vw - 1.5rem);
	}
	.rooms span {
		display: grid;
		place-content: center;
		min-width: 1.4rem;
		height: 1.4rem;
		border: 1px solid #4a3d52;
		background: rgba(10, 8, 14, 0.75);
		color: #77707d;
		font-size: 0.65rem;
	}
	.rooms .open { color: #f5b301; border-color: #f5b301; }
	.rooms .solved { color: #6ee7a8; border-color: #6ee7a8; }
	.prompt {
		position: absolute;
		bottom: calc(3.5rem + env(safe-area-inset-bottom));
		left: 50%;
		transform: translateX(-50%);
		background: rgba(10, 8, 14, 0.85);
		border: 1px solid #f5b301;
		padding: 0.45rem 1rem;
		font-size: clamp(0.65rem, 2.2vw, 0.75rem);
		text-align: center;
		max-width: calc(100vw - 1.5rem);
	}
	.toast {
		position: absolute;
		top: calc(6rem + env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		background: #f5b301;
		color: #151019;
		padding: 0.5rem 1rem;
		font-weight: 700;
		font-size: clamp(0.65rem, 2.2vw, 0.75rem);
		text-align: center;
		max-width: calc(100vw - 1.5rem);
	}
	.overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		background: rgba(8, 6, 11, 0.82);
		padding: 1rem;
	}
	.panel {
		background: #1a1420;
		border: 1px solid #6d5a78;
		border-radius: 10px;
		padding: 2rem;
		max-width: 38rem;
		text-align: center;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}
	.panel h2 { margin: 0 0 1rem; font-size: clamp(1rem, 4vw, 1.25rem); }
	.panel p { color: #bdb4c2; line-height: 1.5; }

	@media (max-width: 640px) {
		.hud {
			font-size: 0.62rem;
			padding: 0.45rem 0.55rem;
			border-radius: 4px;
		}
		.top-left { max-width: min(72vw, 18rem); }
		.brand { letter-spacing: 0.08em; }
		.house { font-size: 0.78rem; }
		.house span { font-size: 0.6rem; }
		.stats { gap: 0.35rem 0.6rem; }
		.players { gap: 0.45rem; font-size: 0.58rem; }
		.rooms span { min-width: 1.25rem; height: 1.25rem; font-size: 0.58rem; }
		.panel { padding: 1.4rem; }
	}

	@media (max-width: 420px) {
		.top-left { max-width: 78vw; }
		.players { display: none; }
		.stats { flex-direction: column; gap: 0.15rem; }
		.rooms { gap: 0.18rem; }
		.rooms span { min-width: 1.15rem; height: 1.15rem; }
	}

	@media (max-height: 520px) {
		.top-left .brand,
		.top-left .players { display: none; }
		.prompt { bottom: calc(2.25rem + env(safe-area-inset-bottom)); }
		.toast { top: calc(4.5rem + env(safe-area-inset-top)); }
	}
</style>

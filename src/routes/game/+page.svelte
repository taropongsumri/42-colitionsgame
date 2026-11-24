<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { createGame, type Ghost, type Hud } from '$lib/client/game';
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
	};
	type Scoreboard = {
		rows: { house: HouseId; score: number; room: number; hp: number }[];
		timeLeftMs: number;
		paused: boolean;
		announcement: string | null;
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
	let answer = '';
	let feedback = '';
	let notice = '';
	let lockUntil: number | null = null;
	let now = Date.now();
	let zoom = 1;

	$: lockRemaining = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
	$: timeLeft = scoreboard ? formatTime(scoreboard.timeLeftMs) : '--:--';
	$: zoomPercent = zoom === 0.8 ? 80 : 100;

	function formatTime(ms: number): string {
		const total = Math.max(0, Math.floor(ms / 1000));
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	function send(message: unknown) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
	}

	function setZoom(value: number) {
		zoom = value;
		game?.setZoom(value);
	}

	function closeTerminal() {
		terminal = null;
		feedback = '';
		game?.setPaused(false);
	}

	function submit() {
		if (!answer.trim() || lockRemaining > 0) return;
		send({ type: 'answer', roomId: realTableFor(house, state?.room ?? 1), answer });
		answer = '';
	}

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
				onMove: (position) => send({ type: 'move', ...position })
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
						break;
					}
					case 'dungeon':
						rooms = message.rooms as typeof rooms;
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
						answer = '';
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
							terminal = null;
							feedback = 'Correct!';
							game?.setPaused(false);
						} else {
							feedback = 'Wrong answer — terminal locked.';
						}
						break;
					}
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
	</div>

	<div class="hud top-right">
		<div class="zoom">
			<button type="button" class:active={zoom === 1} onclick={() => setZoom(1)}>100%</button>
			<button type="button" class:active={zoom === 0.8} onclick={() => setZoom(0.8)}>80%</button>
			<span class="zoom-label">zoom {zoomPercent}%</span>
		</div>
		<div class="links"><a href="/scoreboard">Board</a> · <a href="/">Leave</a></div>
		<div class="socket">WS {socketStatus}</div>
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

	{#if terminal}
		<div class="overlay">
			<div class="panel terminal-panel">
				<p class="tag">TERMINAL · ROOM {state?.room}</p>
				<h2>{terminal.prompt}</h2>
				{#if terminal.hint}<p class="hint">Hint: {terminal.hint}</p>{/if}
				{#if lockRemaining > 0}<p class="locked">Retry in {lockRemaining}s</p>{/if}
				<form
					onsubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<input bind:value={answer} placeholder="type your answer" disabled={lockRemaining > 0} />
					<button type="submit" disabled={lockRemaining > 0}>Send</button>
				</form>
				{#if feedback}<p class="feedback">{feedback}</p>{/if}
				<button type="button" class="close" onclick={closeTerminal}>Close terminal</button>
			</div>
		</div>
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
	.top-left { top: 0.75rem; left: 0.75rem; }
	.top-right { top: 0.75rem; right: 0.75rem; text-align: right; pointer-events: auto; }
	.brand { color: #f5b301; letter-spacing: 0.16em; font-size: 0.6rem; }
	.house { font-size: 0.9rem; font-weight: 700; margin-top: 0.2rem; }
	.house span { color: #9f95a6; font-size: 0.7rem; font-weight: 400; }
	.stats { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.25rem; }
	.stats .score { color: #6ee7a8; }
	.stats .clock { color: #ffd166; font-weight: 700; }
	.players { display: flex; gap: 0.7rem; margin-top: 0.2rem; font-size: 0.65rem; }
	.zoom { display: flex; align-items: center; gap: 0.25rem; justify-content: flex-end; }
	.zoom button {
		background: #241d29;
		color: #bdb4c2;
		border: 1px solid #55485d;
		font: inherit;
		padding: 0.2rem 0.45rem;
		cursor: pointer;
	}
	.zoom button.active { background: #f5b301; color: #151019; border-color: #f5b301; font-weight: 700; }
	.zoom-label { color: #8b8290; margin-left: 0.25rem; }
	.links { margin-top: 0.35rem; }
	a { color: #c4b5fd; }
	.socket { color: #6f6776; font-size: 0.6rem; }
	.rooms { position: absolute; bottom: 0.75rem; left: 0.75rem; display: flex; gap: 0.25rem; }
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
		bottom: 3.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(10, 8, 14, 0.85);
		border: 1px solid #f5b301;
		padding: 0.45rem 1rem;
		font-size: 0.75rem;
		white-space: nowrap;
	}
	.toast {
		position: absolute;
		top: 6rem;
		left: 50%;
		transform: translateX(-50%);
		background: #f5b301;
		color: #151019;
		padding: 0.5rem 1rem;
		font-weight: 700;
		font-size: 0.75rem;
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
	.panel h2 { margin: 0 0 1rem; font-size: 1.25rem; }
	.panel p { color: #bdb4c2; line-height: 1.5; }
	.tag { color: #f5b301 !important; font-size: 0.65rem; letter-spacing: 0.2em; margin: 0 0 0.5rem !important; }
	.hint { color: #c4b5fd !important; }
	.locked { color: #fb7185 !important; font-weight: 700; }
	.feedback { color: #ffd166 !important; }
	form { display: flex; gap: 0.5rem; margin: 1.25rem 0 0.5rem; }
	input {
		flex: 1;
		background: #100c15;
		color: white;
		border: 1px solid #f5b301;
		padding: 0.55rem 0.7rem;
		font: inherit;
	}
	form button, .close {
		background: #f5b301;
		color: #151019;
		border: 0;
		padding: 0.55rem 1rem;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
	.close { margin-top: 0.8rem; background: #3a3140; color: white; font-weight: 400; }
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { HOUSES, HOUSE_IDS, type HouseId } from '$lib/shared/types';
	import { createGame, type Shadow } from '$lib/client/game';

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

	let session: Session | null = null;
	let socket: WebSocket | undefined;
	let game: ReturnType<typeof createGame> | undefined;
	let canvas: HTMLCanvasElement;

	let socketStatus = 'connecting…';
	let house: HouseId | null = null;
	let state: HouseState | null = null;
	let rooms: { number: number; status: string }[] = [];
	let shadows: Shadow[] = [];
	let scoreboard: Scoreboard | null = null;
	let terminal: { prompt: string; hint: string | null } | null = null;
	let answer = '';
	let lockUntil: number | null = null;
	let feedback = '';
	let now = Date.now();
	let notice = '';

	$: lockRemaining = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
	$: timeLeft = scoreboard ? formatTime(scoreboard.timeLeftMs) : '--:--';

	function formatTime(ms: number): string {
		const total = Math.floor(ms / 1000);
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	function send(message: unknown) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
	}

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 250);

		const start = async () => {
			const response = await fetch('/api/session', { method: 'POST' });
			const data = (await response.json()) as { session: Session };
			session = data.session;
			house = session.house;

			if (house) {
				game = createGame({
					canvas,
					house,
					onInteract: (tableId) => send({ type: 'interact', tableId })
				});
			}

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
					case 'state':
						state = message.state as HouseState;
						lockUntil = state.answerLockUntil;
						game?.setRoom(state.room);
						break;
					case 'dungeon':
						rooms = message.rooms as typeof rooms;
						break;
					case 'shadows':
						shadows = message.houses as Shadow[];
						game?.setShadows(shadows);
						break;
					case 'scoreboard':
						scoreboard = message as unknown as Scoreboard;
						break;
					case 'question':
						terminal = {
							prompt: String(message.prompt),
							hint: message.hint ? String(message.hint) : null
						};
						feedback = '';
						answer = '';
						break;
					case 'answerResult': {
						const result = message as unknown as { correct: boolean; lockUntil: number | null };
						lockUntil = result.lockUntil;
						if (result.correct) {
							terminal = null;
							feedback = 'Correct!';
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
			clearInterval(timer);
			socket?.close();
			game?.destroy();
		};
	});

	function submit() {
		if (!answer.trim() || lockRemaining > 0) return;
		send({ type: 'answer', roomId: `r${state?.room ?? 1}`, answer });
		answer = '';
	}
</script>

<svelte:head><title>Coalition Backrooms</title></svelte:head>

<div class="layout">
	<header>
		<h1>Coalition Backrooms</h1>
		<nav><a href="/scoreboard">Scoreboard</a> · <a href="/admin">Admin</a></nav>
	</header>

	{#if notice}<div class="toast">{notice}</div>{/if}

	<div class="stage">
		<canvas bind:this={canvas} aria-label="Game room"></canvas>
		{#if !house}
			<div class="overlay">
				<h2>Machine {session?.code ?? '····'}</h2>
				<p>Waiting for admin to assign a house…</p>
			</div>
		{/if}
		{#if terminal && lockRemaining === 0}
			<div class="overlay terminal">
				<h2>Terminal — Room {state?.room}</h2>
				<p>{terminal.prompt}</p>
				{#if terminal.hint}<p class="hint">Hint: {terminal.hint}</p>{/if}
				<form onsubmit={(event) => { event.preventDefault(); submit(); }}>
					<input bind:value={answer} placeholder="type answer" disabled={lockRemaining > 0} />
					<button type="submit">Send</button>
				</form>
				<button class="close" onclick={() => (terminal = null)}>Close</button>
			</div>
		{/if}
	</div>

	<aside>
		<section>
			<h2>House</h2>
			{#if house}
				<p><strong style:color={HOUSES[house].color}>{HOUSES[house].name}</strong></p>
			{:else}
				<p>not assigned</p>
			{/if}
			<p>WS: {socketStatus}</p>
		</section>

		<section>
			<h2>Progress</h2>
			<div class="rooms">
				{#each rooms as room}
					<span class:open={room.status === 'open'} class:solved={room.status === 'solved'}>
						{room.number}
					</span>
				{/each}
			</div>
			<p>Room {state?.room ?? 1} · HP {state?.hp ?? 100} · Score {state?.score ?? 0}</p>
			{#if lockRemaining > 0}<p class="locked">Terminal locked: {lockRemaining}s</p>{/if}
			{#if feedback}<p>{feedback}</p>{/if}
		</section>

		<section>
			<h2>Time left</h2>
			<p class="clock">{timeLeft}</p>
		</section>

		<section>
			<h2>Players</h2>
			{#each HOUSE_IDS as id}
				<p style:color={HOUSES[id].color}>
					{HOUSES[id].name}: room {shadows.find((s) => s.house === id)?.room ?? 1}
				</p>
			{/each}
		</section>
	</aside>
</div>

<style>
	:global(body) {
		font-family: ui-monospace, monospace;
		background: #151019;
		color: #f4f0f5;
		margin: 0;
	}
	.layout { display: grid; grid-template-columns: 1fr 16rem; gap: 1rem; padding: 1rem; max-width: 80rem; margin: auto; }
	header { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: baseline; }
	h1 { color: #f5b301; margin: 0; }
	a { color: #c4b5fd; }
	.stage { position: relative; background: #222; border: 2px solid #3a3140; align-self: start; }
	canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
	.overlay { position: absolute; inset: 0; background: rgba(10, 8, 12, 0.86); display: grid; place-content: center; text-align: center; padding: 1rem; }
	.terminal { background: rgba(10, 8, 12, 0.94); }
	.terminal input { background: #241d29; color: white; border: 1px solid #f5b301; padding: 0.4rem; }
	.terminal button, .close { background: #f5b301; border: 0; padding: 0.4rem 0.8rem; cursor: pointer; }
	.close { margin-top: 0.8rem; background: #3a3140; color: white; }
	.hint { color: #c4b5fd; }
	aside section { border: 1px solid #3a3140; padding: 0.7rem; margin-bottom: 0.7rem; }
	aside h2 { font-size: 0.8rem; color: #f5b301; margin: 0 0 0.4rem; }
	aside p { margin: 0.2rem 0; }
	.rooms { display: flex; flex-wrap: wrap; gap: 0.25rem; }
	.rooms span { border: 1px solid #555; padding: 0.1rem 0.35rem; color: #777; }
	.rooms .open { color: #f5b301; border-color: #f5b301; }
	.rooms .solved { color: #6ee7a8; border-color: #6ee7a8; }
	.locked { color: #fb7185; }
	.clock { font-size: 1.6rem; }
	.toast { position: fixed; top: 1rem; left: 50%; transform: translateX(-50%); background: #f5b301; color: #151019; padding: 0.5rem 1rem; z-index: 10; }
	@media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
</style>

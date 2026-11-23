<script lang="ts">
	import { onMount } from 'svelte';
	import { HOUSES, HOUSE_IDS, type HouseId } from '$lib/shared/types';

	type Session = {
		token: string;
		code: string;
		house: HouseId | null;
		accepted: boolean;
		connected: boolean;
	};

	let session: Session | null = null;
	let socketStatus = 'connecting…';
	let houseState: Record<string, unknown> | null = null;
	let events: string[] = [];

	onMount(() => {
		let socket: WebSocket | undefined;

		const start = async () => {
			const response = await fetch('/api/session', { method: 'POST' });
			const data = (await response.json()) as { session: Session };
			session = data.session;

			const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			const host = import.meta.env.DEV ? `${location.hostname}:3000` : location.host;
			socket = new WebSocket(`${protocol}//${host}/ws/play`);

			socket.onopen = () => (socketStatus = 'open');
			socket.onerror = () => (socketStatus = 'error');
			socket.onclose = (event) => (socketStatus = `closed (${event.code})`);
			socket.onmessage = (event) => {
				const message = JSON.parse(String(event.data)) as { type: string; [key: string]: unknown };
				events = [`${message.type}: ${JSON.stringify(message)}`, ...events].slice(0, 8);
				if (message.type === 'state') houseState = message.state as Record<string, unknown>;
			};
		};

		void start();
		return () => socket?.close();
	});
</script>

<h1>Coalition Backrooms</h1>
<p><a href="/admin">Admin</a></p>

{#if session}
	<section class="panel">
		<h2>This machine</h2>
		<p class="code">{session.code}</p>
		<p>
			House:
			<strong>
				{session.house ? HOUSES[session.house].name : 'not assigned'}
			</strong>
		</p>
		<p>Status: {session.accepted ? 'accepted' : 'waiting for admin'}</p>
		<p>WebSocket: {socketStatus}</p>
	</section>
{:else}
	<p>Registering machine…</p>
{/if}

{#if houseState}
	<section class="panel">
		<h2>Saved state</h2>
		<pre>{JSON.stringify(houseState, null, 2)}</pre>
	</section>
{/if}

<section class="panel">
	<h2>Events</h2>
	<pre>{events.join('\n') || '(none yet)'}</pre>
</section>

<p class="houses">
	{#each HOUSE_IDS as id}
		<span style:color={HOUSES[id].color}>{HOUSES[id].name}</span>
	{/each}
</p>

<style>
	:global(body) {
		font-family: ui-monospace, monospace;
		background: #151019;
		color: #f4f0f5;
		margin: 0 auto;
		max-width: 48rem;
		padding: 2rem;
	}
	h1 { color: #f5b301; }
	.panel {
		border: 1px solid #3a3140;
		border-radius: 8px;
		padding: 1rem;
		margin: 1rem 0;
	}
	.code { font-size: 2.5rem; letter-spacing: 0.3rem; margin: 0.5rem 0; color: #f5b301; }
	pre { white-space: pre-wrap; word-break: break-word; }
	.houses { display: flex; gap: 1rem; }
	a { color: #8b5cf6; }
</style>

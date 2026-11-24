<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { createSpectator, type SpectatorOrb } from '$lib/client/spectator';
	import type { SpectatorSkin } from '$lib/shared/types';

	let canvas: HTMLCanvasElement;
	let key = '';
	let joined = false;
	let error = '';
	let status = 'Enter the spectator key to fly through the backrooms.';
	let floor = 1;
	let visible = true;
	let orbsHidden = false;
	let ownId = '';
	let skin: SpectatorSkin = 'fire';
	let socket: WebSocket | undefined;
	let spectator: ReturnType<typeof createSpectator> | undefined;

	function send(message: unknown) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
	}

	function join() {
		error = '';
		if (!key) {
			error = 'A spectator key is required.';
			return;
		}
		socket?.close();
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		socket = new WebSocket(`${protocol}//${location.host}/ws/spectate?key=${encodeURIComponent(key)}`);
		status = 'Connecting…';
		socket.onopen = () => { status = 'Connected · read-only orb'; };
		socket.onclose = () => {
			joined = false;
			status = 'Disconnected. Rejoin with the spectator key.';
		};
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data)) as {
				type: string;
				[key: string]: unknown;
			};
			switch (message.type) {
				case 'spectator.welcome':
					ownId = String(message.id);
					visible = Boolean(message.visible);
					orbsHidden = Boolean(message.orbsHidden);
					skin = message.skin === 'water' ? 'water' : 'fire';
					spectator?.setSkin(skin);
					spectator?.setOrbsHidden(orbsHidden);
					joined = true;
					status = `Orb ${ownId} · read-only`;
					break;
				case 'orbs':
					spectator?.setOrbs(message.orbs as SpectatorOrb[]);
					break;
				case 'orbsHidden':
					orbsHidden = Boolean(message.hidden);
					spectator?.setOrbsHidden(orbsHidden);
					break;
				case 'error':
					error = String(message.message);
					break;
			}
		};
	}

	function toggleVisible() {
		visible = !visible;
		send({ type: 'spectatorVisible', visible });
	}

	function setSkin(next: SpectatorSkin) {
		skin = next;
		spectator?.setSkin(next);
		send({ type: 'spectatorSkin', skin: next });
	}

	function mapFloorLabel(value: number): string {
		return String(value).padStart(2, '0');
	}

	onMount(() => {
		spectator = createSpectator({
			canvas,
			onMove: (position) => {
				floor = position.floor;
				send({ type: 'spectatorMove', ...position });
			},
			onSkin: (next) => setSkin(next)
		});
	});

	onDestroy(() => {
		socket?.close();
		spectator?.destroy();
	});
</script>

<svelte:head><title>Spectator · Coalition Backrooms</title></svelte:head>

<canvas bind:this={canvas} aria-label="Spectator view"></canvas>

<div class="hud">
	<strong>SPECTATOR</strong> · {status}
	<span>F{mapFloorLabel(floor)}</span>
	<span class:hidden={orbsHidden}>{orbsHidden ? 'other orbs hidden by admin' : 'orbs visible'}</span>
	<span class="skin">skin: {skin}</span>
	<a href="/">Back</a> · <a href="/scoreboard">Board</a>
</div>

{#if !joined}
	<div class="gate">
		<h1>Spectator mode</h1>
		<p>Enter the staff spectator key. Orbs pass through walls, ignore fog, and cannot interact with the game.</p>
		<input type="password" bind:value={key} placeholder="spectator key" onkeydown={(e) => { if (e.key === 'Enter') join(); }} />
		<button onclick={join}>Join as spectator</button>
		{#if error}<p class="error">{error}</p>{/if}
	</div>
{/if}

{#if joined}
	<div class="controls">
		<button onclick={toggleVisible}>{visible ? 'Hide my orb' : 'Show my orb'}</button>
		<button class:active={skin === 'fire'} onclick={() => setSkin('fire')}>🔥 Fire</button>
		<button class:active={skin === 'water'} onclick={() => setSkin('water')}>💧 Water</button>
		<span><kbd>WASD</kbd> fly · <kbd>0-5</kbd> floor · <kbd>B</kbd> lift · <kbd>Z/X</kbd> skin</span>
	</div>
{/if}

<style>
	:global(body) { margin: 0; background: #151019; overflow: hidden; }
	canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
	.hud, .controls {
		position: fixed;
		left: 1rem;
		right: 1rem;
		z-index: 2;
		font-family: ui-monospace, monospace;
		font-size: 0.78rem;
		color: #f4f0f5;
	}
	.hud { top: 1rem; display: flex; gap: 0.8rem; flex-wrap: wrap; }
	.hud strong { color: #7ef9ff; }
	.hud .skin { color: #ffb347; }
	.hud .hidden { color: #ff5d6c; }
	.hud a { color: #8b5cf6; }
	.controls { bottom: 1rem; display: flex; gap: 0.8rem; align-items: center; }
	button, input { background: #241d29; color: #f4f0f5; border: 1px solid #3a3140; padding: 0.35rem; font-family: inherit; }
	button.active { border-color: #ffb347; color: #ffd166; box-shadow: 0 0 10px rgba(255, 179, 71, 0.35); }
	kbd { border: 1px solid #5b4d70; padding: 0 4px; }
	.gate {
		position: fixed;
		inset: 0;
		display: grid;
		place-content: center;
		gap: 0.8rem;
		text-align: center;
		background: rgba(21, 16, 25, 0.88);
		color: #f4f0f5;
		font-family: ui-monospace, monospace;
		padding: 1rem;
	}
	.gate h1 { color: #7ef9ff; margin: 0; }
	.gate p { max-width: 34rem; color: #c6bdcd; }
	.gate input, .gate button { min-width: 16rem; }
	.error { color: #ff5d6c; }
</style>

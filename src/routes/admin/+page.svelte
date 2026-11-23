<script lang="ts">
	import { onMount } from 'svelte';
	import { HOUSE_IDS, type HouseId } from '$lib/shared/types';

	type Machine = {
		code: string;
		houseId: HouseId | null;
		accepted: boolean;
		connected: boolean;
		lastSeen: number | null;
	};
	type House = { id: HouseId; room: number; hp: number; score: number; connected: boolean };

	let password = '';
	let machines: Machine[] = [];
	let houses: House[] = [];
	let message = '';
	let moveFrom = '';
	let moveTo = '';
	let configText = '';

	const headers = () => ({ 'x-admin-password': password, 'content-type': 'application/json' });

	async function load() {
		if (!password) return;
		const response = await fetch('/api/admin/machines', { headers: headers() });
		if (!response.ok) {
			message = 'Access denied';
			return;
		}
		const data = (await response.json()) as { machines: Machine[]; houses: House[] };
		machines = data.machines;
		houses = data.houses;
		message = '';
	}

	async function loadConfig() {
		const response = await fetch('/api/admin/config', { headers: headers() });
		if (!response.ok) return;
		const data = (await response.json()) as { config: unknown };
		configText = JSON.stringify(data.config, null, 2);
	}

	async function action(code: string, method: string, body?: unknown) {
		const response = await fetch(`/api/admin/machines/${code}`, {
			method,
			headers: headers(),
			body: body ? JSON.stringify(body) : undefined
		});
		const data = (await response.json()) as { error?: string };
		message = data.error ?? `${method} ${code} ok`;
		await load();
	}

	async function assign(code: string, event: Event) {
		const house = (event.currentTarget as HTMLSelectElement).value;
		await action(code, 'PATCH', { house });
	}

	async function move() {
		const response = await fetch('/api/admin/move', {
			method: 'POST',
			headers: headers(),
			body: JSON.stringify({ from: moveFrom, to: moveTo })
		});
		const data = (await response.json()) as { error?: string };
		message = data.error ?? 'session moved';
		await load();
	}

	async function saveConfig() {
		const response = await fetch('/api/admin/config', {
			method: 'PUT',
			headers: headers(),
			body: JSON.stringify({ config: JSON.parse(configText) })
		});
		message = response.ok ? 'config saved' : 'config rejected';
	}

	async function resetConfig() {
		await fetch('/api/admin/config/reset', { method: 'POST', headers: headers() });
		await loadConfig();
		message = 'config reset to defaults';
	}

	onMount(() => {
		void load();
		void loadConfig();
	});
</script>

<h1>Admin — Lobby</h1>
<p><a href="/">Back to game</a></p>

<label>
	Password
	<input type="password" bind:value={password} onchange={() => { void load(); void loadConfig(); }} />
</label>

{#if message}<p class="message">{message}</p>{/if}

<table>
	<thead>
		<tr><th>Code</th><th>House</th><th>State</th><th>Assign</th><th>Actions</th></tr>
	</thead>
	<tbody>
		{#each machines as machine (machine.code)}
			<tr>
				<td class="code">{machine.code}</td>
				<td>{machine.houseId ?? '—'}</td>
				<td>{machine.accepted ? (machine.connected ? 'playing' : 'accepted (offline)') : 'pending'}</td>
				<td>
					<select value={machine.houseId ?? ''} onchange={(e) => assign(machine.code, e)}>
						<option value="">—</option>
						{#each HOUSE_IDS as id}<option value={id}>{id}</option>{/each}
					</select>
				</td>
				<td>
					<button onclick={() => action(machine.code, 'POST')}>Accept</button>
					<button onclick={() => action(machine.code, 'DELETE')}>Kick</button>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<section>
	<h2>Move session</h2>
	<select bind:value={moveFrom}>
		<option value="">from…</option>
		{#each machines as m}<option value={m.code}>{m.code}</option>{/each}
	</select>
	<select bind:value={moveTo}>
		<option value="">to…</option>
		{#each machines as m}<option value={m.code}>{m.code}</option>{/each}
	</select>
	<button onclick={move}>Move</button>
</section>

<section>
	<h2>Houses</h2>
	<pre>{JSON.stringify(houses, null, 2)}</pre>
</section>

<section>
	<h2>Live config</h2>
	<textarea bind:value={configText} rows="12"></textarea>
	<div>
		<button onclick={saveConfig}>Save</button>
		<button onclick={resetConfig}>Reset to defaults</button>
	</div>
</section>

<style>
	:global(body) {
		font-family: ui-monospace, monospace;
		background: #151019;
		color: #f4f0f5;
		margin: 0 auto;
		max-width: 60rem;
		padding: 2rem;
	}
	h1 { color: #f5b301; }
	table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
	th, td { border: 1px solid #3a3140; padding: 0.4rem; text-align: left; }
	.code { font-size: 1.2rem; color: #f5b301; }
	button, select, input, textarea {
		background: #241d29;
		color: #f4f0f5;
		border: 1px solid #3a3140;
		padding: 0.3rem;
	}
	textarea, pre { width: 100%; box-sizing: border-box; }
	section { margin: 1.5rem 0; }
	.message { color: #f5b301; }
	a { color: #8b5cf6; }
</style>

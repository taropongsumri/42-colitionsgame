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
	type BossEntry = {
		raw: Record<string, unknown>;
		id: string;
		name: string;
		title: string;
		question: string;
		answers: string;
		words: string;
		hp: number;
		playerHp: number;
		shieldPerWord: number;
		shieldMax: number;
		chipPerWord: number;
		attackEverySeconds: number;
		attackDamage: number;
		wrongHealPercent: number;
		counterDamage: number;
		bpm: number;
		stunSeconds: number;
		stunPenalty: number;
	};

	let password = '';
	let machines: Machine[] = [];
	let houses: House[] = [];
	let message = '';
	let moveFrom = '';
	let moveTo = '';
	let configText = '';
	let scoreHouse: HouseId = 'h1';
	let unlockHouse: HouseId = 'h1';
	let scoreAmount = 0;
	let scoreReason = '';
	let minutes = 5;
	let announcement = '';
	let bosses: BossEntry[] = [];

	const headers = () => ({ 'x-admin-password': password, 'content-type': 'application/json' });

	function rawBoss(entry: BossEntry) {
		const number = (key: keyof BossEntry, fallback: number) => Number(entry[key] || fallback);
		return {
			...entry.raw,
			id: entry.id.trim() || `boss-${Date.now().toString(36)}`,
			name: entry.name || 'New boss',
			title: entry.title || 'BOSS',
			question: entry.question || 'Type the access phrase.',
			answers: entry.answers.split(',').map((value) => value.trim()).filter(Boolean),
			wordPool: entry.words.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean),
			hp: number('hp', 1000),
			playerHp: number('playerHp', 100),
			shieldPerWord: number('shieldPerWord', 10),
			shieldMax: number('shieldMax', 100),
			chipPerWord: number('chipPerWord', 5),
			attackEverySeconds: number('attackEverySeconds', 3),
			attackDamage: number('attackDamage', 15),
			wrongHealPercent: number('wrongHealPercent', 30),
			counterDamage: number('counterDamage', 30),
			bpm: number('bpm', 140),
			stunSeconds: number('stunSeconds', 4),
			stunPenalty: number('stunPenalty', 50)
		};
	}

	function bossToEntry(value: Record<string, unknown>): BossEntry {
		return {
			raw: value,
			id: String(value.id ?? ''),
			name: String(value.name ?? ''),
			title: String(value.title ?? ''),
			question: String(value.question ?? ''),
			answers: (value.answers as string[] | undefined)?.join(', ') ?? '',
			words: (value.wordPool as string[] | undefined)?.join(' ') ?? '',
			hp: Number(value.hp ?? 1000),
			playerHp: Number(value.playerHp ?? 100),
			shieldPerWord: Number(value.shieldPerWord ?? 10),
			shieldMax: Number(value.shieldMax ?? 100),
			chipPerWord: Number(value.chipPerWord ?? 5),
			attackEverySeconds: Number(value.attackEverySeconds ?? 3),
			attackDamage: Number(value.attackDamage ?? 15),
			wrongHealPercent: Number(value.wrongHealPercent ?? 30),
			counterDamage: Number(value.counterDamage ?? 30),
			bpm: Number(value.bpm ?? 140),
			stunSeconds: Number(value.stunSeconds ?? 4),
			stunPenalty: Number(value.stunPenalty ?? 50)
		};
	}

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
		const data = (await response.json()) as { config: Record<string, unknown> };
		configText = JSON.stringify(data.config, null, 2);
		const bossConfig = (data.config.boss ?? {}) as Record<string, unknown>;
		bosses = ((bossConfig.bosses ?? []) as Record<string, unknown>[]).map(bossToEntry);
	}

	async function saveBosses() {
		const config = JSON.parse(configText) as Record<string, unknown>;
		const bossConfig = (config.boss ?? {}) as Record<string, unknown>;
		config.boss = { ...bossConfig, bosses: bosses.map(rawBoss) };
		configText = JSON.stringify(config, null, 2);
		const response = await fetch('/api/admin/config', {
			method: 'PUT',
			headers: headers(),
			body: JSON.stringify({ config })
		});
		message = response.ok ? `${bosses.length} bosses saved` : 'boss config rejected';
		await loadConfig();
	}

	function addBoss() {
		bosses = [
			...bosses,
			bossToEntry({
				id: `boss-${Date.now().toString(36)}`,
				name: 'New boss',
				title: 'NEW BOSS',
				question: 'Type the access phrase.',
				answers: ['answer'],
				wordPool: ['code', 'door', 'room', 'light']
			})
		];
	}

	function removeBoss(index: number) {
		bosses = bosses.filter((_, position) => position !== index);
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

	async function control(action: string, payload: Record<string, unknown> = {}) {
		const response = await fetch('/api/admin/control', {
			method: 'POST',
			headers: headers(),
			body: JSON.stringify({ action, ...payload })
		});
		const data = (await response.json()) as { error?: string };
		message = data.error ?? `${action} ok`;
		await load();
	}

	onMount(() => {
		void load();
		void loadConfig();
	});
</script>

<h1>Admin — Lobby</h1>
<p><a href="/">Back to game</a> · <a href="/scoreboard">Scoreboard</a></p>

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
	<h2>Game control</h2>
	<div class="controls">
		<button onclick={() => control('start')}>Start game</button>
		<button onclick={() => control('pause')}>Pause</button>
		<button onclick={() => control('resume')}>Resume</button>
		<button onclick={() => control('end')}>End game</button>
		<label>Time <input type="number" bind:value={minutes} min="-120" max="120" /></label>
		<button onclick={() => control('addTime', { minutes })}>Add minutes</button>
	</div>
	<div class="controls">
		<select bind:value={scoreHouse}>
			{#each HOUSE_IDS as id}<option value={id}>{id}</option>{/each}
		</select>
		<input type="number" bind:value={scoreAmount} placeholder="± points" />
		<input bind:value={scoreReason} placeholder="reason" />
		<button onclick={() => control('adjustScore', { house: scoreHouse, amount: scoreAmount, reason: scoreReason })}>Adjust score</button>
	</div>
	<div class="controls">
		<select bind:value={unlockHouse}>
			{#each HOUSE_IDS as id}<option value={id}>{id}</option>{/each}
		</select>
		<button onclick={() => control('forceUnlock', { house: unlockHouse })}>Force unlock room</button>
		<button onclick={() => control('forceBoss', { house: unlockHouse })}>Unlock boss lift</button>
	</div>
	<div class="controls">
		<input bind:value={announcement} placeholder="message to all players" />
		<button onclick={() => control('announce', { text: announcement })}>Announce</button>
	</div>
</section>

<section>
	<h2>Bosses</h2>
	<p>
		Add as many bosses as you want. Players choose one with <kbd>Q</kbd> at the lift and fight with
		<kbd>E</kbd>. Answers are server-only and are never sent to the game client.
	</p>
	{#each bosses as boss, index}
		<article class="boss">
			<header>
				<strong>{boss.name || boss.id || `Boss ${index + 1}`}</strong>
				<button onclick={() => removeBoss(index)}>Remove</button>
			</header>
			<div class="fields">
				<label>ID<input bind:value={boss.id} /></label>
				<label>Name<input bind:value={boss.name} /></label>
				<label>Title<input bind:value={boss.title} /></label>
				<label>Question<input bind:value={boss.question} /></label>
				<label class="wide">Answers (comma separated, secret)<input bind:value={boss.answers} /></label>
				<label class="wide">Typing words<input bind:value={boss.words} /></label>
				<label>HP<input type="number" bind:value={boss.hp} /></label>
				<label>Player HP<input type="number" bind:value={boss.playerHp} /></label>
				<label>Shield / word<input type="number" bind:value={boss.shieldPerWord} /></label>
				<label>Shield max<input type="number" bind:value={boss.shieldMax} /></label>
				<label>Chip / word<input type="number" bind:value={boss.chipPerWord} /></label>
				<label>Attack every (s)<input type="number" step="0.1" bind:value={boss.attackEverySeconds} /></label>
				<label>Attack damage<input type="number" bind:value={boss.attackDamage} /></label>
				<label>Wrong heal (%)<input type="number" bind:value={boss.wrongHealPercent} /></label>
				<label>Counter damage<input type="number" bind:value={boss.counterDamage} /></label>
				<label>Combo BPM<input type="number" bind:value={boss.bpm} /></label>
				<label>Death exit (s)<input type="number" bind:value={boss.stunSeconds} /></label>
				<label>Stun penalty<input type="number" bind:value={boss.stunPenalty} /></label>
			</div>
		</article>
	{/each}
	<div class="controls">
		<button onclick={addBoss}>Add boss</button>
		<button onclick={saveBosses}>Save bosses</button>
	</div>
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
	.controls { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; margin: 0.4rem 0; }
	.boss { border: 1px solid #3a3140; padding: 0.6rem; margin: 0.6rem 0; background: #1b1521; }
	.boss header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
	.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
	.fields .wide { grid-column: 1 / -1; }
	.fields label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.75rem; color: #9f95a6; }
	.fields input { width: 100%; }
	kbd { border: 1px solid #5b4d70; padding: 0 4px; }
	.message { color: #f5b301; }
	a { color: #8b5cf6; }
</style>

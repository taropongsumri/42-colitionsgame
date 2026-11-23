<script lang="ts">
	import { onMount } from 'svelte';
	import { HOUSES, HOUSE_IDS, type HouseId } from '$lib/shared/types';

	type Row = { house: HouseId; score: number; room: number; hp: number; solved: number };
	type Data = {
		rows: Row[];
		timeLeftMs: number;
		paused: boolean;
		finished: boolean;
		announcement: string | null;
	};

	let data: Data | null = null;
	let now = Date.now();

	function format(ms: number): string {
		const total = Math.max(0, Math.floor(ms / 1000));
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	async function load() {
		const response = await fetch('/api/scoreboard');
		data = (await response.json()) as Data;
	}

	onMount(() => {
		void load();
		const poll = setInterval(() => void load(), 2000);
		const tick = setInterval(() => (now = Date.now()), 500);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	$: sorted = data ? [...data.rows].sort((a, b) => b.score - a.score) : [];
</script>

<svelte:head><title>Scoreboard — Coalition Backrooms</title></svelte:head>

<h1>Scoreboard</h1>
<p><a href="/">Back to game</a></p>

<p class="clock">{data ? format(data.timeLeftMs) : '--:--'}</p>
{#if data?.paused}<p class="status">PAUSED</p>{/if}
{#if data?.finished}<p class="status">GAME OVER</p>{/if}
{#if data?.announcement}<p class="announce">{data.announcement}</p>{/if}

<table>
	<thead><tr><th>House</th><th>Score</th><th>Room</th><th>HP</th></tr></thead>
	<tbody>
		{#each sorted as row, index (row.house)}
			<tr>
				<td style:color={HOUSES[row.house].color}>{index + 1}. {HOUSES[row.house].name}</td>
				<td>{row.score}</td>
				<td>{row.room}</td>
				<td>{row.hp}</td>
			</tr>
		{/each}
		{#if !data}
			<tr><td colspan="4">Loading…</td></tr>
		{/if}
	</tbody>
</table>

<p class="small">updated {new Date(now).toLocaleTimeString()}</p>

<style>
	:global(body) { font-family: ui-monospace, monospace; background: #151019; color: #f4f0f5; margin: 0 auto; max-width: 48rem; padding: 2rem; }
	h1 { color: #f5b301; }
	a { color: #c4b5fd; }
	.clock { font-size: 3rem; margin: 0.5rem 0; }
	.status { color: #fb7185; font-weight: bold; }
	.announce { background: #f5b301; color: #151019; padding: 0.5rem; }
	table { border-collapse: collapse; width: 100%; }
	th, td { border: 1px solid #3a3140; padding: 0.6rem; text-align: left; }
	.small { color: #888; font-size: 0.75rem; }
</style>

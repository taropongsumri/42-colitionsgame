<script lang="ts">
	import { onMount } from 'svelte';
	import { HOUSES, type HouseId } from '$lib/shared/types';

	type Session = {
		token: string;
		code: string;
		house: HouseId | null;
		accepted: boolean;
	};

	let session: Session | null = null;
	let copied = false;
	let error = '';

	$: house = session?.house ?? null;
	$: accepted = session?.accepted ?? false;

	async function loadSession(create: boolean) {
		const response = create
			? await fetch('/api/session', { method: 'POST' })
			: await fetch('/api/session');
		const data = (await response.json()) as { session: Session | null };
		if (data.session) session = data.session;
		return data.session;
	}

	onMount(() => {
		void (async () => {
			try {
				const existing = await loadSession(false);
				if (!existing) await loadSession(true);
			} catch {
				error = 'Could not reach the server. Refresh to try again.';
			}
		})();

		const poll = setInterval(() => {
			void loadSession(false).catch(() => undefined);
		}, 1000);
		return () => clearInterval(poll);
	});

	async function copyCode() {
		if (!session?.code) return;
		try {
			await navigator.clipboard.writeText(session.code);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			error = 'Select and copy the code manually.';
		}
	}
</script>

<svelte:head>
	<title>Join · Coalition Backrooms</title>
</svelte:head>

<main>
	<nav>
		<span class="brand">COALITION BACKROOMS</span>
		<span><a href="/scoreboard">Scoreboard</a> · <a href="/admin">Admin</a></span>
	</nav>

	<section class="card">
		<p class="eyebrow">PLAYER JOIN</p>
		<h1>Your machine password</h1>
		<p class="lead">
			Show this code to the admin. It is the same 4-character password listed in the
			<strong>/admin</strong> lobby.
		</p>

		<div class="code" aria-label="Machine password">
			{#each (session?.code ?? '····').split('') as character, index}
				<span>{character}</span>{#if index === 1}<i></i>{/if}
			{/each}
		</div>

		<button class="copy" onclick={copyCode} disabled={!session?.code}>
			{copied ? 'Copied!' : 'Copy password'}
		</button>

		<div class="status" class:ready={accepted}>
			{#if accepted}
				<p class="ok">Accepted — {house ? HOUSES[house].name : 'house assigned'}</p>
				<p>You can enter the game now.</p>
			{:else if house}
				<p>{HOUSES[house].name} assigned — waiting for the admin to accept.</p>
			{:else}
				<p>Waiting for the admin to assign this machine to a house…</p>
			{/if}
		</div>

		{#if error}<p class="error">{error}</p>{/if}

		<a class="enter" class:disabled={!accepted} href={accepted ? '/game' : undefined}
			aria-disabled={!accepted}
			onclick={(event) => { if (!accepted) event.preventDefault(); }}>
			Enter game →
		</a>
	</section>

	<p class="hint">The game fills your whole browser. Use the zoom control in-game to see 20% more.</p>
</main>

<style>
	:global(body) {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: radial-gradient(circle at 50% 0%, #2a2133 0%, #110d15 60%, #0b080e 100%);
		color: #f4f0f5;
		margin: 0;
		min-height: 100vh;
	}
	main { max-width: 42rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
	nav { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 4rem; }
	.brand { color: #f5b301; letter-spacing: 0.18em; font-size: 0.75rem; }
	a { color: #c4b5fd; }
	.card {
		background: rgba(30, 23, 35, 0.92);
		border: 1px solid #4a3d52;
		border-radius: 14px;
		padding: 2.5rem 2rem;
		text-align: center;
		box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
	}
	.eyebrow { color: #8b8290; letter-spacing: 0.3em; font-size: 0.7rem; margin: 0 0 0.75rem; }
	h1 { margin: 0 0 0.75rem; font-size: 1.7rem; color: #fff; }
	.lead { color: #bdb4c2; line-height: 1.6; margin: 0 auto 1.75rem; max-width: 30rem; }
	.lead strong { color: #f5b301; }
	.code { display: flex; justify-content: center; align-items: center; gap: 0.35rem; margin: 1rem 0 1.5rem; }
	.code span {
		display: grid;
		place-content: center;
		width: 4rem;
		height: 5rem;
		background: #151019;
		border: 1px solid #f5b301;
		border-radius: 8px;
		font-size: 2.6rem;
		font-weight: 700;
		color: #f5d000;
		text-shadow: 0 0 16px rgba(245, 179, 1, 0.45);
	}
	.code i { width: 0.5rem; height: 1px; background: #6a5e70; }
	.copy {
		background: transparent;
		color: #c4b5fd;
		border: 1px solid #6d5a78;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		cursor: pointer;
		font: inherit;
	}
	.copy:disabled { opacity: 0.4; cursor: default; }
	.status { margin: 2rem 0 1rem; color: #9f95a6; font-size: 0.9rem; min-height: 2.8rem; }
	.status p { margin: 0.2rem 0; }
	.status .ok { color: #6ee7a8; font-weight: 700; }
	.status.ready { color: #d8cfdd; }
	.enter {
		display: inline-block;
		background: #f5b301;
		color: #151019;
		font-weight: 700;
		text-decoration: none;
		padding: 0.85rem 2.5rem;
		border-radius: 8px;
		transition: transform 0.15s ease, filter 0.15s ease;
	}
	.enter:hover { transform: translateY(-1px); filter: brightness(1.08); }
	.enter.disabled { background: #3a3140; color: #8b8290; cursor: not-allowed; }
	.error { color: #fb7185; }
	.hint { text-align: center; color: #77707d; font-size: 0.75rem; margin-top: 2rem; }
</style>

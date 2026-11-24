<script lang="ts">
	import { onMount } from 'svelte';

	/** Shell-style answer terminal ported from the earlier prototype. */
	export let roomId: string;
	export let prompt: string;
	export let hint: string | null = null;
	export let lockRemaining = 0;
	export let feedback = '';
	export let solved = false;
	export let onClose: () => void;
	export let onSubmit: (answer: string) => void;

	type Line = { kind: 'cmd' | 'out' | 'ok' | 'err' | 'dim'; text: string };

	let answer = '';
	let submitted: string | null = null;
	let input: HTMLInputElement;

	$: lines = [
		{ kind: 'cmd', text: `cat ~/quest/${roomId}.txt` },
		{ kind: 'dim', text: '[question]' },
		{ kind: 'out', text: prompt },
		...(hint ? [{ kind: 'dim', text: `hint: ${hint}` }] : []),
		...(submitted ? [{ kind: 'cmd', text: `./submit "${submitted}"` }] : []),
		...(feedback
			? [
					{
						kind: /denied|error|locked|wrong/i.test(feedback) ? 'err' : 'ok',
						text: feedback
					}
				]
			: [])
	] as Line[];

	function submit() {
		const text = answer.trim();
		if (!text || lockRemaining > 0 || solved) return;
		submitted = text;
		onSubmit(text);
		answer = '';
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}

	onMount(() => input?.focus());
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="backdrop" role="presentation" onclick={onClose}>
	<div
		class="term"
		role="dialog"
		aria-label="Terminal {roomId}"
		tabindex="-1"
		onclick={(event) => event.stopPropagation()}
		onkeydown={() => {}}
	>
		<div class="bar">
			<span>pisciner@backroom: ~/quest/{roomId}</span>
			<button type="button" onclick={onClose} aria-label="Close">✕</button>
		</div>
		<div class="body">
			{#each lines as line, index (index)}
				<div class="line {line.kind}">
					{#if line.kind === 'cmd'}<span class="ps">$</span> {/if}{line.text}
				</div>
			{/each}
			{#if !solved}
				<form
					onsubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<span class="ps">$</span>
					<span class="dim">answer&gt;</span>
					<input
						bind:this={input}
						bind:value={answer}
						disabled={lockRemaining > 0}
						maxlength="200"
						autocomplete="off"
						spellcheck="false"
						placeholder={lockRemaining > 0
							? `Locked for ${lockRemaining}s`
							: 'Type your answer, press Enter'}
					/>
				</form>
			{/if}
		</div>
		<div class="foot">Enter to submit · Esc to close</div>
	</div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(10, 12, 20, 0.45);
		padding: 1rem;
	}
	.term {
		width: min(560px, 92%);
		background: #0f1117;
		border: 2px solid #3d4250;
		border-radius: 8px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
		color: #d8dee9;
		font-family: 'Noto Sans Thai', ui-monospace, monospace;
		font-size: clamp(12px, 1.6vw, 15px);
	}
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 10px;
		background: #1c1f29;
		border-bottom: 1px solid #3d4250;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #9aa3b5;
	}
	.bar button {
		background: transparent;
		border: 0;
		color: #9aa3b5;
		cursor: pointer;
		font-size: 1rem;
	}
	.bar button:hover { color: #ff6b7a; }
	.body { padding: 12px 14px; min-height: 140px; line-height: 1.6; }
	.line.out { color: #ffffff; font-size: 1.15em; margin: 2px 0 8px; }
	.line.ok { color: #7be39a; font-weight: 600; }
	.line.err { color: #ff6b7a; font-weight: 600; }
	.line.dim, .dim { color: #7c859a; }
	.ps { color: #ffc23c; }
	form { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.5rem; }
	input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: 0;
		border-bottom: 1px solid #3d4250;
		color: #fff;
		font: inherit;
		padding: 4px 2px;
		outline: none;
	}
	input:focus { border-bottom-color: #ffc23c; }
	input:disabled { opacity: 0.6; }
	.foot {
		padding: 6px 12px;
		border-top: 1px solid #262a35;
		font-size: 12px;
		color: #7c859a;
	}
</style>

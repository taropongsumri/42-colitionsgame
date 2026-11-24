<script lang="ts">
	import { onDestroy } from 'svelte';

	/** Short pre-fight cutscene. The server fight only starts after it finishes. */
	export let floor: number;
	export let name: string;
	export let title: string;
	export let question: string;
	export let onDone: () => void;

	let elapsed = 0;
	const total = 1800;
	let last = performance.now();
	let raf = 0;
	let done = false;

	function finish() {
		if (done) return;
		done = true;
		cancelAnimationFrame(raf);
		onDone();
	}

	const tick = (now: number) => {
		elapsed = Math.min(total, elapsed + (now - last));
		last = now;
		if (elapsed >= total) finish();
		else raf = requestAnimationFrame(tick);
	};

	raf = requestAnimationFrame(tick);

	const onKey = (event: KeyboardEvent) => {
		if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
			event.preventDefault();
			finish();
		}
	};
	window.addEventListener('keydown', onKey);

	onDestroy(() => {
		cancelAnimationFrame(raf);
		window.removeEventListener('keydown', onKey);
	});

	$: progress = Math.min(1, elapsed / total);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="cutscene" role="presentation" onclick={finish}>
	<div class="scanlines"></div>
	<div class="card" role="dialog" aria-label="{name} cutscene">
		<div class="eyebrow">FLOOR {String(floor).padStart(2, '0')} · LIFT ARRIVAL</div>
		<div class="silhouette">
			<div class="head"></div>
			<div class="body"></div>
			<div class="glow"></div>
		</div>
		<h1>{name}</h1>
		<p class="title">{title}</p>
		<p class="question">{question}</p>
		<div class="bar"><span style:width="{progress * 100}%"></span></div>
		<p class="skip">Press Enter to skip</p>
	</div>
</div>

<style>
	.cutscene {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: grid;
		place-content: center;
		background: radial-gradient(circle at 50% 45%, #2a1740 0%, #0b080e 62%);
		overflow: hidden;
	}
	.scanlines {
		position: absolute;
		inset: 0;
		opacity: 0.18;
		background: repeating-linear-gradient(
			to bottom,
			transparent 0,
			transparent 2px,
			#f4f0f5 3px,
			transparent 4px
		);
		pointer-events: none;
	}
	.card {
		position: relative;
		width: min(30rem, calc(100vw - 2rem));
		padding: clamp(1rem, 4vw, 2rem);
		text-align: center;
		font-family: ui-monospace, monospace;
		color: #f4f0f5;
		border: 1px solid #6d5a78;
		background: rgba(14, 10, 18, 0.92);
		box-shadow: 0 20px 80px rgba(0, 0, 0, 0.65);
		animation: rise 420ms ease-out both;
	}
	.eyebrow {
		color: #f5b301;
		letter-spacing: 0.22em;
		font-size: 0.65rem;
	}
	.silhouette {
		position: relative;
		width: 78px;
		height: 92px;
		margin: 1rem auto 0.6rem;
		filter: drop-shadow(0 0 18px rgba(255, 59, 78, 0.75));
	}
	.head {
		position: absolute;
		left: 27px;
		top: 4px;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: #17111c;
		border: 1px solid #ff3b4e;
	}
	.body {
		position: absolute;
		left: 13px;
		top: 30px;
		width: 52px;
		height: 58px;
		background: #17111c;
		border: 1px solid #ff3b4e;
		border-radius: 14px 14px 4px 4px;
	}
	.glow {
		position: absolute;
		left: 31px;
		top: 12px;
		width: 5px;
		height: 5px;
		background: #ff3b4e;
		box-shadow: 12px 0 0 #ff3b4e;
		animation: blink 700ms steps(2) infinite;
	}
	h1 {
		margin: 0;
		font-size: clamp(1.4rem, 6vw, 2.2rem);
		letter-spacing: 0.12em;
		color: #ff6b7a;
		text-shadow: 0 0 20px rgba(255, 59, 78, 0.5);
	}
	.title {
		margin: 0.25rem 0 1rem;
		color: #c4b5fd;
		font-size: 0.72rem;
		letter-spacing: 0.16em;
	}
	.question {
		margin: 0 0 1rem;
		color: #e7dfeb;
		font-size: clamp(0.72rem, 2.6vw, 0.86rem);
		line-height: 1.6;
	}
	.bar {
		height: 3px;
		background: #2f2636;
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: #f5b301;
	}
	.skip {
		margin: 0.6rem 0 0;
		color: #7c7286;
		font-size: 0.62rem;
	}
	@keyframes rise {
		from { opacity: 0; transform: translateY(24px) scale(0.96); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}
	@keyframes blink {
		50% { opacity: 0.2; }
	}
</style>

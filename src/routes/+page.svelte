<script lang="ts">
	import { onMount } from 'svelte';

	let status = 'connecting…';
	let messages: string[] = [];

	onMount(() => {
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const host = import.meta.env.DEV ? `${location.hostname}:3000` : location.host;
		const socket = new WebSocket(`${protocol}//${host}/ws/spike`);

		socket.onopen = () => (status = 'open');
		socket.onerror = () => (status = 'error');
		socket.onclose = () => (status = 'closed');
		socket.onmessage = (event) => {
			messages = [...messages, String(event.data)].slice(-8);
		};

		return () => socket.close();
	});
</script>

<h1>Coalition Backrooms — Phase 0 spike</h1>
<p>WebSocket status: <strong>{status}</strong></p>
<pre>{messages.join('\n') || '(no messages yet)'}</pre>

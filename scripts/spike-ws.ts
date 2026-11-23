const url = process.env.WS_URL ?? 'ws://localhost:3000/ws/spike';
const socket = new WebSocket(url);

const received: string[] = [];
let settled = false;

function finish(code: number) {
	if (settled) return;
	settled = true;
	console.log(JSON.stringify({ url, received }, null, 2));
	socket.close();
	process.exit(code);
}

socket.onopen = () => socket.send('ping-from-spike');
socket.onmessage = (event) => {
	received.push(String(event.data));
	if (received.length >= 2) finish(received.some((m) => m.includes('spike.echo')) ? 0 : 1);
};
socket.onerror = () => finish(1);
setTimeout(() => finish(1), 4000);

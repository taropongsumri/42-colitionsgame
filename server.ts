type SocketData = { path: string };

const port = Number(Bun.env.PORT ?? 3000);
const mode = Bun.env.MODE ?? 'dev';

type AppFetch = (
	request: Request,
	server: Bun.Server<SocketData>
) => Response | Promise<Response> | undefined;

let appFetch: AppFetch;

if (mode === 'prod') {
	const { getHandler } = await import('./build/handler.js');
	appFetch = getHandler().fetch as AppFetch;
} else {
	const devOrigin = new URL(Bun.env.VITE_ORIGIN ?? 'http://localhost:5173');
	appFetch = async (request) => {
		const url = new URL(request.url);
		url.protocol = devOrigin.protocol;
		url.host = devOrigin.host;
		return fetch(new Request(url, request));
	};
}

/**
 * Phase 0 spike: HTTP and WebSocket share one Bun.serve instance.
 * In prod, HTTP is handed to the SvelteKit adapter handler.
 * In dev, HTTP is proxied to Vite while /ws/* is handled here.
 */
const server = Bun.serve<SocketData>({
	port,
	fetch(request, bunServer) {
		const url = new URL(request.url);
		if (
			url.pathname.startsWith('/ws/') &&
			request.headers.get('upgrade')?.toLowerCase() === 'websocket'
		) {
			return bunServer.upgrade(request, { data: { path: url.pathname } })
				? undefined
				: new Response('WebSocket upgrade failed', { status: 400 });
		}
		return appFetch(request, bunServer);
	},
	websocket: {
		open(ws) {
			ws.send(JSON.stringify({ type: 'spike.hello', path: ws.data.path }));
		},
		message(ws, message) {
			ws.send(
				JSON.stringify({
					type: 'spike.echo',
					data: typeof message === 'string' ? message : '[binary]'
				})
			);
		},
		close() {
			// nothing to clean up yet
		}
	}
});

console.log(`[server] mode=${mode} listening on http://localhost:${server.port} (WebSocket on /ws/*)`);

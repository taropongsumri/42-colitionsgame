const web = Bun.spawn(['bun', 'run', 'dev:web'], {
	stdout: 'inherit',
	stderr: 'inherit',
	env: { ...process.env, MODE: 'dev' }
});

const ws = Bun.spawn(['bun', 'run', 'dev:ws'], {
	stdout: 'inherit',
	stderr: 'inherit',
	env: { ...process.env, MODE: 'dev' }
});

const shutdown = () => {
	web.kill();
	ws.kill();
	process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await Promise.all([web.exited, ws.exited]);

<script lang="ts">
	import { onMount } from 'svelte';
	import { HOUSE_IDS, type HouseId } from '$lib/shared/types';
	import { Button } from '$lib/components/ui/button';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import {
		Card,
		CardContent,
		CardDescription,
		CardFooter,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import {
		Tabs,
		TabsContent,
		TabsList,
		TabsTrigger
	} from '$lib/components/ui/tabs';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger,
		SelectValue
	} from '$lib/components/ui/select';

	type Machine = {
		code: string;
		houseId: HouseId | null;
		accepted: boolean;
		connected: boolean;
		lastSeen: number | null;
	};
	type House = {
		id: HouseId;
		room: number;
		hp: number;
		score: number;
		connected: boolean;
		status?: string;
		floor?: number;
		plug?: number;
		defeatedBosses?: string[];
		bossRetryAt?: number | null;
	};
	type LogEntry = {
		at: number;
		type: string;
		house?: HouseId;
		message: string;
		data?: Record<string, unknown>;
	};
	type ConfigRevision = { at: number; by: string; value: Record<string, unknown> };
	type Question = {
		id: string;
		question: string;
		answer: string;
		acceptedAnswers: readonly string[];
		hint?: string;
		category: string;
	};
	type BossEntry = {
		raw: Record<string, unknown>;
		id: string;
		floor: number;
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
		showNextWords: boolean;
		comboBreakEvery: number;
		comboBreakPercent: number;
		comboBreakStackPercent: number;
		attackEverySeconds: number;
		attackDamage: number;
		wrongHealPercent: number;
		counterDamage: number;
		bpm: number;
		stunSeconds: number;
		stunPenalty: number;
	};

	const floors = [1, 2, 3, 4, 5] as const;
	const tabs = [
		{ value: 'machines', label: 'Machines' },
		{ value: 'houses', label: 'Houses' },
		{ value: 'control', label: 'Game control' },
		{ value: 'bosses', label: 'Boss editor' },
		{ value: 'config', label: 'Live config' },
		{ value: 'questions', label: 'Question bank' },
		{ value: 'discord', label: 'Discord' },
		{ value: 'logs', label: 'Audit log' }
	] as const;

	let password = $state('');
	let activeTab = $state<string>('machines');
	let machines = $state<Machine[]>([]);
	let houses = $state<House[]>([]);
	let message = $state('');
	let moveFrom = $state('none');
	let moveTo = $state('none');
	let configText = $state('');
	let scoreHouse = $state<HouseId>('h1');
	let unlockHouse = $state<HouseId>('h1');
	let retryHouse = $state<HouseId>('h1');
	let scoreAmount = $state(0);
	let scoreReason = $state('');
	let minutes = $state(5);
	let announcement = $state('');
	let bosses = $state<BossEntry[]>([]);
	let orbsHidden = $state(false);
	let logs = $state<LogEntry[]>([]);
	let configHistory = $state<ConfigRevision[]>([]);
	let logType = $state('');
	let questionsText = $state('');
	let discord = $state<{ configured: boolean; maxPerMinute: number } | null>(null);

	const ready = $derived(password.trim().length > 0);

	const configSummary = $derived.by(() => {
		try {
			const parsed = JSON.parse(configText) as {
				game?: Record<string, unknown>;
				boss?: { bosses?: Record<string, unknown>[] };
			};
			return {
				floorCount: String(parsed.game?.floorCount ?? 5),
				plugsPerFloor: String(parsed.game?.plugsPerFloor ?? 6),
				bossRetryDelaySeconds: String(parsed.game?.bossRetryDelaySeconds ?? 120),
				bossCount: parsed.boss?.bosses?.length ?? 0
			};
		} catch {
			return null;
		}
	});

	const headers = () => ({ 'x-admin-password': password, 'content-type': 'application/json' });

	// Raw JSON fields are preserved so saving the boss editor does not drop unknown keys.
	function bossNumber(entry: BossEntry, key: keyof BossEntry, fallback: number) {
		const value = Number(entry[key]);
		return Number.isFinite(value) && value !== 0 ? value : fallback;
	}

	function rawBoss(entry: BossEntry) {
		return {
			...entry.raw,
			id: entry.id.trim() || `boss-${Date.now().toString(36)}`,
			floor: Math.min(5, Math.max(1, Math.round(bossNumber(entry, 'floor', 1)))),
			name: entry.name || 'New boss',
			title: entry.title || 'BOSS',
			question: entry.question || 'Type the access phrase.',
			answers: entry.answers
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean),
			wordPool: entry.words
				.split(/[\s,]+/)
				.map((value) => value.trim())
				.filter(Boolean),
			hp: bossNumber(entry, 'hp', 1000),
			playerHp: bossNumber(entry, 'playerHp', 100),
			shieldPerWord: bossNumber(entry, 'shieldPerWord', 10),
			shieldMax: bossNumber(entry, 'shieldMax', 100),
			chipPerWord: bossNumber(entry, 'chipPerWord', 5),
			showNextWords: entry.showNextWords !== false,
			comboBreakEvery: bossNumber(entry, 'comboBreakEvery', 10),
			comboBreakPercent: bossNumber(entry, 'comboBreakPercent', 20),
			comboBreakStackPercent: bossNumber(entry, 'comboBreakStackPercent', 10),
			attackEverySeconds: bossNumber(entry, 'attackEverySeconds', 3),
			attackDamage: bossNumber(entry, 'attackDamage', 15),
			wrongHealPercent: bossNumber(entry, 'wrongHealPercent', 30),
			counterDamage: bossNumber(entry, 'counterDamage', 30),
			bpm: bossNumber(entry, 'bpm', 140),
			stunSeconds: bossNumber(entry, 'stunSeconds', 4),
			stunPenalty: bossNumber(entry, 'stunPenalty', 50)
		};
	}

	function bossToEntry(value: Record<string, unknown>): BossEntry {
		return {
			raw: value,
			id: String(value.id ?? ''),
			floor: Math.min(5, Math.max(1, Number(value.floor ?? 1) || 1)),
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
			showNextWords: value.showNextWords !== false,
			comboBreakEvery: Number(value.comboBreakEvery ?? 10),
			comboBreakPercent: Number(value.comboBreakPercent ?? 20),
			comboBreakStackPercent: Number(value.comboBreakStackPercent ?? 10),
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
		const data = (await response.json()) as {
			machines: Machine[];
			houses: House[];
			meta?: { orbsHidden?: boolean };
		};
		machines = data.machines;
		houses = data.houses;
		orbsHidden = data.meta?.orbsHidden === true;
		message = '';
	}

	async function loadConfig() {
		if (!password) return;
		const response = await fetch('/api/admin/config', { headers: headers() });
		if (!response.ok) return;
		const data = (await response.json()) as { config: Record<string, unknown> };
		configText = JSON.stringify(data.config, null, 2);
		const bossConfig = (data.config.boss ?? {}) as Record<string, unknown>;
		bosses = ((bossConfig.bosses ?? []) as Record<string, unknown>[]).map(bossToEntry);
	}

	async function saveBosses() {
		try {
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
		} catch {
			message = 'boss config rejected: invalid JSON';
		}
		await loadConfig();
	}

	function addBoss() {
		bosses = [
			...bosses,
			bossToEntry({
				id: `boss-${Date.now().toString(36)}`,
				floor: Math.min(5, bosses.length + 1),
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

	async function assign(code: string, value: string) {
		await action(code, 'PATCH', { house: value === 'none' ? '' : value });
	}

	async function move() {
		const response = await fetch('/api/admin/move', {
			method: 'POST',
			headers: headers(),
			body: JSON.stringify({
				from: moveFrom === 'none' ? '' : moveFrom,
				to: moveTo === 'none' ? '' : moveTo
			})
		});
		const data = (await response.json()) as { error?: string };
		message = data.error ?? 'session moved';
		await load();
	}

	async function saveConfig() {
		try {
			const response = await fetch('/api/admin/config', {
				method: 'PUT',
				headers: headers(),
				body: JSON.stringify({ config: JSON.parse(configText) })
			});
			message = response.ok ? 'config saved' : 'config rejected';
		} catch {
			message = 'config rejected: invalid JSON';
		}
	}

	async function resetConfig() {
		await fetch('/api/admin/config/reset', { method: 'POST', headers: headers() });
		await loadConfig();
		message = 'config reset to defaults';
	}

	async function loadLogs() {
		if (!password) return;
		const response = await fetch(`/api/admin/logs?limit=100&type=${encodeURIComponent(logType)}`, {
			headers: headers()
		});
		if (!response.ok) return;
		const data = (await response.json()) as { logs: LogEntry[]; configHistory: ConfigRevision[] };
		logs = data.logs;
		configHistory = data.configHistory;
	}

	async function loadQuestions() {
		if (!password) return;
		const response = await fetch('/api/admin/questions', { headers: headers() });
		if (!response.ok) return;
		const data = (await response.json()) as { questions: Question[] };
		questionsText = JSON.stringify(data.questions, null, 2);
	}

	async function saveQuestions() {
		try {
			const questions = JSON.parse(questionsText) as Question[];
			const response = await fetch('/api/admin/questions', {
				method: 'PUT',
				headers: headers(),
				body: JSON.stringify({ questions })
			});
			const data = (await response.json()) as { error?: string; count?: number };
			message = data.error ?? `${data.count} questions saved`;
		} catch {
			message = 'questions rejected: invalid JSON';
		}
		await loadLogs();
	}

	async function loadDiscord() {
		if (!password) return;
		const response = await fetch('/api/admin/discord', { headers: headers() });
		if (!response.ok) return;
		discord = (await response.json()) as typeof discord;
	}

	async function testDiscord() {
		const response = await fetch('/api/admin/discord', {
			method: 'POST',
			headers: headers(),
			body: JSON.stringify({ test: true })
		});
		const data = (await response.json()) as { ok: boolean; reason?: string; status?: number };
		message = data.ok ? 'Discord test sent' : `Discord test failed: ${data.reason ?? data.status}`;
	}

	async function setOrbs(hidden: boolean) {
		await control('hideOrbs', { hidden });
		orbsHidden = hidden;
	}

	async function control(actionName: string, payload: Record<string, unknown> = {}) {
		const response = await fetch('/api/admin/control', {
			method: 'POST',
			headers: headers(),
			body: JSON.stringify({ action: actionName, ...payload })
		});
		const data = (await response.json()) as { error?: string };
		message = data.error ?? `${actionName} ok`;
		await load();
	}

	function reloadAll() {
		if (!password) return;
		void load();
		void loadConfig();
		void loadLogs();
		void loadQuestions();
		void loadDiscord();
	}

	function machineState(machine: Machine): { label: string; variant: BadgeVariant } {
		if (!machine.accepted) return { label: 'pending', variant: 'outline' };
		if (machine.connected) return { label: 'playing', variant: 'default' };
		return { label: 'accepted (offline)', variant: 'secondary' };
	}

	function logTime(at: number) {
		return new Date(at).toLocaleTimeString();
	}

	onMount(() => {
		// Avoid 401 noise: nothing is fetched until a password is entered.
		reloadAll();
	});
</script>

<div class="mx-auto max-w-7xl px-4 py-8 md:px-8">
	<header class="mb-6 flex flex-wrap items-end justify-between gap-4">
		<div class="space-y-1">
			<p class="text-[10px] font-semibold tracking-[0.35em] text-violet-400 uppercase">
				Coalition Backrooms / control room
			</p>
			<h1 class="text-2xl font-bold tracking-tight text-amber-400 md:text-3xl">Admin — Lobby</h1>
			<p class="text-xs text-muted-foreground">
				Machines, dungeon, bosses and live configuration in one place.
			</p>
		</div>
		<nav class="flex flex-wrap gap-2">
			<Button href="/" variant="outline" size="sm">Back to game</Button>
			<Button href="/scoreboard" variant="outline" size="sm">Scoreboard</Button>
		</nav>
	</header>

	<Card class="mb-6 border-violet-500/30 bg-card/80 shadow-lg shadow-violet-950/30">
		<CardHeader class="pb-3">
			<CardTitle class="text-sm tracking-wide">Access</CardTitle>
			<CardDescription class="text-xs">
				Admin APIs use the <code class="text-amber-300">x-admin-password</code> header (default
				<code class="text-amber-300">admin</code>).
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-wrap items-end gap-3">
			<div class="grid w-full gap-1.5 sm:w-64">
				<Label for="admin-password">Password</Label>
				<Input
					id="admin-password"
					type="password"
					placeholder="admin password"
					bind:value={password}
					onchange={reloadAll}
					autocomplete="current-password"
				/>
			</div>
			<Button size="sm" onclick={reloadAll} disabled={!ready}>Unlock / reload</Button>
			{#if message}
				<Badge variant="secondary" class="max-w-full truncate normal-case" title={message}>
					{message}
				</Badge>
			{/if}
		</CardContent>
	</Card>

	<Tabs bind:value={activeTab} class="w-full">
		<TabsList variant="line" class="h-auto w-full flex-wrap justify-start gap-1 border-b border-border">
			{#each tabs as tab}
				<TabsTrigger value={tab.value} class="px-2 py-1.5 text-xs data-active:text-amber-400">
					{tab.label}
				</TabsTrigger>
			{/each}
		</TabsList>

		<TabsContent value="machines" class="mt-4 space-y-4">
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base text-amber-300">Machines</CardTitle>
					<CardDescription class="text-xs">
						Assign houses, accept players and kick disconnected machines.
					</CardDescription>
				</CardHeader>
				<CardContent class="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Code</TableHead>
								<TableHead>House</TableHead>
								<TableHead>State</TableHead>
								<TableHead>Last seen</TableHead>
								<TableHead>Assign</TableHead>
								<TableHead class="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each machines as machine (machine.code)}
								{@const state = machineState(machine)}
								<TableRow>
									<TableCell class="font-bold tracking-wider text-amber-400">{machine.code}</TableCell>
									<TableCell>{machine.houseId ?? '—'}</TableCell>
									<TableCell>
										<Badge variant={state.variant}>{state.label}</Badge>
									</TableCell>
									<TableCell class="text-xs text-muted-foreground">
										{machine.lastSeen ? logTime(machine.lastSeen) : '—'}
									</TableCell>
									<TableCell>
										<Select
											type="single"
											value={machine.houseId ?? 'none'}
											onValueChange={(value) => assign(machine.code, value)}
										>
											<SelectTrigger size="sm" class="w-24" aria-label="Assign house">
												<SelectValue placeholder="—" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="none">—</SelectItem>
												{#each HOUSE_IDS as id}
													<SelectItem value={id}>{id}</SelectItem>
												{/each}
											</SelectContent>
										</Select>
									</TableCell>
									<TableCell>
										<div class="flex justify-end gap-1.5">
											<Button
												size="xs"
												variant="outline"
												disabled={!ready}
												onclick={() => action(machine.code, 'POST')}>Accept</Button
											>
											<Button
												size="xs"
												variant="destructive"
												disabled={!ready}
												onclick={() => action(machine.code, 'DELETE')}>Kick</Button
											>
										</div>
									</TableCell>
								</TableRow>
							{:else}
								<TableRow>
									<TableCell colspan={6} class="py-6 text-center text-xs text-muted-foreground">
										{message || 'No machines connected.'}
									</TableCell>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-sm">Move session</CardTitle>
					<CardDescription class="text-xs">Transfer a player between machines.</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-wrap items-end gap-3">
					<div class="grid gap-1.5">
						<Label>From</Label>
						<Select type="single" bind:value={moveFrom}>
							<SelectTrigger class="w-40" size="sm" aria-label="Move from">
								<SelectValue placeholder="from…" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">—</SelectItem>
								{#each machines as machine (machine.code)}
									<SelectItem value={machine.code}>{machine.code}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>
					<div class="grid gap-1.5">
						<Label>To</Label>
						<Select type="single" bind:value={moveTo}>
							<SelectTrigger class="w-40" size="sm" aria-label="Move to">
								<SelectValue placeholder="to…" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">—</SelectItem>
								{#each machines as machine (machine.code)}
									<SelectItem value={machine.code}>{machine.code}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>
					<Button size="sm" disabled={!ready} onclick={move}>Move</Button>
				</CardContent>
			</Card>
		</TabsContent>

		<TabsContent value="houses" class="mt-4">
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base text-amber-300">House score</CardTitle>
					<CardDescription class="text-xs">
						Room is the global plug counter; floor and plug are derived from it.
					</CardDescription>
				</CardHeader>
				<CardContent class="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>House</TableHead>
								<TableHead class="text-right">Score</TableHead>
								<TableHead class="text-right">HP</TableHead>
								<TableHead class="text-right">Room</TableHead>
								<TableHead class="text-right">Floor</TableHead>
								<TableHead class="text-right">Plug</TableHead>
								<TableHead>Defeated bosses</TableHead>
								<TableHead>Boss retry at</TableHead>
								<TableHead>Connection</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each houses as house (house.id)}
								<TableRow>
									<TableCell class="font-semibold text-violet-300">{house.id}</TableCell>
									<TableCell class="text-right font-bold text-amber-400">{house.score}</TableCell>
									<TableCell class="text-right">{house.hp}</TableCell>
									<TableCell class="text-right">{house.room}</TableCell>
									<TableCell class="text-right">{house.floor ?? '—'}</TableCell>
									<TableCell class="text-right">{house.plug ?? '—'}</TableCell>
									<TableCell class="text-xs text-muted-foreground">
										{house.defeatedBosses?.length ? house.defeatedBosses.join(', ') : '—'}
									</TableCell>
									<TableCell class="text-xs text-muted-foreground">
										{house.bossRetryAt ? logTime(house.bossRetryAt) : '—'}
									</TableCell>
									<TableCell>
										<Badge variant={house.connected ? 'default' : 'secondary'}>
											{house.connected ? 'online' : (house.status ?? 'offline')}
										</Badge>
									</TableCell>
								</TableRow>
							{:else}
								<TableRow>
									<TableCell colspan={9} class="py-6 text-center text-xs text-muted-foreground">
										No house state yet.
									</TableCell>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</TabsContent>

		<TabsContent value="control" class="mt-4 space-y-4">
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base text-amber-300">Game control</CardTitle>
					<CardDescription class="text-xs">
						Open the building to release players from the KLLC forecourt and start the 90-minute
						clock. Every action posts to /api/admin/control.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="flex flex-wrap items-end gap-2">
						<Button size="sm" disabled={!ready} onclick={() => control('start')}
							>Open building · 90 min</Button
						>
						<Button size="sm" variant="secondary" disabled={!ready} onclick={() => control('pause')}
							>Pause</Button
						>
						<Button size="sm" variant="secondary" disabled={!ready} onclick={() => control('resume')}
							>Resume</Button
						>
						<Button size="sm" variant="destructive" disabled={!ready} onclick={() => control('end')}
							>End game</Button
						>
						<div class="grid gap-1.5">
							<Label for="add-minutes">Add minutes</Label>
							<Input
								id="add-minutes"
								type="number"
								min={-120}
								max={120}
								class="w-24"
								bind:value={minutes}
							/>
						</div>
						<Button size="sm" disabled={!ready} onclick={() => control('addTime', { minutes })}
							>Apply time</Button
						>
					</div>

					<Separator />

					<div class="flex flex-wrap items-end gap-2">
						<div class="grid gap-1.5">
							<Label>House</Label>
							<Select type="single" bind:value={scoreHouse}>
								<SelectTrigger size="sm" class="w-24" aria-label="Score house">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{#each HOUSE_IDS as id}
										<SelectItem value={id}>{id}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<div class="grid gap-1.5">
							<Label for="score-amount">± points</Label>
							<Input id="score-amount" type="number" class="w-24" bind:value={scoreAmount} />
						</div>
						<div class="grid w-full gap-1.5 sm:w-56">
							<Label for="score-reason">Reason</Label>
							<Input id="score-reason" placeholder="reason" bind:value={scoreReason} />
						</div>
						<Button
							size="sm"
							disabled={!ready}
							onclick={() =>
								control('adjustScore', {
									house: scoreHouse,
									amount: scoreAmount,
									reason: scoreReason
								})}>Adjust score</Button
						>
					</div>

					<Separator />

					<div class="flex flex-wrap items-end gap-2">
						<div class="grid gap-1.5">
							<Label>House</Label>
							<Select type="single" bind:value={unlockHouse}>
								<SelectTrigger size="sm" class="w-24" aria-label="Unlock house">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{#each HOUSE_IDS as id}
										<SelectItem value={id}>{id}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<Button
							size="sm"
							variant="secondary"
							disabled={!ready}
							onclick={() => control('forceUnlock', { house: unlockHouse })}>Force unlock room</Button
						>
						<Button
							size="sm"
							variant="secondary"
							disabled={!ready}
							onclick={() => control('forceBoss', { house: unlockHouse })}>Unlock boss lift</Button
						>
					</div>

					<div class="flex flex-wrap items-end gap-2">
						<div class="grid w-full gap-1.5 sm:w-80">
							<Label for="announcement">Announcement</Label>
							<Input
								id="announcement"
								placeholder="message to all players"
								bind:value={announcement}
							/>
						</div>
						<Button
							size="sm"
							disabled={!ready}
							onclick={() => control('announce', { text: announcement })}>Announce</Button
						>
					</div>

					<Separator />

					<div class="flex flex-wrap items-center gap-3">
						<Switch
							id="hide-orbs"
							checked={orbsHidden}
							onCheckedChange={(checked) => void setOrbs(checked)}
						/>
						<Label for="hide-orbs">Hide spectator orbs</Label>
						<Badge variant={orbsHidden ? 'secondary' : 'outline'}>
							{orbsHidden ? 'hidden from players' : 'visible to players'}
						</Badge>
					</div>

					<Separator />

					<div class="flex flex-wrap items-end gap-2">
						<div class="grid gap-1.5">
							<Label>House</Label>
							<Select type="single" bind:value={retryHouse}>
								<SelectTrigger size="sm" class="w-24" aria-label="Boss retry house">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{#each HOUSE_IDS as id}
										<SelectItem value={id}>{id}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<Button
							size="sm"
							variant="outline"
							disabled={!ready}
							onclick={() => control('clearBossRetry', { house: retryHouse })}>Clear boss retry</Button
						>
						<span class="text-xs text-muted-foreground">
							Clears the knockout cooldown for this house.
						</span>
					</div>
				</CardContent>
			</Card>
		</TabsContent>

		<TabsContent value="bosses" class="mt-4 space-y-4">
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base text-amber-300">Boss editor</CardTitle>
					<CardDescription class="text-xs">
						One boss per floor (1–5). Players choose one with <kbd
							class="rounded-none border border-border px-1">Q</kbd
						> at the lift and fight with <kbd class="rounded-none border border-border px-1">E</kbd
						>. Answers stay server-side.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#each bosses as boss, index (index)}
						<Card class="border-border/70 bg-background/40">
							<CardHeader class="flex flex-row items-center justify-between gap-3 border-b border-border/60 py-3">
								<div class="flex flex-wrap items-center gap-2">
									<Badge variant="outline">FLOOR {boss.floor}</Badge>
									<CardTitle class="text-sm text-violet-300">
										{boss.name || boss.id || `Boss ${index + 1}`}
									</CardTitle>
								</div>
								<Button
									size="xs"
									variant="destructive"
									onclick={() => removeBoss(index)}>Remove</Button
								>
							</CardHeader>
							<CardContent class="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								<div class="grid gap-1.5">
									<Label for={`boss-id-${index}`}>ID</Label>
									<Input id={`boss-id-${index}`} bind:value={boss.id} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-floor-${index}`}>Floor (1–5)</Label>
									<Input
										id={`boss-floor-${index}`}
										type="number"
										min={1}
										max={5}
										bind:value={boss.floor}
									/>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-name-${index}`}>Name</Label>
									<Input id={`boss-name-${index}`} bind:value={boss.name} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-title-${index}`}>Title</Label>
									<Input id={`boss-title-${index}`} bind:value={boss.title} />
								</div>
								<div class="grid gap-1.5 sm:col-span-2">
									<Label for={`boss-question-${index}`}>Question</Label>
									<Input id={`boss-question-${index}`} bind:value={boss.question} />
								</div>
								<div class="grid gap-1.5 sm:col-span-2">
									<Label for={`boss-answers-${index}`}>Answers (comma separated, secret)</Label>
									<Input id={`boss-answers-${index}`} bind:value={boss.answers} />
								</div>
								<div class="grid gap-1.5 sm:col-span-2 lg:col-span-4">
									<Label for={`boss-words-${index}`}>Typing words</Label>
									<Input id={`boss-words-${index}`} bind:value={boss.words} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-hp-${index}`}>HP</Label>
									<Input id={`boss-hp-${index}`} type="number" bind:value={boss.hp} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-player-hp-${index}`}>Player HP</Label>
									<Input id={`boss-player-hp-${index}`} type="number" bind:value={boss.playerHp} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-shield-word-${index}`}>Shield / word</Label>
									<Input
										id={`boss-shield-word-${index}`}
										type="number"
										bind:value={boss.shieldPerWord}
									/>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-shield-max-${index}`}>Shield max</Label>
									<Input id={`boss-shield-max-${index}`} type="number" bind:value={boss.shieldMax} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-chip-${index}`}>Chip / word</Label>
									<Input id={`boss-chip-${index}`} type="number" bind:value={boss.chipPerWord} />
								</div>
								<div class="flex items-center gap-2 self-end pb-1">
									<Checkbox
										id={`boss-words-visible-${index}`}
										checked={boss.showNextWords}
										onCheckedChange={(checked) => (boss.showNextWords = checked)}
									/>
									<Label for={`boss-words-visible-${index}`} class="text-xs">
										Show upcoming words
									</Label>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-combo-every-${index}`}>Combo break every (words)</Label>
									<Input
										id={`boss-combo-every-${index}`}
										type="number"
										bind:value={boss.comboBreakEvery}
									/>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-combo-percent-${index}`}>Combo break HP (%)</Label>
									<Input
										id={`boss-combo-percent-${index}`}
										type="number"
										bind:value={boss.comboBreakPercent}
									/>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-combo-stack-${index}`}>Combo break stack HP (%)</Label>
									<Input
										id={`boss-combo-stack-${index}`}
										type="number"
										bind:value={boss.comboBreakStackPercent}
									/>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-attack-every-${index}`}>Attack every (s)</Label>
									<Input
										id={`boss-attack-every-${index}`}
										type="number"
										step={0.1}
										bind:value={boss.attackEverySeconds}
									/>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-attack-damage-${index}`}>Attack damage</Label>
									<Input
										id={`boss-attack-damage-${index}`}
										type="number"
										bind:value={boss.attackDamage}
									/>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-wrong-heal-${index}`}>Wrong heal (%)</Label>
									<Input
										id={`boss-wrong-heal-${index}`}
										type="number"
										bind:value={boss.wrongHealPercent}
									/>
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-counter-${index}`}>Counter damage</Label>
									<Input id={`boss-counter-${index}`} type="number" bind:value={boss.counterDamage} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-bpm-${index}`}>Combo BPM</Label>
									<Input id={`boss-bpm-${index}`} type="number" bind:value={boss.bpm} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-stun-${index}`}>Death exit (s)</Label>
									<Input id={`boss-stun-${index}`} type="number" bind:value={boss.stunSeconds} />
								</div>
								<div class="grid gap-1.5">
									<Label for={`boss-stun-penalty-${index}`}>Stun penalty</Label>
									<Input
										id={`boss-stun-penalty-${index}`}
										type="number"
										bind:value={boss.stunPenalty}
									/>
								</div>
							</CardContent>
						</Card>
					{/each}
				</CardContent>
				<CardFooter class="flex flex-wrap gap-2">
					<Button size="sm" variant="outline" onclick={addBoss}>Add boss</Button>
					<Button size="sm" disabled={!ready} onclick={saveBosses}>Save bosses</Button>
				</CardFooter>
			</Card>
		</TabsContent>

		<TabsContent value="config" class="mt-4">
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base text-amber-300">Live config</CardTitle>
					<CardDescription class="text-xs">
						New dungeon keys: <code class="text-amber-300">floorCount</code>,
						<code class="text-amber-300">plugsPerFloor</code>,
						<code class="text-amber-300">bossRetryDelaySeconds</code>. The old
						<code class="text-amber-300">roomCount</code> key is gone.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if configSummary}
						<div class="flex flex-wrap gap-2">
							<Badge variant="secondary">floors: {configSummary.floorCount}</Badge>
							<Badge variant="secondary">plugs/floor: {configSummary.plugsPerFloor}</Badge>
							<Badge variant="secondary">retry delay: {configSummary.bossRetryDelaySeconds}s</Badge>
							<Badge variant="outline">bosses: {configSummary.bossCount}</Badge>
						</div>
					{/if}
					<Textarea
						aria-label="Live configuration JSON"
						bind:value={configText}
						class="min-h-80 font-mono text-xs"
						spellcheck="false"
					/>
				</CardContent>
				<CardFooter class="flex flex-wrap gap-2">
					<Button size="sm" disabled={!ready} onclick={saveConfig}>Save</Button>
					<Button size="sm" variant="outline" disabled={!ready} onclick={resetConfig}>
						Reset to defaults
					</Button>
					<Button size="sm" variant="ghost" disabled={!ready} onclick={loadConfig}>Reload</Button>
				</CardFooter>
			</Card>
		</TabsContent>

		<TabsContent value="questions" class="mt-4">
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base text-amber-300">Question bank</CardTitle>
					<CardDescription class="text-xs">
						Answers stay on the server. Question IDs map to the glowing plugs on each floor.
						Categories: <code class="text-amber-300">network</code>,
						<code class="text-amber-300">sport</code>,
						<code class="text-amber-300">general</code>.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Textarea
						aria-label="Question bank JSON"
						bind:value={questionsText}
						class="min-h-80 font-mono text-xs"
						spellcheck="false"
					/>
				</CardContent>
				<CardFooter class="flex flex-wrap gap-2">
					<Button size="sm" variant="outline" disabled={!ready} onclick={loadQuestions}>Reload</Button>
					<Button size="sm" disabled={!ready} onclick={saveQuestions}>Save questions</Button>
				</CardFooter>
			</Card>
		</TabsContent>

		<TabsContent value="discord" class="mt-4">
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base text-amber-300">Discord webhook</CardTitle>
					<CardDescription class="text-xs">
						Set <code class="text-amber-300">DISCORD_WEBHOOK_URL</code> on the server to enable
						notifications.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if discord}
						<div class="flex flex-wrap items-center gap-2">
							<Badge variant={discord.configured ? 'default' : 'secondary'}>
								{discord.configured ? 'Webhook configured' : 'No webhook configured'}
							</Badge>
							<span class="text-xs text-muted-foreground">
								max {discord.maxPerMinute} messages/minute
							</span>
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">Loading…</p>
					{/if}
				</CardContent>
				<CardFooter class="flex flex-wrap gap-2">
					<Button size="sm" variant="outline" disabled={!ready} onclick={testDiscord}>
						Send test notification
					</Button>
					<Button size="sm" variant="ghost" disabled={!ready} onclick={loadDiscord}>Refresh</Button>
				</CardFooter>
			</Card>
		</TabsContent>

		<TabsContent value="logs" class="mt-4 space-y-4">
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base text-amber-300">Audit log</CardTitle>
					<CardDescription class="text-xs">Last 100 events, newest first.</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="flex flex-wrap items-end gap-2">
						<div class="grid w-full gap-1.5 sm:w-72">
							<Label for="log-type">Filter by type</Label>
							<Input
								id="log-type"
								placeholder="e.g. boss.win"
								bind:value={logType}
								onchange={() => void loadLogs()}
							/>
						</div>
						<Button size="sm" variant="outline" disabled={!ready} onclick={loadLogs}>Refresh</Button>
					</div>
					<div class="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Time</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>House</TableHead>
									<TableHead>Event</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{#each logs as entry}
									<TableRow>
										<TableCell class="whitespace-nowrap text-xs text-muted-foreground">
											{logTime(entry.at)}
										</TableCell>
										<TableCell>
											<Badge variant="outline" class="normal-case">{entry.type}</Badge>
										</TableCell>
										<TableCell>{entry.house ?? '—'}</TableCell>
										<TableCell class="text-xs">{entry.message}</TableCell>
									</TableRow>
								{:else}
									<TableRow>
										<TableCell colspan={4} class="py-6 text-center text-xs text-muted-foreground">
											No matching events.
										</TableCell>
									</TableRow>
								{/each}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-sm">Config history</CardTitle>
				</CardHeader>
				<CardContent>
					<ul class="space-y-1 text-xs text-muted-foreground">
						{#each configHistory as revision}
							<li class="border-b border-border/50 pb-1 last:border-0">
								<span class="text-foreground">{new Date(revision.at).toLocaleString()}</span>
								· {revision.by}
							</li>
						{:else}
							<li>No config changes recorded.</li>
						{/each}
					</ul>
				</CardContent>
			</Card>
		</TabsContent>
	</Tabs>
</div>

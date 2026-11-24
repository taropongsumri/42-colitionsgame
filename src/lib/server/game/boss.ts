/**
 * Server-authoritative boss fight. Word queues, accepted answers, damage and
 * progress live here; clients only receive public state and effects.
 */
import type { LiveConfig } from '../../../../config';
import {
	FLOOR_COUNT,
	TOTAL_QUESTION_SLOTS,
	floorForRoom,
	roomForFloorPlug
} from '../../shared/map';
import type { ServerMessage } from '../../shared/protocol';
import { HOUSES, type HouseId } from '../../shared/types';
import { audit } from '../audit';
import { liveConfig } from '../config';
import { getStore } from '../db';
import { emptyBoss, type BossState, type HouseState } from '../db/types';
import { notifyDiscord } from '../discord';
import { normalizeAnswer } from './answer';
import { bonusPercent } from './scoring';

type BossConfig = LiveConfig['boss']['bosses'][number];

export interface BossResult {
	messages: ServerMessage[];
	notice?: string;
	progressChanged?: boolean;
}

const error = (code: string, message: string): ServerMessage => ({ type: 'error', code, message });
const now = () => Date.now();

/** Public metadata only. `answers` is deliberately never included. */
function publicBoss(boss: BossConfig) {
	return {
		id: boss.id,
		floor: boss.floor,
		name: boss.name,
		title: boss.title,
		question: boss.question,
		hp: boss.hp
	};
}

export function bossList(config: LiveConfig, house?: HouseState | null): ServerMessage {
	return {
		type: 'boss.list',
		bosses: config.boss.bosses.map((boss) => ({
			...publicBoss(boss),
			defeated: !!house?.defeatedBosses?.includes(boss.id)
		}))
	};
}

export function findBoss(config: LiveConfig, id: string | null): BossConfig | null {
	return config.boss.bosses.find((boss) => boss.id === id) ?? null;
}

function bossStart(state: HouseState, boss: BossConfig): ServerMessage {
	return {
		type: 'boss.start',
		boss: publicBoss(boss),
		words: state.boss.wordQueue,
		wordIndex: state.boss.wordIndex,
		hp: state.boss.hp,
		maxHp: state.boss.maxHp,
		playerHp: state.boss.playerHp,
		shield: state.boss.shield,
		mode: state.boss.mode,
		attackAt: state.boss.attackAt,
		stunUntil: state.boss.stunUntil,
		lockUntil: state.boss.lockUntil,
		swapReadyAt: state.boss.swapReadyAt,
		invulnUntil: state.boss.invulnUntil,
		combo: state.boss.wordCombo,
		attackReadyAt: state.boss.attackReadyAt,
		attackCost: Math.max(10, Math.round(boss.shieldMax * 0.15)),
		shieldMax: boss.shieldMax,
		comboBreakEvery: Math.max(0, boss.comboBreakEvery ?? 10),
		showNextWords: boss.showNextWords !== false
	};
}

function buildQueue(boss: BossConfig, config: LiveConfig, size = 12): string[] {
	const source = boss.wordPool?.length ? boss.wordPool : config.boss.wordPool;
	const pool = source.length ? source : ['code'];
	const shuffled = [...pool].sort(() => Math.random() - 0.5);
	return Array.from({ length: Math.max(size, shuffled.length) }, (_, index) => shuffled[index % shuffled.length]);
}

function rankMultiplier(config: LiveConfig, houseId: HouseId, boss: BossConfig, houses: HouseState[]): number {
	const sorted = [...houses].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	const place = sorted.findIndex((house) => house.id === houseId) + 1 || sorted.length;
	return (boss.rankShieldPercent[place - 1] ?? 100) / 100;
}

/** Character classes drive the audition animation without revealing the answer. */
function charClass(character: string): number {
	if (/[aeiou]/i.test(character)) return 0;
	if (/[a-z]/i.test(character)) return 1;
	if (/[0-9]/.test(character)) return 2;
	return 3;
}

function lockFor(boss: BossConfig, stunCount: number): number {
	const steps = boss.answerLockSeconds.length ? boss.answerLockSeconds : [30];
	const step = steps[Math.min(stunCount, steps.length - 1)] ?? steps[0] ?? 30;
	return Math.min(boss.answerLockCapSeconds || step, step) * 1000 + now();
}

async function damagePlayer(
	house: HouseState,
	boss: BossConfig,
	amount: number,
	ignoreShield: boolean
): Promise<ServerMessage | null> {
	const fight = house.boss;
	if (now() < fight.invulnUntil) {
		return {
			type: 'boss.attack',
			move: 'DODGE',
			damage: 0,
			absorbed: 0,
			hp: fight.playerHp,
			shield: fight.shield,
			immune: true
		};
	}

	let remaining = Math.max(0, amount);
	let absorbed = 0;
	if (!ignoreShield && fight.mode === 'typing') {
		absorbed = Math.min(fight.shield, remaining);
		fight.shield -= absorbed;
		remaining -= absorbed;
	}
	fight.playerHp = Math.max(0, fight.playerHp - remaining);

	const attacks = boss.attacks.length ? boss.attacks : ['HIT'];
	return {
		type: 'boss.attack',
		move: attacks[Math.floor(Math.random() * attacks.length)] ?? 'HIT',
		damage: remaining,
		absorbed,
		hp: fight.playerHp,
		shield: fight.shield,
		immune: false
	};
}

function stunPlayer(house: HouseState, boss: BossConfig): ServerMessage {
	const fight = house.boss;
	const until = now() + boss.stunSeconds * 1000;
	fight.playerHp = 0;
	fight.shield = 0;
	fight.wordCombo = 0;
	fight.mode = 'stunned';
	fight.stunUntil = until;
	fight.stunCount += 1;
	fight.penalty += boss.stunPenalty;
	fight.hp = Math.min(fight.maxHp, fight.hp + fight.maxHp * (boss.bossHealOnStunPercent / 100));
	// The lock is the visible exit countdown, not a 30s terminal lock: the
	// knockout ends the fight after this delay.
	fight.lockUntil = until;
	fight.invulnUntil = until + boss.invulnAfterStunSeconds * 1000;
	fight.attackAt = until + 1000;
	house.answerLockUntil = null;
	house.score = Math.max(0, house.score - boss.stunPenalty);
	notifyDiscord('boss.stun', { house: house.id, text: `${boss.name} knocked out ${house.id}` });
	return {
		type: 'boss.stun',
		until,
		seconds: boss.stunSeconds,
		penalty: boss.stunPenalty,
		bossHp: fight.hp
	};
}

export async function enterBoss(houseId: HouseId, bossId: string): Promise<BossResult> {
	const store = await getStore();
	const config = await liveConfig();
	const house = await store.getHouse(houseId);
	if (!house) return { messages: [error('NO_HOUSE', 'House state missing')] };

	const boss = findBoss(config, bossId);
	if (!boss) return { messages: [error('NO_BOSS', 'That boss is not configured')] };

	if (house.boss.active) {
		return {
			messages: [bossStart(house, boss), { type: 'notice', text: `${boss.name} is already waiting.` }]
		};
	}

	if (house.defeatedBosses?.includes(boss.id)) {
		return {
			messages: [error('BOSS_DEFEATED', `${boss.name} has already been defeated.`)],
			notice: `${boss.name} has already been defeated`
		};
	}

	const at = now();
	if (house.bossRetryAt && house.bossRetryAt > at) {
		const seconds = Math.ceil((house.bossRetryAt - at) / 1000);
		return {
			messages: [error('BOSS_RETRY', `Wait ${seconds}s before retrying ${boss.name}.`)],
			notice: `Boss retry available in ${seconds}s`
		};
	}

	const clearedOnFloor = house.solvedRooms.filter(
		(room) => floorForRoom(room) === boss.floor
	).length;
	if (clearedOnFloor < config.game.plugsPerFloor) {
		return {
			messages: [
				error(
					'BOSS_LOCKED',
					`Clear all ${config.game.plugsPerFloor} plugs on floor ${boss.floor} before taking the lift.`
				)
			]
		};
	}

	// Pokémon-style: every fight begins with the boss at full HP, regardless of
	// how the previous attempt ended. Damage and timed state never carry over.
	house.boss = emptyBoss({
		active: true,
		bossId: boss.id,
		hp: boss.hp,
		maxHp: boss.hp,
		playerHp: boss.playerHp,
		mode: 'typing',
		attackAt: at + boss.attackEverySeconds * 1000,
		wordQueue: buildQueue(boss, config),
		startedAt: at
	});
	house.answerLockUntil = null;
	house.bossRetryAt = null;
	await store.saveHouse(house);
	await audit(
		{
			type: 'boss.enter',
			house: houseId,
			message: `${houseId} entered ${boss.name} at full HP`,
			data: { bossId: boss.id, floor: boss.floor, hp: boss.hp }
		},
		'boss.enter',
		{ text: `${houseId} entered ${boss.name} on floor ${boss.floor}` }
	);

	return {
		messages: [
			bossStart(house, boss),
			{ type: 'notice', text: `${boss.name} appeared. Type to build shield, Tab to answer.` }
		],
		notice: `${houseId} entered boss ${boss.name}`,
		progressChanged: true
	};
}

export async function submitBossWord(houseId: HouseId, word: string): Promise<BossResult> {
	const store = await getStore();
	const config = await liveConfig();
	const house = await store.getHouse(houseId);
	if (!house || !house.boss.active) return { messages: [error('NO_BOSS', 'No active boss fight')] };
	const boss = findBoss(config, house.boss.bossId);
	if (!boss) return { messages: [error('NO_BOSS', 'Boss config was changed mid-fight')] };
	const fight = house.boss;
	if (fight.mode !== 'typing') {
		return { messages: [error('BOSS_BUSY', 'Switch to typing mode first')] };
	}

	const expected = fight.wordQueue[fight.wordIndex] ?? '';
	if (normalizeAnswer(word) !== normalizeAnswer(expected)) {
		fight.wordCombo = 0;
		return {
			messages: [
				{
					type: 'boss.word',
					correct: false,
					word: expected,
					nextWord: expected,
					shield: fight.shield,
					bossHp: fight.hp,
					maxHp: fight.maxHp,
					wordsDone: fight.wordsDone,
					combo: 0,
					chip: 0
				}
			]
		};
	}

	const houses = await store.listHouses();
	const gain = boss.shieldPerWord * rankMultiplier(config, houseId, boss, houses);
	fight.shield = Math.min(boss.shieldMax, fight.shield + gain);
	const floor = fight.maxHp * (boss.chipFloor || config.game.bossChipFloor);
	const beforeHp = fight.hp;
	// Consecutive correct words build a combo; higher combos chip harder.
	const combo = fight.wordCombo + 1;
	const multiplier = 1 + Math.min(combo - 1, 20) * 0.15;
	fight.hp = Math.max(floor, fight.hp - boss.chipPerWord * multiplier);
	const chip = Math.round(beforeHp - fight.hp);

	// Combo breaks ignore the chip floor: a long streak can actually win the
	// fight, instead of leaving the boss parked at its last 10% of HP.
	const breakEvery = Math.max(0, boss.comboBreakEvery ?? 10);
	const finisher = breakEvery > 0 && combo % breakEvery === 0;
	let finisherDamage = 0;
	let finisherPercent = 0;
	let finisherTier = 0;
	if (finisher) {
		// Each milestone stacks extra damage: x10, x20, x30 hit harder than
		// the last. The percentage is sent for feedback; damage stays server-owned.
		finisherTier = Math.floor(combo / breakEvery);
		finisherPercent = Math.max(
			0,
			(boss.comboBreakPercent ?? 20) + (finisherTier - 1) * Math.max(0, boss.comboBreakStackPercent ?? 0)
		);
		const beforeFinisher = fight.hp;
		fight.hp = Math.max(0, fight.hp - fight.maxHp * (finisherPercent / 100));
		finisherDamage = Math.round(beforeFinisher - fight.hp);
	}

	fight.wordCombo = combo;
	fight.wordsDone += 1;
	fight.wordIndex += 1;
	fight.wordQueue.push(buildQueue(boss, config, 1)[0] ?? 'code');
	const won = fight.hp <= 0;
	const messages: ServerMessage[] = [
		{
			type: 'boss.word',
			correct: true,
			word: expected,
			nextWord: fight.wordQueue[fight.wordIndex] ?? '',
			shield: fight.shield,
			bossHp: fight.hp,
			maxHp: fight.maxHp,
			wordsDone: fight.wordsDone,
			combo,
			chip,
			finisher,
			finisherDamage,
			finisherPercent,
			finisherTier
		}
	];
	if (won) messages.push(...(await finishBoss(house, config)));
	await store.saveHouse(house);
	if (won) {
		await audit(
			{
				type: 'boss.win',
				house: houseId,
				message: `${houseId} broke the boss combo`,
				data: { bossId: boss.id, combo }
			},
			'boss.defeated',
			{ text: `${houseId} defeated ${boss.name} at x${combo}` }
		);
	}

	return { messages, progressChanged: won };
}

/** Spend shield for an immediate hit. Damage and cooldown stay server-side. */
export async function playerAttack(houseId: HouseId): Promise<BossResult> {
	const store = await getStore();
	const config = await liveConfig();
	const house = await store.getHouse(houseId);
	if (!house?.boss.active) return { messages: [error('NO_BOSS', 'No active boss fight')] };
	const boss = findBoss(config, house.boss.bossId);
	if (!boss) return { messages: [error('NO_BOSS', 'Boss config was changed mid-fight')] };
	const fight = house.boss;
	const at = now();
	const cost = Math.max(10, Math.round(boss.shieldMax * 0.15));
	const readyAt = fight.attackReadyAt || at;
	const move = HOUSES[houseId].moves[fight.wordCombo % HOUSES[houseId].moves.length];

	if (fight.mode === 'stunned' || fight.mode === 'audition') {
		return { messages: [{ type: 'boss.playerAttack', move, damage: 0, shield: fight.shield, bossHp: fight.hp, maxHp: fight.maxHp, combo: fight.wordCombo, readyAt, reason: 'BOSS_BUSY' }] };
	}
	if (at < readyAt) {
		return { messages: [{ type: 'boss.playerAttack', move, damage: 0, shield: fight.shield, bossHp: fight.hp, maxHp: fight.maxHp, combo: fight.wordCombo, readyAt, reason: 'COOLDOWN' }] };
	}
	if (fight.shield < cost) {
		return { messages: [{ type: 'boss.playerAttack', move, damage: 0, shield: fight.shield, bossHp: fight.hp, maxHp: fight.maxHp, combo: fight.wordCombo, readyAt, reason: 'NO_SHIELD' }] };
	}

	fight.shield -= cost;
	const floor = fight.maxHp * (boss.chipFloor || config.game.bossChipFloor);
	const beforeHp = fight.hp;
	const damage = Math.round(boss.shieldPerWord * 2.5 * (1 + Math.min(fight.wordCombo, 20) * 0.08));
	fight.hp = Math.max(floor, fight.hp - damage);
	fight.attackReadyAt = at + 900;
	await store.saveHouse(house);

	return {
		messages: [
			{
				type: 'boss.playerAttack',
				move,
				damage: Math.round(beforeHp - fight.hp),
				shield: fight.shield,
				bossHp: fight.hp,
				maxHp: fight.maxHp,
				combo: fight.wordCombo,
				readyAt: fight.attackReadyAt
			}
		]
	};
}

export async function submitBossAnswer(houseId: HouseId, answer: string): Promise<BossResult> {
	const store = await getStore();
	const config = await liveConfig();
	const house = await store.getHouse(houseId);
	if (!house || !house.boss.active) return { messages: [error('NO_BOSS', 'No active boss fight')] };
	const boss = findBoss(config, house.boss.bossId);
	if (!boss) return { messages: [error('NO_BOSS', 'Boss config was changed mid-fight')] };
	const fight = house.boss;
	const at = now();

	if (fight.mode === 'stunned') {
		return { messages: [error('STUNNED', 'You are stunned — wait for the reboot')] };
	}
	if (fight.lockUntil && fight.lockUntil > at) {
		return {
			messages: [
				{
					type: 'boss.answerResult',
					correct: false,
					lockUntil: fight.lockUntil,
					message: `ANSWER LOCKED · ${Math.ceil((fight.lockUntil - at) / 1000)}s`
				}
			]
		};
	}

	const submitted = normalizeAnswer(answer);
	const correct = boss.answers.some((accepted) => normalizeAnswer(accepted) === submitted);
	if (!correct) {
		fight.hp = Math.min(fight.maxHp, fight.hp + fight.maxHp * (boss.wrongHealPercent / 100));
		fight.mode = 'typing';
		fight.lockUntil = lockFor(boss, fight.stunCount);
		house.answerLockUntil = fight.lockUntil;
		const messages: ServerMessage[] = [
			{
				type: 'boss.answerResult',
				correct: false,
				lockUntil: fight.lockUntil,
				message: 'ACCESS DENIED · boss recovered'
			}
		];
		const attack = await damagePlayer(house, boss, boss.counterDamage, true);
		if (attack) messages.push(attack);
		if (fight.playerHp <= 0) messages.push(stunPlayer(house, boss));
		await store.saveHouse(house);
		await audit({
			type: 'boss.answer.wrong',
			house: houseId,
			message: 'Wrong boss answer',
			data: { bossId: boss.id }
		});
		return { messages };
	}

	// Correct answer starts a timed audition. Only character classes are kept.
	const classes = [...submitted].map(charClass);
	fight.mode = 'audition';
	fight.attackAt = at + boss.attackEverySeconds * 1000;
	fight.audition = {
		classes,
		index: 0,
		length: classes.length,
		nextAt: at + (60 / Math.max(40, boss.bpm)) * 1000,
		beatMs: (60 / Math.max(40, boss.bpm)) * 1000,
		perHit: Math.max(1, (fight.hp - fight.maxHp * (boss.chipFloor || config.game.bossChipFloor)) / Math.max(1, classes.length)),
		combo: 0,
		move: null
	};
	await store.saveHouse(house);
	await audit({
		type: 'boss.answer.correct',
		house: houseId,
		message: 'Boss audition started',
		data: { bossId: boss.id, combo: classes.length }
	});

	return {
		messages: [
			{
				type: 'boss.answerResult',
				correct: true,
				lockUntil: null,
				message: 'ACCESS GRANTED · AUDITION'
			},
			{
				type: 'boss.audition',
				length: classes.length,
				beatSeconds: classes.length ? (60 / Math.max(40, boss.bpm)) : 0,
				bossHp: fight.hp,
				maxHp: fight.maxHp
			}
		]
	};
}

export async function setBossMode(houseId: HouseId, mode: 'typing' | 'attack'): Promise<BossResult> {
	const store = await getStore();
	const house = await store.getHouse(houseId);
	if (!house?.boss.active) return { messages: [] };
	if (house.boss.mode === 'stunned' || house.boss.mode === 'audition') return { messages: [] };
	house.boss.mode = mode;
	await store.saveHouse(house);
	return { messages: [] };
}

export async function swapBossPlayer(houseId: HouseId): Promise<BossResult> {
	const store = await getStore();
	const config = await liveConfig();
	const house = await store.getHouse(houseId);
	if (!house?.boss.active) return { messages: [error('NO_BOSS', 'No active boss fight')] };
	const boss = findBoss(config, house.boss.bossId);
	if (!boss) return { messages: [error('NO_BOSS', 'Boss config was changed mid-fight')] };
	const fight = house.boss;
	const at = now();
	if (fight.mode === 'stunned') return { messages: [error('STUNNED', 'You are stunned')] };
	if (at < fight.swapReadyAt) {
		return {
			messages: [
				{
					type: 'boss.swap',
					readyAt: fight.swapReadyAt,
					invulnUntil: fight.invulnUntil
				}
			]
		};
	}
	fight.invulnUntil = Math.max(fight.invulnUntil, at + boss.swapInvulnSeconds * 1000);
	fight.swapReadyAt = at + boss.swapCooldownSeconds * 1000;
	await store.saveHouse(house);
	return { messages: [{ type: 'boss.swap', readyAt: fight.swapReadyAt, invulnUntil: fight.invulnUntil }] };
}

async function finishBoss(house: HouseState, config: LiveConfig): Promise<ServerMessage[]> {
	const fight = house.boss;
	const boss = findBoss(config, fight.bossId);
	const floor = boss?.floor ?? floorForRoom(house.room);
	fight.active = false;
	fight.mode = 'idle';
	fight.hp = 0;
	fight.audition = null;
	fight.lockUntil = null;
	house.answerLockUntil = null;
	house.bossRetryAt = null;
	if (boss && !house.defeatedBosses.includes(boss.id)) house.defeatedBosses.push(boss.id);
	const allDefeated = config.boss.bosses.every((entry) => house.defeatedBosses.includes(entry.id));
	if (!allDefeated && floor < FLOOR_COUNT) {
		// Floors are strictly sequential: the lift only opens the next six plugs.
		house.room = roomForFloorPlug(floor + 1, 1);
	}
	house.status = allDefeated || floor >= FLOOR_COUNT ? 'solved' : 'open';

	const houses = await getStore().then((store) => store.listHouses());
	const sorted = [...houses].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	const place = sorted.findIndex((item) => item.id === house.id) + 1 || sorted.length;
	const points = Math.round(config.scoring.bossPoints * (1 + bonusPercent(place, config) / 100));
	house.score += points;

	return [
		{
			type: 'boss.end',
			won: true,
			score: house.score,
			bossHp: fight.hp,
			reason: 'win',
			floor
		},
		{ type: 'state', state: house },
		{
			type: 'notice',
			text: `${HOUSES[house.id].name} defeated ${boss?.name ?? 'the boss'}${
				allDefeated ? ' and escaped the backrooms' : ` · floor ${floor + 1} unlocked`
			}! +${points} points.`
		}
	];
}

/** Knockout cleanup: after the death delay, remove the player from the fight. */
async function finishBossLoss(house: HouseState, config: LiveConfig): Promise<ServerMessage[]> {
	const boss = findBoss(config, house.boss.bossId);
	const penalty = house.boss.penalty;
	const floor = boss?.floor ?? floorForRoom(house.room);
	const retryAt = now() + Math.max(0, config.game.bossRetryDelaySeconds) * 1000;
	house.boss = emptyBoss();
	house.answerLockUntil = null;
	house.bossRetryAt = retryAt;
	house.status = 'boss';

	return [
		{
			type: 'boss.end',
			won: false,
			score: house.score,
			bossHp: 0,
			reason: 'knockout',
			retryAt,
			floor
		},
		{ type: 'state', state: house },
		{
			type: 'notice',
			text: `${HOUSES[house.id].name} was knocked out of ${boss?.name ?? 'the boss'} · -${penalty} points · retry in ${config.game.bossRetryDelaySeconds}s.`
		}
	];
}

export interface BossTick {
	byHouse: Map<HouseId, ServerMessage[]>;
	progressChanged: boolean;
}

/** Drives timed boss attacks and audition hits. Called by the WebSocket server. */
export async function bossTick(): Promise<BossTick> {
	const store = await getStore();
	const config = await liveConfig();
	const houses = await store.listHouses();
	const byHouse = new Map<HouseId, ServerMessage[]>();
	let progressChanged = false;

	for (const house of houses) {
		if (!house.boss.active) continue;
		const boss = findBoss(config, house.boss.bossId);
		if (!boss) continue;
		const fight: BossState = house.boss;
		const at = now();
		const messages: ServerMessage[] = [];
		let dirty = false;

		if (fight.mode === 'stunned' && fight.stunUntil && at >= fight.stunUntil) {
			messages.push(...(await finishBossLoss(house, config)));
			dirty = true;
			progressChanged = true;
		}

		if (fight.mode === 'audition' && fight.audition) {
			const audition = fight.audition;
			while (at >= audition.nextAt && fight.mode === 'audition') {
				if (audition.index >= audition.length) {
					audition.move = 'FINISH!';
					fight.hp = 0;
					messages.push({
						type: 'boss.hit',
						move: audition.move,
						damage: Math.ceil(audition.perHit),
						bossHp: fight.hp,
						maxHp: fight.maxHp,
						combo: audition.combo + 1,
						finisher: true
					});
					messages.push(...(await finishBoss(house, config)));
					dirty = true;
					progressChanged = true;
					break;
				}
				const cls = audition.classes[audition.index] ?? 3;
				audition.index += 1;
				audition.combo += 1;
				audition.move = HOUSES[house.id].moves[cls] ?? HOUSES[house.id].moves[0] ?? 'HIT';
				fight.hp = Math.max(0, fight.hp - audition.perHit);
				audition.nextAt += audition.beatMs;
				messages.push({
					type: 'boss.hit',
					move: audition.move,
					damage: Math.round(audition.perHit),
					bossHp: Math.round(fight.hp),
					maxHp: fight.maxHp,
					combo: audition.combo
				});
				dirty = true;
				if (fight.hp <= 0) {
					messages.push(...(await finishBoss(house, config)));
					progressChanged = true;
					break;
				}
			}
		}

		if (house.boss.active && (fight.mode === 'typing' || fight.mode === 'attack') && at >= fight.attackAt) {
			fight.attackAt = at + boss.attackEverySeconds * 1000;
			const attack = await damagePlayer(house, boss, boss.attackDamage, false);
			if (attack) messages.push(attack);
			dirty = true;
			if (fight.playerHp <= 0) messages.push(stunPlayer(house, boss));
		}

		if (dirty) {
			await store.saveHouse(house);
			await audit({
				type: fight.active ? 'boss.tick' : 'boss.win',
				house: house.id,
				message: fight.active ? 'Boss fight tick' : 'Boss defeated',
				data: { bossId: boss.id, hp: Math.round(fight.hp) }
			});
		}
		if (messages.length) byHouse.set(house.id, messages);
	}

	return { byHouse, progressChanged };
}

export function resetMessage(state: HouseState, reason: string): ServerMessage {
	return {
		type: 'boss.reset',
		bossId: state.boss.bossId,
		hp: state.boss.hp,
		maxHp: state.boss.maxHp,
		reason
	};
}

export function activeStart(state: HouseState, config: LiveConfig): ServerMessage | null {
	if (!state.boss.active) return null;
	const boss = findBoss(config, state.boss.bossId);
	return boss ? bossStart(state, boss) : null;
}

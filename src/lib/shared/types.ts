/** Shared domain types. Safe to import from both client and server. */

export const HOUSE_IDS = ['h1', 'h2', 'h3'] as const;
export type HouseId = (typeof HOUSE_IDS)[number];

export type Animal = 'scorpion' | 'elephant' | 'octopus';

export interface HouseDefinition {
	id: HouseId;
	animal: Animal;
	name: string;
	color: string;
	accent: string;
	moves: readonly string[];
}

export const HOUSES: Record<HouseId, HouseDefinition> = {
	h1: {
		id: 'h1',
		animal: 'scorpion',
		name: 'Scorpion',
		color: '#f5a623',
		accent: '#f7d000',
		moves: ['tail stab', 'claw pinch', 'poison']
	},
	h2: {
		id: 'h2',
		animal: 'elephant',
		name: 'Elephant',
		color: '#8c9299',
		accent: '#c9ced4',
		moves: ['ground stomp', 'trunk swipe', 'water spray']
	},
	h3: {
		id: 'h3',
		animal: 'octopus',
		name: 'Octopus',
		color: '#8b5cf6',
		accent: '#c4b5fd',
		moves: ['tentacle whip', 'ink spray', 'whirlpool']
	}
};

export type GamePhase = 'lobby' | 'playing' | 'boss' | 'ended';
export type PlugStatus = 'locked' | 'open' | 'solved';
/** Kept as an alias so older config/state files still typecheck. */
export type RoomStatus = PlugStatus;
export type CharacterType = 'vowel' | 'consonant' | 'digit' | 'symbol';
export type SpectatorSkin = 'fire' | 'water';

export type QuestionCategory = 'network' | 'sport' | 'general';

export interface Question {
	id: string;
	category: QuestionCategory;
	question: string;
	answer: string;
	acceptedAnswers: readonly string[];
	hint?: string;
}

export interface ScoreRow {
	house: HouseId;
	score: number;
	/** Internal global plug counter; UI should render floor + plug. */
	room: number;
	floor: number;
	plug: number;
	hp: number | null;
}

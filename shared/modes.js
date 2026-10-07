import { RULES } from './constants.js';

// Online match modes. DUEL is the 1v1 room (starts as soon as both players are in); FFA and TEAMS
// are group rooms of up to `max` players that the host starts. `goals` are kills to win: per
// player in DUEL and FFA, per team in TEAMS.
export const MODES = {
  duel: { name: 'DUEL', max: 2, goals: RULES.GOALS, goal: 5 },
  ffa: { name: 'FREE FOR ALL', max: 8, goals: [5, 10, 20], goal: 10 },
  teams: { name: 'TEAMS', max: 8, goals: [10, 20, 30], goal: 20 },
};
export const GROUP_MODES = ['ffa', 'teams'];
export const GROUP_MAX = 8;

export const TEAM_NAMES = ['ORANGE', 'BLUE'];
export const TEAM_COLORS = ['#ff7b22', '#4d8bff'];

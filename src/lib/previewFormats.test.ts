// Self-contained verification for previewFormats(). Run with:
//   npx tsx src/lib/previewFormats.test.ts
// or just read the assertions as documentation.

import { previewFormats, splitPoolSizes } from './formatPreview';

function assertEq<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.assert(ok, `[FAIL] ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  if (ok) console.log(`[ok] ${label}`);
}

// --- splitPoolSizes ---------------------------------------------------------

assertEq(splitPoolSizes(7, 2), [4, 3], 'splitPoolSizes(7, 2) = [4, 3]');
assertEq(splitPoolSizes(9, 2), [5, 4], 'splitPoolSizes(9, 2) = [5, 4]');
assertEq(splitPoolSizes(10, 2), [5, 5], 'splitPoolSizes(10, 2) = [5, 5]');
assertEq(splitPoolSizes(10, 3), [4, 3, 3], 'splitPoolSizes(10, 3) = [4, 3, 3]');
assertEq(splitPoolSizes(12, 3), [4, 4, 4], 'splitPoolSizes(12, 3) = [4, 4, 4]');

// --- N = 2 ------------------------------------------------------------------

const f2 = previewFormats(2);
// RR + SE only (no pool option for N < 6)
assertEq(f2.length, 2, 'N=2 returns 2 options (RR + SE)');
assertEq(f2[0], { format: 'round_robin', gamesPerTeam: 1, totalMatches: 1, rounds: 1, hasByes: false }, 'N=2 RR');
assertEq(f2[1], { format: 'single_elimination', gamesPerTeamMin: 1, gamesPerTeamMax: 1, totalMatches: 1, rounds: 1, byes: 0 }, 'N=2 SE');

// --- N = 3 ------------------------------------------------------------------

const f3 = previewFormats(3);
assertEq(f3.length, 2, 'N=3 returns 2 options');
assertEq(f3[0], { format: 'round_robin', gamesPerTeam: 2, totalMatches: 3, rounds: 3, hasByes: true }, 'N=3 RR');
// SE: bracketSize=4, byes=1, rounds=2, totalMatches=2
assertEq(f3[1], { format: 'single_elimination', gamesPerTeamMin: 1, gamesPerTeamMax: 2, totalMatches: 2, rounds: 2, byes: 1 }, 'N=3 SE');

// --- N = 4 ------------------------------------------------------------------

const f4 = previewFormats(4);
assertEq(f4.length, 2, 'N=4 returns 2 options');
assertEq(f4[0], { format: 'round_robin', gamesPerTeam: 3, totalMatches: 6, rounds: 3, hasByes: false }, 'N=4 RR');
assertEq(f4[1], { format: 'single_elimination', gamesPerTeamMin: 1, gamesPerTeamMax: 2, totalMatches: 3, rounds: 2, byes: 0 }, 'N=4 SE');

// --- N = 7 (the worked example) --------------------------------------------

const f7 = previewFormats(7);
assertEq(f7.length, 3, 'N=7 returns 3 options (RR + SE + P2B)');
assertEq(f7[0], { format: 'round_robin', gamesPerTeam: 6, totalMatches: 21, rounds: 7, hasByes: true }, 'N=7 RR');
// SE: bracketSize=8, byes=1, rounds=3, totalMatches=6
assertEq(f7[1], { format: 'single_elimination', gamesPerTeamMin: 1, gamesPerTeamMax: 3, totalMatches: 6, rounds: 3, byes: 1 }, 'N=7 SE');
// P2B: 2 pools (4 + 3), advance=2 -> 4 advancing, bracket size 4, bracketMatches=3
//   pool matches: C(4,2) + C(3,2) = 6 + 3 = 9
//   total = 9 + 3 = 12
//   poolGamesPerTeamMin = 3-1 = 2, max = 4-1 = 3
assertEq(f7[2], {
  format: 'pool_to_bracket',
  pools: { count: 2, sizes: [4, 3], advance: 2 },
  poolGamesPerTeamMin: 2,
  poolGamesPerTeamMax: 3,
  bracketMatches: 3,
  totalMatches: 12,
}, 'N=7 P2B');

// --- N = 8 ------------------------------------------------------------------

const f8 = previewFormats(8);
assertEq(f8.length, 3, 'N=8 returns 3 options');
assertEq(f8[0], { format: 'round_robin', gamesPerTeam: 7, totalMatches: 28, rounds: 7, hasByes: false }, 'N=8 RR');
assertEq(f8[1], { format: 'single_elimination', gamesPerTeamMin: 1, gamesPerTeamMax: 3, totalMatches: 7, rounds: 3, byes: 0 }, 'N=8 SE');
// P2B: 2 pools of 4, advance=2 -> 4 advancing, bracketMatches=3
//   pool matches: 6 + 6 = 12, total = 15
assertEq(f8[2], {
  format: 'pool_to_bracket',
  pools: { count: 2, sizes: [4, 4], advance: 2 },
  poolGamesPerTeamMin: 3,
  poolGamesPerTeamMax: 3,
  bracketMatches: 3,
  totalMatches: 15,
}, 'N=8 P2B');

// --- N = 16 -----------------------------------------------------------------

const f16 = previewFormats(16);
assertEq(f16.length, 3, 'N=16 returns 3 options');
assertEq(f16[0], { format: 'round_robin', gamesPerTeam: 15, totalMatches: 120, rounds: 15, hasByes: false }, 'N=16 RR');
assertEq(f16[1], { format: 'single_elimination', gamesPerTeamMin: 1, gamesPerTeamMax: 4, totalMatches: 15, rounds: 4, byes: 0 }, 'N=16 SE');
// 16 teams -> 3 pools (per defaultPoolCount: 13-18 -> 3). splitPoolSizes(16,3) = [6,5,5]
// advance=2 -> 6 advancing, bracketSize=8, bracketMatches=5
// pool matches: C(6,2) + C(5,2) + C(5,2) = 15 + 10 + 10 = 35, total = 40
assertEq(f16[2], {
  format: 'pool_to_bracket',
  pools: { count: 3, sizes: [6, 5, 5], advance: 2 },
  poolGamesPerTeamMin: 4,
  poolGamesPerTeamMax: 5,
  bracketMatches: 5,
  totalMatches: 40,
}, 'N=16 P2B');

console.log('\nDone.');

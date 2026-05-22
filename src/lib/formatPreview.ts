// Pure math for previewing tournament formats given a team count.
// No DB access. Used by the format chooser UI before generation.

export type RoundRobinPreview = {
  format: 'round_robin';
  gamesPerTeam: number;
  totalMatches: number;
  rounds: number;
  hasByes: boolean;
};

export type SingleEliminationPreview = {
  format: 'single_elimination';
  gamesPerTeamMin: number;
  gamesPerTeamMax: number;
  totalMatches: number;
  rounds: number;
  byes: number;
};

export type PoolToBracketPreview = {
  format: 'pool_to_bracket';
  pools: { count: number; sizes: number[]; advance: number };
  poolGamesPerTeamMin: number;
  poolGamesPerTeamMax: number;
  bracketMatches: number;
  totalMatches: number;
};

export type FormatOption =
  | RoundRobinPreview
  | SingleEliminationPreview
  | PoolToBracketPreview;

// Split N teams into `poolCount` pools, as even as possible. Larger pools
// come first: e.g. splitPoolSizes(7, 2) = [4, 3], splitPoolSizes(10, 3) = [4, 3, 3].
export function splitPoolSizes(teamCount: number, poolCount: number): number[] {
  const base = Math.floor(teamCount / poolCount);
  const remainder = teamCount % poolCount;
  const sizes: number[] = [];
  for (let i = 0; i < poolCount; i++) {
    sizes.push(base + (i < remainder ? 1 : 0));
  }
  return sizes;
}

// Default number of pools for a given team count. Spec:
//  - 2 pools for 6-12 teams
//  - 3 pools for 13-18
//  - 4 pools for 19+
//  - undefined for <6 (RR is fine, no pool option)
export function defaultPoolCount(teamCount: number): number | null {
  if (teamCount < 6) return null;
  if (teamCount <= 12) return 2;
  if (teamCount <= 18) return 3;
  return 4;
}

function nextPowerOfTwo(n: number): number {
  if (n < 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function log2Int(n: number): number {
  // n is a power of 2; return its log2.
  let r = 0;
  let v = n;
  while (v > 1) {
    v >>= 1;
    r += 1;
  }
  return r;
}

function previewRoundRobin(teamCount: number): RoundRobinPreview {
  const n = teamCount;
  const gamesPerTeam = n - 1;
  const totalMatches = (n * (n - 1)) / 2;
  // Circle method: N-1 rounds if N is even, N rounds if N is odd (one bye/round).
  const rounds = n % 2 === 0 ? n - 1 : n;
  const hasByes = n % 2 !== 0;
  return {
    format: 'round_robin',
    gamesPerTeam,
    totalMatches,
    rounds,
    hasByes,
  };
}

function previewSingleElimination(teamCount: number): SingleEliminationPreview {
  const n = teamCount;
  const bracketSize = nextPowerOfTwo(n);
  const byes = bracketSize - n;
  const rounds = log2Int(bracketSize);
  const totalMatches = n - 1; // standard for any single-elim with byes
  // Min: a team that played round 1 (no bye) and lost in round 1 -> 1 game.
  //      If N == 1, degenerate; but we don't preview for N < 2.
  // Max: champion plays every round = `rounds`.
  const gamesPerTeamMin = n >= 2 ? 1 : 0;
  const gamesPerTeamMax = rounds;
  return {
    format: 'single_elimination',
    gamesPerTeamMin,
    gamesPerTeamMax,
    totalMatches,
    rounds,
    byes,
  };
}

function previewPoolToBracket(
  teamCount: number,
  poolCount: number,
  advance: number,
): PoolToBracketPreview | null {
  // Need at least `poolCount` teams (one per pool) and enough teams to fill
  // advance slots; bracket needs >= 2 teams.
  if (teamCount < poolCount * 2) return null;
  const sizes = splitPoolSizes(teamCount, poolCount);
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const poolGamesPerTeamMin = minSize - 1;
  const poolGamesPerTeamMax = maxSize - 1;

  const advancing = poolCount * advance;
  if (advancing < 2) return null;
  const bracketSize = nextPowerOfTwo(advancing);
  const bracketMatches = advancing - 1; // byes don't generate matches

  // Total pool matches = sum over pools of C(size, 2)
  const poolMatches = sizes.reduce((acc, s) => acc + (s * (s - 1)) / 2, 0);
  const totalMatches = poolMatches + bracketMatches;

  return {
    format: 'pool_to_bracket',
    pools: { count: poolCount, sizes, advance },
    poolGamesPerTeamMin,
    poolGamesPerTeamMax,
    bracketMatches,
    totalMatches,
    // (bracketSize captured implicitly by `nextPowerOfTwo(advancing)`; not surfaced)
  } as PoolToBracketPreview & { _bracketSize?: number };
}

export function previewFormats(teamCount: number): FormatOption[] {
  if (teamCount < 2) return [];
  const options: FormatOption[] = [];
  options.push(previewRoundRobin(teamCount));
  options.push(previewSingleElimination(teamCount));
  const poolCount = defaultPoolCount(teamCount);
  if (poolCount !== null) {
    const p2b = previewPoolToBracket(teamCount, poolCount, 2);
    if (p2b !== null) options.push(p2b);
  }
  return options;
}

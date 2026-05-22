// Pure match-generation functions. No DB access; the caller persists the rows.
// All bracket plumbing (`next_match_id`) is wired via `localId` strings so the
// caller can resolve real Supabase UUIDs after insert (or insert with the
// local UUID, since the schema doesn't constrain to DB-generated IDs).

export type MatchPayload = {
  division_id: string;
  stage: 'round_robin' | 'pool' | 'bracket';
  pool_id: string | null;
  round_number: number | null; // round-robin / pool rotation round
  bracket_round: number | null;
  bracket_slot: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
  court_id: string | null;
  status: 'pending';
  next_match_id: string | null; // local UUID resolved client-side
  next_match_slot: 'a' | 'b' | null;
};

// Assigns court_id to each match round-by-round. Two matches in the same
// round can never run on the same court (physical impossibility), so within
// each round we hand out the first `courtIds.length` courts and leave the
// rest at null — the admin assigns those at game time when an earlier match
// frees up. Rounds beyond capacity get null too.
//
// `round` is derived from `round_number` (RR / pool rotation) or
// `bracket_round` (bracket) — both can't be set together.
function assignCourtsInRotation(
  matches: (MatchPayload & { localId: string })[],
  courtIds: string[],
): void {
  if (courtIds.length === 0) {
    matches.forEach((m) => { m.court_id = null; });
    return;
  }
  const byRound = new Map<number, (MatchPayload & { localId: string })[]>();
  for (const m of matches) {
    const r = m.round_number ?? m.bracket_round ?? 0;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r)!.push(m);
  }
  for (const [, roundMatches] of byRound) {
    roundMatches.forEach((m, i) => {
      m.court_id = i < courtIds.length ? courtIds[i] : null;
    });
  }
}

// Greedy home/away picker. For each pairing, the team that has been HOME
// fewer times so far gets HOME. Ties go to `a` (the position-0 side of the
// circle method, which is usually the lower-seeded slot — stable & predictable).
// Spread is bounded at 1: each team is HOME between floor((N-1)/2) and
// ceil((N-1)/2) times across a complete round-robin.
function pickHome(
  a: string,
  b: string,
  homeCount: Map<string, number>,
): { home: string; away: string } {
  const aCount = homeCount.get(a) ?? 0;
  const bCount = homeCount.get(b) ?? 0;
  const home = aCount <= bCount ? a : b;
  const away = home === a ? b : a;
  homeCount.set(home, (homeCount.get(home) ?? 0) + 1);
  return { home, away };
}

// Splits a court list across pools as evenly as possible.
// 4 courts / 2 pools → [[c1, c2], [c3, c4]]
// 5 courts / 2 pools → [[c1, c2, c3], [c4, c5]]   (extras go to lower-index pools)
// 2 courts / 3 pools → [[c1], [c2], [c1]]         (cycles when courts < pools)
// 0 courts / N pools → array of empty arrays.
function splitCourtsAmongPools(courtIds: string[], poolCount: number): string[][] {
  if (poolCount <= 0) return [];
  if (courtIds.length === 0) return Array.from({ length: poolCount }, () => []);
  const result: string[][] = Array.from({ length: poolCount }, () => []);
  if (courtIds.length >= poolCount) {
    const base = Math.floor(courtIds.length / poolCount);
    const extras = courtIds.length % poolCount;
    let idx = 0;
    for (let p = 0; p < poolCount; p++) {
      const size = base + (p < extras ? 1 : 0);
      result[p] = courtIds.slice(idx, idx + size);
      idx += size;
    }
  } else {
    for (let p = 0; p < poolCount; p++) {
      result[p] = [courtIds[p % courtIds.length]];
    }
  }
  return result;
}

export type GenerationResult = {
  pools?: { name: string; localId: string; team_ids: string[] }[];
  matches: (MatchPayload & { localId: string })[];
};

// ---------------------------------------------------------------------------
// localId generator. RN doesn't reliably ship `crypto.randomUUID`; we just
// need a stable, unique-within-this-call string to wire pointers.
// ---------------------------------------------------------------------------

let _localIdCounter = 0;
function nextLocalId(prefix = 'lid'): string {
  _localIdCounter += 1;
  // Add a random suffix so concurrent generation runs don't collide on persistence
  // payloads stitched together later.
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${_localIdCounter}-${rand}`;
}

// ---------------------------------------------------------------------------
// Round-robin (circle method).
// ---------------------------------------------------------------------------

export function generateRoundRobin(
  divisionId: string,
  teamIds: string[],
  courtIds: string[],
): GenerationResult {
  const matches: (MatchPayload & { localId: string })[] = [];
  if (teamIds.length < 2) return { matches };

  // Circle method. Append a sentinel `null` (BYE) if odd.
  const ring: (string | null)[] = [...teamIds];
  if (ring.length % 2 !== 0) ring.push(null);
  const size = ring.length;
  const roundsCount = size - 1;

  // Track HOME appearances so we can balance fairly across the tournament.
  const homeCount = new Map<string, number>();
  for (const tid of teamIds) homeCount.set(tid, 0);

  // Fix ring[0]; rotate ring[1..] each round.
  for (let r = 0; r < roundsCount; r++) {
    for (let i = 0; i < size / 2; i++) {
      const a = ring[i];
      const b = ring[size - 1 - i];
      if (a === null || b === null) continue;
      const { home, away } = pickHome(a, b, homeCount);
      matches.push({
        localId: nextLocalId('rr'),
        division_id: divisionId,
        stage: 'round_robin',
        pool_id: null,
        round_number: r + 1,
        bracket_round: null,
        bracket_slot: null,
        team_a_id: home,
        team_b_id: away,
        court_id: null,
        status: 'pending',
        next_match_id: null,
        next_match_slot: null,
      });
    }
    // Rotate ring[1..] right by one.
    const last = ring[size - 1];
    for (let i = size - 1; i > 1; i--) ring[i] = ring[i - 1];
    ring[1] = last as string | null;
  }

  assignCourtsInRotation(matches, courtIds);
  return { matches };
}

// ---------------------------------------------------------------------------
// Single-elimination bracket. Standard seed-ordered layout so #1 plays the
// lowest seed in round 1, etc.
// ---------------------------------------------------------------------------

function nextPowerOfTwo(n: number): number {
  if (n < 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function log2Int(n: number): number {
  let r = 0;
  let v = n;
  while (v > 1) {
    v >>= 1;
    r += 1;
  }
  return r;
}

// Recursive seed-pair list. seedOrder(B) returns an array of length B where
// position i (0-indexed) is the seed (1-indexed) that goes into round-1 slot i.
// Pairs sum to B+1: [1, B, B/2+1, B/2, ...].
function seedOrder(bracketSize: number): number[] {
  if (bracketSize === 1) return [1];
  const half = seedOrder(bracketSize / 2);
  const out: number[] = [];
  for (const s of half) {
    out.push(s);
    out.push(bracketSize + 1 - s);
  }
  return out;
}

// Generic single-elim builder shared by `generateSingleElimination` and the
// bracket portion of `generatePoolToBracket`. `slotTeamIds` is an array of
// length bracketSize where each entry is either a team id, null (BYE), or
// undefined (filled later — for the pool→bracket case, where bracket teams
// are decided after pool play).
function buildEliminationBracket(
  divisionId: string,
  bracketSize: number,
  slotTeamIds: (string | null | undefined)[],
  startingRound = 1,
): (MatchPayload & { localId: string })[] {
  const matches: (MatchPayload & { localId: string })[] = [];
  if (bracketSize < 2) return matches;
  const totalRounds = log2Int(bracketSize);

  // matchesByRound[round-1][slot-1] = localId
  const matchesByRound: string[][] = [];

  for (let r = 1; r <= totalRounds; r++) {
    const slotsInRound = bracketSize / Math.pow(2, r);
    const ids: string[] = [];
    for (let s = 1; s <= slotsInRound; s++) {
      const localId = nextLocalId('br');
      ids.push(localId);
      let teamA: string | null | undefined = null;
      let teamB: string | null | undefined = null;
      if (r === 1) {
        const aIdx = (s - 1) * 2;
        const bIdx = (s - 1) * 2 + 1;
        teamA = slotTeamIds[aIdx];
        teamB = slotTeamIds[bIdx];
      }
      matches.push({
        localId,
        division_id: divisionId,
        stage: 'bracket',
        pool_id: null,
        round_number: null,
        bracket_round: startingRound + r - 1,
        bracket_slot: s,
        team_a_id: teamA === undefined ? null : teamA,
        team_b_id: teamB === undefined ? null : teamB,
        court_id: null,
        status: 'pending',
        next_match_id: null,
        next_match_slot: null,
      });
    }
    matchesByRound.push(ids);
  }

  // Wire next_match_id / next_match_slot.
  for (let r = 1; r < totalRounds; r++) {
    const slotsInRound = bracketSize / Math.pow(2, r);
    for (let s = 1; s <= slotsInRound; s++) {
      const localId = matchesByRound[r - 1][s - 1];
      const parentSlot = Math.ceil(s / 2);
      const parentLocalId = matchesByRound[r][parentSlot - 1];
      const parentChildSlot: 'a' | 'b' = s % 2 === 1 ? 'a' : 'b';
      const m = matches.find((x) => x.localId === localId)!;
      m.next_match_id = parentLocalId;
      m.next_match_slot = parentChildSlot;
    }
  }

  // BYE auto-advancement: if a round-1 match has exactly one null team, set
  // the parent slot directly. We leave the round-1 match itself with the
  // null slot in place; downstream code (or admin) can mark it as a bye/
  // 'reported' later. Per spec recommendation we advance at generation.
  if (slotTeamIds.some((x) => x === null)) {
    const round1Slots = bracketSize / 2;
    for (let s = 1; s <= round1Slots; s++) {
      const m = matches.find((x) => x.bracket_round === startingRound && x.bracket_slot === s);
      if (!m) continue;
      const aIsBye = m.team_a_id === null;
      const bIsBye = m.team_b_id === null;
      if (aIsBye === bIsBye) continue; // either both filled or both byes (shouldn't happen)
      const propagating = aIsBye ? m.team_b_id : m.team_a_id;
      if (propagating == null) continue;
      if (m.next_match_id != null) {
        const parent = matches.find((x) => x.localId === m.next_match_id);
        if (parent != null && m.next_match_slot != null) {
          if (m.next_match_slot === 'a') parent.team_a_id = propagating;
          else parent.team_b_id = propagating;
        }
      }
    }
  }

  return matches;
}

export function generateSingleElimination(
  divisionId: string,
  teamIds: string[],
  courtIds: string[],
): GenerationResult {
  if (teamIds.length < 2) return { matches: [] };
  const n = teamIds.length;
  const bracketSize = nextPowerOfTwo(n);
  const order = seedOrder(bracketSize); // 1-indexed seeds for slots 0..bracketSize-1

  // Assign top `bracketSize - n` seeds a bye. Build slot list of team ids.
  const slotTeamIds: (string | null)[] = order.map((seed) => {
    // seed is 1..bracketSize. teamIds[0] = seed 1, teamIds[n-1] = seed n.
    if (seed <= n) return teamIds[seed - 1];
    return null; // BYE
  });

  const matches = buildEliminationBracket(divisionId, bracketSize, slotTeamIds, 1);
  assignCourtsInRotation(matches, courtIds);
  return { matches };
}

// ---------------------------------------------------------------------------
// Pool → bracket. Snake-draft into pools, RR within each pool, then build
// a bracket with placeholder team slots that get filled in after pool play.
// Cross-pool seeding (1A vs 2B / 1B vs 2A) is approximated by ordering
// advancers as "all firsts, then all seconds, ..." and applying standard
// bracket layout — see docs/match-generation.md.
// ---------------------------------------------------------------------------

export function generatePoolToBracket(
  divisionId: string,
  teamIds: string[],
  pools: { count: number; sizes: number[]; advance: number },
  courtIds: string[],
): GenerationResult {
  const matches: (MatchPayload & { localId: string })[] = [];
  const poolRows: { name: string; localId: string; team_ids: string[] }[] = [];
  const { count: poolCount, sizes, advance } = pools;

  if (teamIds.length < poolCount * 2 || advance < 1) {
    return { matches, pools: poolRows };
  }
  const totalExpected = sizes.reduce((a, b) => a + b, 0);
  if (totalExpected !== teamIds.length) {
    // Pool sizes don't match team count — caller bug. Fail soft with no matches.
    return { matches, pools: poolRows };
  }

  // 1. Snake draft into pools by seed order.
  //    Pass 0 fills pool[0..poolCount-1] in order; pass 1 reverses; etc.
  const poolTeams: string[][] = Array.from({ length: poolCount }, () => []);
  let seedIdx = 0;
  let pass = 0;
  while (seedIdx < teamIds.length) {
    const dir = pass % 2 === 0 ? 1 : -1;
    const start = pass % 2 === 0 ? 0 : poolCount - 1;
    for (
      let p = start;
      seedIdx < teamIds.length && p >= 0 && p < poolCount;
      p += dir
    ) {
      // Respect per-pool capacity from `sizes` (which may differ when teams
      // don't divide evenly).
      if (poolTeams[p].length >= sizes[p]) continue;
      poolTeams[p].push(teamIds[seedIdx]);
      seedIdx += 1;
    }
    pass += 1;
    if (pass > poolCount * 4) break; // safety
  }

  // Split courts among pools (e.g. 4 courts / 2 pools → Pool A on Courts 1-2,
  // Pool B on Courts 3-4). Bracket matches use all courts (pool play is done
  // by then so the venue is free).
  const courtsPerPool = splitCourtsAmongPools(courtIds, poolCount);

  // 2. Build pool rows and per-pool round-robin matches.
  for (let p = 0; p < poolCount; p++) {
    const poolLocalId = nextLocalId('pool');
    const name = `Pool ${String.fromCharCode(65 + p)}`;
    poolRows.push({ name, localId: poolLocalId, team_ids: poolTeams[p] });

    // Circle method, but with stage='pool' and pool_id set.
    const ring: (string | null)[] = [...poolTeams[p]];
    if (ring.length < 2) continue;
    if (ring.length % 2 !== 0) ring.push(null);
    const size = ring.length;
    const roundsCount = size - 1;
    const poolMatches: (MatchPayload & { localId: string })[] = [];

    // Per-pool home count (each pool is its own round-robin).
    const homeCount = new Map<string, number>();
    for (const tid of poolTeams[p]) homeCount.set(tid, 0);

    for (let r = 0; r < roundsCount; r++) {
      for (let i = 0; i < size / 2; i++) {
        const a = ring[i];
        const b = ring[size - 1 - i];
        if (a === null || b === null) continue;
        const { home, away } = pickHome(a, b, homeCount);
        poolMatches.push({
          localId: nextLocalId('pm'),
          division_id: divisionId,
          stage: 'pool',
          pool_id: poolLocalId,
          round_number: r + 1,
          bracket_round: null,
          bracket_slot: null,
          team_a_id: home,
          team_b_id: away,
          court_id: null,
          status: 'pending',
          next_match_id: null,
          next_match_slot: null,
        });
      }
      const last = ring[size - 1];
      for (let i = size - 1; i > 1; i--) ring[i] = ring[i - 1];
      ring[1] = last as string | null;
    }
    // Assign court_ids by rotating through THIS pool's courts only.
    assignCourtsInRotation(poolMatches, courtsPerPool[p]);
    matches.push(...poolMatches);
  }

  // 3. Build the bracket. Bracket teams are unknown at generation time, so
  //    we pass `undefined` for every slot. (BYEs for non-power-of-2 brackets
  //    are represented as `null` and propagate as usual; placeholders that
  //    will be filled at promotion time are `undefined`.)
  const advancing = poolCount * advance;
  if (advancing >= 2) {
    const bracketSize = nextPowerOfTwo(advancing);
    const order = seedOrder(bracketSize); // 1..bracketSize
    // The top `advancing` seeds are placeholders (undefined); the rest are byes (null).
    const slotEntries: (string | null | undefined)[] = order.map((seed) => {
      if (seed <= advancing) return undefined; // placeholder pool finisher
      return null; // BYE
    });
    const bracketMatches = buildEliminationBracket(divisionId, bracketSize, slotEntries, 1);
    // Bracket matches rotate through ALL courts — pool play is finished by
    // then, so the whole venue is available.
    assignCourtsInRotation(bracketMatches, courtIds);
    matches.push(...bracketMatches);
  }

  return { matches, pools: poolRows };
}

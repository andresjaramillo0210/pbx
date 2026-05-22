// Shared division-level operations that need to be invocable from multiple
// screens (tournament detail card row + division detail Operations section).
// These functions take a divisionId, run the operation against Supabase, and
// return a discriminated result so callers can drive their own UI state.
//
// Logic mirrors the in-memory court-assignment helpers in `generateMatches.ts`
// but operates on already-persisted match rows. We deliberately duplicate the
// `splitCourtsAmongPools` helper here rather than import it: the in-memory
// generator works on `MatchPayload[]` keyed by `localId`; here we work on real
// match rows keyed by `id`. Keeping the two paths separate avoids over-coupling
// (the generator may evolve its payload shape; this module shouldn't care).
import { supabase } from './supabase';

type DivisionFormat = 'round_robin' | 'pool_to_bracket' | 'single_elimination';

type DivisionRow = {
  id: string;
  tournament_id: string;
  format: DivisionFormat | null;
};

type DivisionCourtRow = {
  court_id: string;
  display_order: number;
  courts: { id: string; name: string } | null;
};

type MatchRow = {
  id: string;
  stage: 'round_robin' | 'pool' | 'bracket';
  pool_id: string | null;
  court_id: string | null;
  status: string;
  round_number: number | null;
  bracket_round: number | null;
};

type PoolRow = { id: string; name: string };

export type ReassignResult =
  | { ok: true; updated: number }
  | { ok: false; error: string };

export type RegenerateResult =
  | { ok: true }
  | { ok: false; error: string };

export type ReportMatchResult =
  | { ok: true }
  | { ok: false; error: string };

type ScoreInputGame = { score_a: number; score_b: number };

type ReportMatchInput = {
  matchId: string;
  games: ScoreInputGame[];
};

type MatchForReport = {
  id: string;
  division_id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
  next_match_id: string | null;
  next_match_slot: 'a' | 'b' | null;
  winner_team_id: string | null;
};

type DivisionScoringRules = {
  id: string;
  best_of: number;
  game_to: number;
  win_by: number;
};

type DownstreamMatch = {
  id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
};

// Report a score for a match from an inline (or any) UI without the heavy
// edge-case handling (forfeit, reset, cascade) in the full score screen.
//
// Pipeline mirrors `app/(admin)/.../matches/[matchId]/score.tsx`:
//  1. Fetch match + division (need scoring rules + bracket pointer).
//  2. Validate each game: non-negative integers, no ties, winner reaches
//     game_to and wins by win_by.
//  3. Best-of validation: ceil(best_of/2) game wins required for one team
//     and not both. For bo1, exactly one game.
//  4. Determine winner_team_id from per-team game-wins tally.
//  5. Insert score_events audit row (entered_by = auth.uid()).
//  6. Replace match_games rows (delete then insert) so re-scoring works.
//  7. Mark matches.status='reported' with winner_team_id + ended_at.
//  8. Bracket advance: if next_match_id is set and the corresponding slot
//     is empty, fill it with the winner. If the slot is already filled
//     with a DIFFERENT team (re-score case that would cascade), bail with
//     an error pointing the admin to the full score screen — that screen
//     owns the cascade-revert/void prompts.
//
// Returns `{ ok: true }` on success or `{ ok: false, error }` otherwise.
export async function reportMatch(input: ReportMatchInput): Promise<ReportMatchResult> {
  const { matchId, games } = input;
  if (!matchId) return { ok: false, error: 'Missing matchId.' };
  if (!games || games.length === 0) {
    return { ok: false, error: 'Enter at least one game score.' };
  }

  // 1. Fetch the match.
  const mRes = await supabase
    .from('matches')
    .select(
      'id, division_id, team_a_id, team_b_id, status, next_match_id, next_match_slot, winner_team_id',
    )
    .eq('id', matchId)
    .maybeSingle();
  if (mRes.error) return { ok: false, error: mRes.error.message };
  const match = mRes.data as MatchForReport | null;
  if (!match) return { ok: false, error: 'Match not found.' };
  if (!match.team_a_id || !match.team_b_id) {
    return { ok: false, error: 'Match has no opponents to score.' };
  }

  // 2. Fetch the division for scoring rules.
  const dRes = await supabase
    .from('divisions')
    .select('id, best_of, game_to, win_by')
    .eq('id', match.division_id)
    .maybeSingle();
  if (dRes.error) return { ok: false, error: dRes.error.message };
  const division = dRes.data as DivisionScoringRules | null;
  if (!division) return { ok: false, error: 'Division not found.' };

  // 3. Validate the games.
  if (games.length > division.best_of) {
    return {
      ok: false,
      error: `Best-of-${division.best_of}: too many games entered.`,
    };
  }

  let aWins = 0;
  let bWins = 0;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const n = i + 1;
    if (!Number.isInteger(g.score_a) || !Number.isInteger(g.score_b) || g.score_a < 0 || g.score_b < 0) {
      return { ok: false, error: `Game ${n}: scores must be non-negative integers.` };
    }
    if (g.score_a === g.score_b) {
      return { ok: false, error: `Game ${n}: a game cannot end tied.` };
    }
    const hi = Math.max(g.score_a, g.score_b);
    const lo = Math.min(g.score_a, g.score_b);
    if (hi < division.game_to) {
      return {
        ok: false,
        error: `Game ${n}: winner must reach at least ${division.game_to}.`,
      };
    }
    if (hi - lo < division.win_by) {
      return {
        ok: false,
        error: `Game ${n}: must win by ${division.win_by} (got ${hi}-${lo}).`,
      };
    }
    if (g.score_a > g.score_b) aWins++;
    else bWins++;
  }

  // 4. Best-of validation.
  const required = Math.ceil(division.best_of / 2);
  if (division.best_of === 1) {
    if (aWins + bWins !== 1) {
      return { ok: false, error: 'Best-of-1: enter exactly one game.' };
    }
  } else {
    if (aWins < required && bWins < required) {
      return {
        ok: false,
        error: `Best-of-${division.best_of}: one team must win ${required} games.`,
      };
    }
    if (aWins >= required && bWins >= required) {
      return {
        ok: false,
        error: `Best-of-${division.best_of}: only one team should reach ${required} game wins.`,
      };
    }
  }

  const winnerTeamId = aWins > bWins ? match.team_a_id : match.team_b_id;

  // 5. Insert score_events audit row.
  const userRes = await supabase.auth.getUser();
  const userId = userRes.data.user?.id ?? null;
  const evtRes = await supabase.from('score_events').insert({
    match_id: match.id,
    entered_by: userId,
    payload: {
      games: games.map((g, i) => ({ n: i + 1, a: g.score_a, b: g.score_b })),
      winner_team_id: winnerTeamId,
      forfeit: false,
    },
  });
  if (evtRes.error) return { ok: false, error: evtRes.error.message };

  // 6. Replace match_games rows.
  const delGames = await supabase.from('match_games').delete().eq('match_id', match.id);
  if (delGames.error) return { ok: false, error: delGames.error.message };

  const rows = games.map((g, i) => ({
    match_id: match.id,
    game_number: i + 1,
    score_a: g.score_a,
    score_b: g.score_b,
  }));
  const insGames = await supabase.from('match_games').insert(rows);
  if (insGames.error) return { ok: false, error: insGames.error.message };

  // 7. Mark match reported.
  const upd = await supabase
    .from('matches')
    .update({
      winner_team_id: winnerTeamId,
      status: 'reported',
      ended_at: new Date().toISOString(),
    })
    .eq('id', match.id);
  if (upd.error) return { ok: false, error: upd.error.message };

  // 8. Bracket auto-advance.
  if (match.next_match_id && match.next_match_slot) {
    const dnRes = await supabase
      .from('matches')
      .select('id, team_a_id, team_b_id, status')
      .eq('id', match.next_match_id)
      .maybeSingle();
    if (dnRes.error) return { ok: false, error: dnRes.error.message };
    const dn = dnRes.data as DownstreamMatch | null;
    if (dn) {
      const slotCol = match.next_match_slot === 'a' ? 'team_a_id' : 'team_b_id';
      const currentSlot = match.next_match_slot === 'a' ? dn.team_a_id : dn.team_b_id;
      if (currentSlot === null) {
        // First fill — set the slot.
        const updDn = await supabase
          .from('matches')
          .update({ [slotCol]: winnerTeamId })
          .eq('id', dn.id);
        if (updDn.error) return { ok: false, error: updDn.error.message };
      } else if (currentSlot !== winnerTeamId) {
        // Re-score case that would cascade. The full score screen owns
        // the cascade-revert/void prompts.
        return {
          ok: false,
          error:
            're-scoring would change a downstream match — use the full score screen to handle the cascade',
        };
      }
      // currentSlot === winnerTeamId: no-op (same team still advancing).
    }
  }

  // For pool_to_bracket: if pool play just completed, promote pool finishers
  // into the bracket's first round. Safe no-op if not all pool matches done.
  await promoteToBracketIfReady(match.division_id);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pool → bracket promotion.
// ---------------------------------------------------------------------------

function nextPowerOfTwo(n: number): number {
  if (n < 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Recursive seed-pair list (1-indexed). seedOrder(4) = [1, 4, 2, 3] — meaning
// slot index 0 holds the seed 1 team, slot index 1 holds the seed 4 team, etc.
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

// Compute pool standings (locally — duplicates the algorithm in division-detail
// so the lib doesn't depend on the screen). Sorts by wins desc, point diff
// desc, points for desc.
function poolStandings(
  teamIds: string[],
  matches: { id: string; team_a_id: string | null; team_b_id: string | null; winner_team_id: string | null; status: string }[],
  gamesByMatch: Map<string, { score_a: number; score_b: number }[]>,
): string[] {
  type Stat = { teamId: string; wins: number; pf: number; pa: number };
  const stats = new Map<string, Stat>();
  for (const tid of teamIds) stats.set(tid, { teamId: tid, wins: 0, pf: 0, pa: 0 });
  for (const m of matches) {
    if (!m.team_a_id || !m.team_b_id || !m.winner_team_id) continue;
    if (m.status !== 'reported' && m.status !== 'forfeit') continue;
    const a = stats.get(m.team_a_id);
    const b = stats.get(m.team_b_id);
    if (!a || !b) continue;
    const games = gamesByMatch.get(m.id) ?? [];
    for (const g of games) {
      a.pf += g.score_a;
      a.pa += g.score_b;
      b.pf += g.score_b;
      b.pa += g.score_a;
    }
    if (m.winner_team_id === m.team_a_id) a.wins += 1;
    else if (m.winner_team_id === m.team_b_id) b.wins += 1;
  }
  const sorted = Array.from(stats.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const da = a.pf - a.pa;
    const db = b.pf - b.pa;
    if (db !== da) return db - da;
    return b.pf - a.pf;
  });
  return sorted.map((s) => s.teamId);
}

// Auto-promote pool finishers into the bracket's first-round matches once
// every pool match in the division is reported. No-op for non-pool formats
// or when pool play is still in progress.
export async function promoteToBracketIfReady(divisionId: string): Promise<void> {
  const { data: div } = await supabase
    .from('divisions')
    .select('format, teams_advance')
    .eq('id', divisionId)
    .maybeSingle();
  if (!div) return;
  const d = div as { format: DivisionFormat | null; teams_advance: number | null };
  if (d.format !== 'pool_to_bracket') return;
  const advancePer = d.teams_advance ?? 0;
  if (advancePer < 1) return;

  const { data: pools } = await supabase
    .from('pools')
    .select('id, name')
    .eq('division_id', divisionId)
    .order('name');
  if (!pools || pools.length === 0) return;

  const { data: poolMatches } = await supabase
    .from('matches')
    .select('id, pool_id, team_a_id, team_b_id, winner_team_id, status')
    .eq('division_id', divisionId)
    .eq('stage', 'pool');
  if (!poolMatches) return;

  // Pool play is "done" when no match is still pending/scheduled/in_progress.
  // Voided matches (e.g. withdrawal-driven) count as terminal — they already
  // contribute nothing to standings (winner_team_id null, filtered out below).
  const allDone = poolMatches.every(
    (m: { status: string }) =>
      m.status === 'reported' || m.status === 'forfeit' || m.status === 'voided',
  );
  if (!allDone) return;

  const poolIds = pools.map((p: { id: string }) => p.id);
  const { data: poolTeamRows } = await supabase
    .from('pool_teams')
    .select('pool_id, team_id')
    .in('pool_id', poolIds);
  if (!poolTeamRows) return;

  // Withdrawn teams must NOT advance into the bracket even if they finished
  // high in their pool. Fetch the withdrawn_at column for every team that
  // appears in any pool so we can filter before slicing top-N per pool.
  const allTeamIdsInPools = Array.from(
    new Set(
      (poolTeamRows as { pool_id: string; team_id: string }[]).map((pt) => pt.team_id),
    ),
  );
  const withdrawnSet = new Set<string>();
  if (allTeamIdsInPools.length > 0) {
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, withdrawn_at')
      .in('id', allTeamIdsInPools);
    for (const t of (teamRows as { id: string; withdrawn_at: string | null }[] | null) ?? []) {
      if (t.withdrawn_at) withdrawnSet.add(t.id);
    }
  }

  const matchIds = poolMatches.map((m: { id: string }) => m.id);
  let gamesByMatch = new Map<string, { score_a: number; score_b: number }[]>();
  if (matchIds.length > 0) {
    const { data: gamesRows } = await supabase
      .from('match_games')
      .select('match_id, score_a, score_b')
      .in('match_id', matchIds);
    for (const g of (gamesRows as { match_id: string; score_a: number; score_b: number }[] | null) ?? []) {
      if (!gamesByMatch.has(g.match_id)) gamesByMatch.set(g.match_id, []);
      gamesByMatch.get(g.match_id)!.push({ score_a: g.score_a, score_b: g.score_b });
    }
  }

  // Top N finishers per pool, with withdrawn teams filtered out BEFORE the
  // slice. A withdrawn team that won pool matches still has their (now
  // historical) standings rank computed, but they shouldn't be promoted into
  // the bracket — their slot falls to the next non-withdrawn team. If the
  // pool has fewer non-withdrawn teams than `teams_advance`, we just promote
  // what's available; downstream bracket slots stay null and the existing
  // BYE-auto-advance logic handles it.
  const finishersPerPool: string[][] = [];
  for (const p of pools as { id: string }[]) {
    const teamIdsInPool = (poolTeamRows as { pool_id: string; team_id: string }[])
      .filter((pt) => pt.pool_id === p.id)
      .map((pt) => pt.team_id);
    const matchesInPool = (poolMatches as {
      id: string;
      pool_id: string | null;
      team_a_id: string | null;
      team_b_id: string | null;
      winner_team_id: string | null;
      status: string;
    }[]).filter((m) => m.pool_id === p.id);
    const ordered = poolStandings(teamIdsInPool, matchesInPool, gamesByMatch);
    const eligible = ordered.filter((tid) => !withdrawnSet.has(tid));
    finishersPerPool.push(eligible.slice(0, advancePer));
  }

  // Interleave: 1st from each pool, then 2nd, etc. So 1A, 1B, 2A, 2B for two
  // pools advancing two each. This pattern + seed-order layout keeps same-pool
  // finishers apart in round one.
  const advancing: string[] = [];
  for (let rank = 0; rank < advancePer; rank++) {
    for (const list of finishersPerPool) {
      if (rank < list.length) advancing.push(list[rank]);
    }
  }
  if (advancing.length < 2) return;

  const bracketSize = nextPowerOfTwo(advancing.length);
  const order = seedOrder(bracketSize); // 1-indexed seed at each slot index
  const slotTeams: (string | null)[] = order.map((seed) =>
    seed > advancing.length ? null : advancing[seed - 1],
  );

  // Fetch round-1 bracket matches.
  const { data: r1Matches } = await supabase
    .from('matches')
    .select('id, bracket_slot, status, next_match_id, next_match_slot')
    .eq('division_id', divisionId)
    .eq('stage', 'bracket')
    .eq('bracket_round', 1)
    .order('bracket_slot');
  if (!r1Matches) return;

  // Don't clobber a bracket that's already in play.
  const anyStarted = (r1Matches as { status: string }[]).some(
    (m) => m.status === 'reported' || m.status === 'forfeit' || m.status === 'in_progress',
  );
  if (anyStarted) return;

  for (const bm of r1Matches as {
    id: string;
    bracket_slot: number | null;
    next_match_id: string | null;
    next_match_slot: string | null;
  }[]) {
    const slot = bm.bracket_slot ?? 1;
    const aIdx = (slot - 1) * 2;
    const bIdx = (slot - 1) * 2 + 1;
    const aTeam = slotTeams[aIdx] ?? null;
    const bTeam = slotTeams[bIdx] ?? null;
    await supabase
      .from('matches')
      .update({ team_a_id: aTeam, team_b_id: bTeam })
      .eq('id', bm.id);

    // BYE propagation: if exactly one slot is null, the present team auto-
    // advances to the parent match.
    if (bm.next_match_id && bm.next_match_slot && (aTeam === null) !== (bTeam === null)) {
      const winner = aTeam ?? bTeam;
      if (winner) {
        const update = bm.next_match_slot === 'a' ? { team_a_id: winner } : { team_b_id: winner };
        await supabase.from('matches').update(update).eq('id', bm.next_match_id);
      }
    }
  }
}

// Splits the court list across pools as evenly as possible. Mirrors the
// logic in `generateMatches.ts`'s private `splitCourtsAmongPools` so the
// court layout stays consistent between initial generation and later
// reassignment.
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
    for (let p = 0; p < poolCount; p++) result[p] = [courtIds[p % courtIds.length]];
  }
  return result;
}

// Reassign court_ids across existing matches in a division using the
// division's current court selection. Useful when the admin added/removed
// a court after matches were generated.
//
// Returns { ok: true, updated: N } where N is the number of match rows
// whose court_id actually changed. N=0 means assignments already matched.
export async function reassignCourts(divisionId: string): Promise<ReassignResult> {
  // 1. Fetch the division to know its format.
  const dRes = await supabase
    .from('divisions')
    .select('id, tournament_id, format')
    .eq('id', divisionId)
    .maybeSingle();
  if (dRes.error) return { ok: false, error: dRes.error.message };
  const division = dRes.data as DivisionRow | null;
  if (!division) return { ok: false, error: 'Division not found.' };

  // 2. Fetch division courts in display order.
  const dcRes = await supabase
    .from('division_courts')
    .select('court_id, display_order, courts:court_id (id, name)')
    .eq('division_id', divisionId)
    .order('display_order', { ascending: true });
  if (dcRes.error) return { ok: false, error: dcRes.error.message };
  const dcRows = (dcRes.data as unknown as DivisionCourtRow[] | null) ?? [];
  const courtIds = dcRows
    .map((row) => row.courts?.id ?? row.court_id)
    .filter((id): id is string => !!id);
  if (courtIds.length === 0) {
    return { ok: false, error: 'No courts assigned to this division.' };
  }

  // 3. Fetch all matches for the division.
  const mRes = await supabase
    .from('matches')
    .select('id, stage, pool_id, court_id, status, round_number, bracket_round')
    .eq('division_id', divisionId)
    .order('bracket_round', { ascending: true, nullsFirst: true })
    .order('round_number', { ascending: true, nullsFirst: true })
    .order('bracket_slot', { ascending: true, nullsFirst: true });
  if (mRes.error) return { ok: false, error: mRes.error.message };
  const matches = (mRes.data as MatchRow[] | null) ?? [];
  if (matches.length === 0) {
    return { ok: false, error: 'No matches to reassign.' };
  }

  // 4. Pools (only needed for pool_to_bracket).
  let pools: PoolRow[] = [];
  if (division.format === 'pool_to_bracket') {
    const pRes = await supabase
      .from('pools')
      .select('id, name')
      .eq('division_id', divisionId)
      .order('name');
    if (pRes.error) return { ok: false, error: pRes.error.message };
    pools = (pRes.data as PoolRow[] | null) ?? [];
  }

  // 5. Compute new court_id per match. Mirrors generateMatches.ts:
  //    - pool stage: split courts among pools, assign round-by-round within each pool
  //    - bracket: assign round-by-round using ALL selected courts
  //    - round_robin: assign round-by-round using ALL selected courts
  //
  //    Round-aware rule: two matches in the same round can never share a
  //    court. If a round has more matches than courts, the extras get null
  //    (admin assigns at game time when an earlier match frees up).
  const updates: { id: string; court_id: string | null }[] = [];

  function assignRoundAware(list: MatchRow[], slice: string[]) {
    if (slice.length === 0) {
      for (const m of list) {
        if (m.court_id !== null) updates.push({ id: m.id, court_id: null });
      }
      return;
    }
    const byRound = new Map<number, MatchRow[]>();
    for (const m of list) {
      const r = m.round_number ?? m.bracket_round ?? 0;
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r)!.push(m);
    }
    for (const [, roundMatches] of byRound) {
      roundMatches.forEach((m, i) => {
        const newCourt = i < slice.length ? slice[i] : null;
        if (m.court_id !== newCourt) updates.push({ id: m.id, court_id: newCourt });
      });
    }
  }

  if (division.format === 'pool_to_bracket' && pools.length > 0) {
    const sortedPools = [...pools].sort((a, b) => a.name.localeCompare(b.name));
    const courtsPerPool = splitCourtsAmongPools(courtIds, sortedPools.length);
    const poolCourts = new Map<string, string[]>();
    sortedPools.forEach((p, idx) => poolCourts.set(p.id, courtsPerPool[idx] ?? []));

    const poolMatchesByPool = new Map<string, MatchRow[]>();
    for (const m of matches.filter((mm) => mm.stage === 'pool' && mm.pool_id)) {
      if (!poolMatchesByPool.has(m.pool_id!)) poolMatchesByPool.set(m.pool_id!, []);
      poolMatchesByPool.get(m.pool_id!)!.push(m);
    }
    for (const [poolId, list] of poolMatchesByPool) {
      assignRoundAware(list, poolCourts.get(poolId) ?? []);
    }
    // Bracket matches use all selected courts, grouped by bracket_round.
    assignRoundAware(matches.filter((m) => m.stage === 'bracket'), courtIds);
  } else {
    // Round-robin or single-elim: use all courts, grouped by round.
    assignRoundAware(matches, courtIds);
  }

  // 6. Apply updates sequentially. Could batch with rpc but the row count
  //    is small (a few dozen at most) and sequential keeps errors readable.
  for (const u of updates) {
    const { error: err } = await supabase
      .from('matches')
      .update({ court_id: u.court_id })
      .eq('id', u.id);
    if (err) return { ok: false, error: err.message };
  }

  return { ok: true, updated: updates.length };
}

// Wipes all matches and pools for a division and resets it back to `open`
// so the admin can pick a format again. Match games and score events
// cascade away via FK constraints; pool_teams cascades from pools.
export async function regenerateMatches(divisionId: string): Promise<RegenerateResult> {
  // 1. Delete matches (FK cascade -> match_games, score_events).
  const mRes = await supabase.from('matches').delete().eq('division_id', divisionId);
  if (mRes.error) return { ok: false, error: mRes.error.message };

  // 2. Delete pools (FK cascade -> pool_teams).
  const pRes = await supabase.from('pools').delete().eq('division_id', divisionId);
  if (pRes.error) return { ok: false, error: pRes.error.message };

  // 3. Reset division back to "open" so the admin picks a format from scratch.
  const dRes = await supabase
    .from('divisions')
    .update({ format: null, status: 'open', num_pools: null, teams_advance: null })
    .eq('id', divisionId);
  if (dRes.error) return { ok: false, error: dRes.error.message };

  return { ok: true };
}

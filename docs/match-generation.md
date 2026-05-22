# Match Generation Spec

Specification for pbxscape's match-generation algorithms. Covers the three
formats in the `division_format` enum: `round_robin`, `single_elimination`,
`pool_to_bracket`.

All column references trace to `supabase/migrations/0001_init.sql`. The schema
is the source of truth — this doc describes *how* rows get populated, not which
rows exist.

---

## Shared concepts

### Match row lifecycle

A `matches` row has three populated states:

| Phase                  | Columns populated                                                                                     |
|------------------------|-------------------------------------------------------------------------------------------------------|
| **At generation**      | `id`, `division_id`, `stage`, `pool_id?`, `bracket_round?`, `bracket_slot?`, `status='pending'`, bracket plumbing (`next_match_id`, `next_match_slot`) for elim/bracket matches |
| **At seeding / feed-in** | `team_a_id`, `team_b_id` — for round-robin and pool stage these are set at generation; for bracket rounds > 1 they remain null until upstream winners are decided |
| **At scheduling**      | `court_id`, `scheduled_at`, `status='scheduled'`                                                      |
| **At play**            | `started_at`, `status='in_progress'`                                                                  |
| **At report**          | `winner_team_id`, `ended_at`, `status='reported'` (or `'forfeit'` / `'voided'`); `match_games` rows inserted; `score_events` audit row inserted |

`best_of`, `game_to`, `win_by` live on `divisions`, not on `matches`. They are
read at score-entry time; nothing about generation depends on them. See
[Edge cases](#best_of_3-at-generation-time-vs-score-entry-time).

### Bracket plumbing (`next_match_id`, `next_match_slot`)

Every match whose winner advances stores a pointer to its downstream match:

- `next_match_id` — the `matches.id` that will consume this winner.
- `next_match_slot` — `'a'` or `'b'`, which slot of the downstream match this
  winner fills.

This wiring is set **at generation** for bracket matches and lets two things
work:

1. **Forward propagation.** When a match is reported, the writer sets
   `next_match.team_<slot>_id = winner_team_id`.
2. **Cascade revert.** When a reported match is voided or rescored such that
   the winner changes, walk `next_match_id` recursively and null out the
   `team_a_id` / `team_b_id` in the corresponding slot for any descendant
   match that is not yet `reported`. If a descendant *is* reported, the revert
   must fail loudly (admin has to void downstream first).

The final match has `next_match_id = NULL`.

### Seeding input

All three formats consume the same seeding input: `teams.seed` (nullable int)
within a division. The generator must:

1. Filter out teams with `withdrawn_at IS NOT NULL` (they don't get matches).
2. Sort by `seed ASC NULLS LAST`, then `name ASC` as a stable tiebreak.
3. Treat the resulting ordered list as seeds 1..N.

If any team has a null seed, surface a warning to the admin before generating.
Auto-assign nulls in trailing order, but make this explicit in the UI.

---

## Format: `round_robin`

Every team plays every other team once.

### Inputs

- `divisions.id`, `divisions.format = 'round_robin'`
- Active teams in the division (`teams` where `withdrawn_at IS NULL`)
- Optional: `teams.seed` for ordering the schedule but not pairings

### Algorithm — circle method

Let `N` = number of active teams. Total matches = `N * (N - 1) / 2`, played
over `N - 1` rounds (or `N` rounds if `N` is odd, with one team idle per round).

```
1. Sort teams as described in "Seeding input" → list L[0..N-1].
2. If N is odd, append a sentinel BYE → list of size N+1 (call it M).
3. Fix M[0] in place. For round r in 0..len(M)-2:
     for i in 0..len(M)/2 - 1:
       a = M[i]
       b = M[len(M)-1-i]
       if a is BYE or b is BYE: skip
       insert match row (see below) with team_a_id=a.id, team_b_id=b.id
     Rotate M[1..end] by one position to the right (M[0] stays fixed).
4. Optionally alternate which side is `team_a` per round to balance "home/away"
   if that ever matters (it doesn't for pickleball, but it makes the schedule
   look less lopsided).
```

### Row population

For each pairing produce one `matches` row:

- `division_id` = the division
- `stage = 'pool'` *(see [Open questions](#open-questions) — round-robin
  arguably warrants its own stage value)*
- `pool_id = NULL`
- `bracket_round = NULL`, `bracket_slot = NULL`
- `team_a_id`, `team_b_id` set
- `status = 'pending'`
- `next_match_id = NULL`, `next_match_slot = NULL` — round-robin has no
  feed-forward

The round number from the circle method is **not** persisted as a column. If
the UI needs to group by round, derive it from the generation pass or add a
`round` column later. Surfaced in [Open questions](#open-questions).

### Tiebreaker rules

After all matches reported, rank teams to determine final standings. Default
cascade (matches USAPA & most APP events):

1. **Win-loss record** (matches won)
2. **Head-to-head** record among tied teams *(only resolves 2-way ties cleanly;
   for 3+ way ties this rarely breaks)*
3. **Game win percentage** (games won / games played)
4. **Point differential** in head-to-head (or all matches — see below)
5. **Total points scored** in all matches
6. **Coin flip / seed order** as final fallback

Where formats diverge:

- **USAPA / USA Pickleball** typically prefer head-to-head → point differential
  among tied teams → total point differential.
- **DUPR-rated events** often skip head-to-head when 3+ teams are tied (because
  head-to-head produces cycles) and jump straight to point differential across
  all matches, then to DUPR-weighted point differential.
- **APP / PPA** use head-to-head, then point differential in head-to-head, then
  fewest points allowed.

Implementation note: store the tiebreak cascade as configuration on the
`divisions` row (new column, not yet in schema — see Open questions). Compute
standings on demand from `match_games`; do not persist a standings table.

---

## Format: `single_elimination`

Single-elimination bracket. Loser is out; winner advances via `next_match_id`.

### Inputs

- `divisions.id`, `divisions.format = 'single_elimination'`
- Active teams sorted by seed
- `divisions.best_of` (read at score time only, not at generation)

### Algorithm

```
1. Sort teams by seed → S[1..N].
2. Compute bracket size B = next power of 2 ≥ N. Number of byes = B - N.
3. Build seed-order pairings using the standard recursive bracket layout
   so 1 cannot meet 2 before the final, 1 meets 4 in semis, etc:
     pairings(1) = [1]
     pairings(B) = interleave pairings(B/2) so each pair sums to B+1:
       [1,B], [B/2+1, B/2], ...
   This yields the canonical seed-ordered slot list for round 1.
4. Assign byes to top seeds first: seed 1 plays the lowest seed, ..., the top
   `(B - N)` seeds get a bye (their round-1 slot opponent is BYE).
5. Insert round 1 matches in slot order:
     for slot in 1..B/2:
       row = new match {
         division_id, stage='bracket',
         bracket_round=1, bracket_slot=slot,
         team_a_id=top_seed_in_pair, team_b_id=bottom_seed_in_pair, // null if BYE
         status='pending'
       }
6. Insert rounds 2..log2(B) the same way, with team_a_id/team_b_id NULL.
7. After all rows exist, wire `next_match_id` / `next_match_slot`:
     for every match m with bracket_round = r, bracket_slot = s where r < log2(B):
       parent_round = r + 1
       parent_slot  = ceil(s / 2)
       parent_child_slot = 'a' if s is odd else 'b'
       m.next_match_id = id of (parent_round, parent_slot)
       m.next_match_slot = parent_child_slot
8. BYE auto-advancement: any round-1 match where one side is NULL gets its
   non-null team auto-propagated:
     parent.team_<m.next_match_slot>_id = the non-null side
     m.status = 'reported', m.winner_team_id = the non-null team, no match_games row.
   (Alternative: leave m as a sentinel and propagate at division "lock"
   time — see Open questions.)
```

### Row population

Per match row:

- `division_id`, `stage = 'bracket'`, `bracket_round`, `bracket_slot`
- `team_a_id` / `team_b_id`: set in round 1 (from seeding); null for later rounds
- `next_match_id`, `next_match_slot`: set for all matches except the final
- `status = 'pending'`; `winner_team_id = NULL`

### Cascade-revert example

Bracket of 8, semifinal SF1 reported with team X winning, advances to F.
Admin voids SF1. Cascade:

1. SF1.winner_team_id = NULL, SF1.status = 'pending'.
2. Walk SF1.next_match_id → F. F.team_<SF1.next_match_slot>_id is cleared.
3. If F.status was anything other than 'pending'/'scheduled', refuse the void
   and tell the admin to void F first.

### Edge cases

See [Edge cases](#edge-cases) below; the non-power-of-2 case is the big one.

---

## Format: `pool_to_bracket`

Teams split into pools, play round-robin within pool, top N from each pool
advance to a single-elimination bracket.

### Inputs

- `divisions.id`, `divisions.format = 'pool_to_bracket'`
- `divisions.num_pools` — required, ≥ 2
- `divisions.teams_advance` — required, ≥ 1, per pool
- Active teams sorted by seed

### Algorithm — pool stage

```
1. Sort teams by seed → S[1..N].
2. Snake-draft into `num_pools` pools so seed strength is balanced:
     pool[i] gets seeds where (i) in pass 0, reversed (i) in pass 1, etc.
     E.g. 12 teams, 3 pools:
       Pool A: 1, 6, 7, 12
       Pool B: 2, 5, 8, 11
       Pool C: 3, 4, 9, 10
3. Insert one `pools` row per pool with name "Pool A", "Pool B", ...
4. Insert `pool_teams` for each (pool, team) assignment.
5. For each pool, run the round-robin circle method (see round_robin above)
   to generate matches with:
     stage = 'pool'
     pool_id = pool.id
     team_a_id, team_b_id set
     bracket_round = NULL, bracket_slot = NULL
     next_match_id = NULL  ← NOT wired; bracket teams come from standings, not pointers
```

Pool matches **do not** populate `next_match_id`. The pool→bracket transition
is a discrete admin step, not an automatic cascade, because pool standings
require all-matches-complete and tiebreaker resolution.

### Algorithm — bracket stage

Triggered manually by the admin once all pool matches in a division are
`reported`. Pre-generated at the same time as the pool stage, but with team
slots left null, OR generated at promotion time. Recommend generate-at-promotion
to avoid stale brackets when pool sizes shift due to withdrawals. See
[Open questions](#open-questions).

```
1. Compute standings per pool using the configured tiebreaker cascade.
2. Take top `teams_advance` from each pool. Total advancing = P * teams_advance
   where P = num_pools.
3. Cross-pool seed the bracket so 1st-place finishers from the same pool don't
   meet in round 1:
     - Rank advancing teams: all 1st-place finishers first (best record →
       worst), then all 2nd-place, etc.
     - Apply the same recursive bracket layout from single_elimination.
     - When two slots would pair teams from the same pool in round 1, swap
       with the next-lowest-rank team from a different pool. This is the
       "cross-bracket" rule used by USAPA pool-play events.
4. Generate bracket matches identically to single_elimination, starting at
   bracket_round = 1. Wire next_match_id / next_match_slot for all non-final
   rounds.
```

### Row population for bracket matches

Same as single_elimination, with `stage = 'bracket'`, `pool_id = NULL`. Round 1
team slots are populated from pool standings.

---

## Edge cases

### Odd team counts (byes)

- **Round-robin**: handled by the sentinel BYE in the circle method. The team
  paired with BYE in a given round sits out that round. No match row inserted.
- **Single-elim**: bracket pads to the next power of 2. Top seeds get byes
  (one each). A bye is a round-1 match where one team slot is null; the
  non-null team auto-advances.
- **Pool→bracket**: pool sizes may be uneven (see below); bracket size is
  `P * teams_advance` and may itself be non-power-of-2, padded with byes.

### 2 teams (degenerate)

- **Round-robin** with 2 teams: one match. Functionally identical to a
  single_elimination final. Allow it; no special-case code needed.
- **Single-elim** with 2 teams: one match, round 1 = the final,
  `next_match_id = NULL`.
- **Pool→bracket** with 2 teams: refuse generation. `num_pools >= 2` and
  `teams_advance >= 1` requires ≥ 4 teams; show a validation error.

### Non-power-of-2 in single-elim

Already covered: pad to next power of 2, give top `(B - N)` seeds round-1 byes,
auto-advance them. The bracket structure (round count, plumbing) is identical
to a "full" bracket of size B.

### Withdrawals after matches generated

Two cases:

1. **Team withdraws before any of its matches are played.** Set
   `teams.withdrawn_at`. For each unplayed match involving the team:
   - If `status = 'pending'` and the other team is present: mark the match
     `forfeit`, set `winner_team_id` to the present team, propagate via
     `next_match_id` if applicable.
   - If both teams have withdrawn: mark `voided`, do not propagate.
2. **Team withdraws after playing some matches** (round-robin / pool):
   - Played matches stand.
   - Unplayed matches: forfeit-win for the present opponent (per USAPA — DUPR
     events sometimes void instead; see Open questions).
   - Standings recalc on the fly.

Forfeits write a `score_events` row with `payload.forfeit = true` and no
`match_games` rows. The match status is `forfeit`, not `reported`.

### Pool sizes that don't divide evenly (10 teams / 3 pools)

Snake-draft naturally handles this. 10 teams, 3 pools → pool sizes 4, 3, 3.
Pool A gets the extra team (seed 1 + seed 6 + seed 7 + ... wraps differently
on each pass).

Round count differs between pools: a 4-team pool plays 3 rounds (6 matches),
a 3-team pool plays 3 rounds with 1 bye each (3 matches). This is fine — match
counts and schedule slots are computed per pool.

`teams_advance` applies uniformly: if `teams_advance = 2`, both 1st and 2nd
from every pool advance regardless of pool size. The 4-team pool's 2nd place
is arguably "stronger" than the 3-team pool's 2nd; the cross-bracket seeding
step (step 3 above) orders advancers by their pool record, which mitigates but
doesn't eliminate this. Surfaced in [Open questions](#open-questions).

### `best_of_3` at generation time vs score-entry time

`divisions.best_of` is **never** read by the match generator. It affects:

- **Score entry UI**: how many `match_games` rows are accepted per match
  (1, 3, or 5).
- **Winner determination**: a match is reported when one side has won
  `ceil(best_of / 2)` games.
- **Scheduling estimates**: a best_of_3 match takes longer than best_of_1;
  scheduler should budget court time accordingly (~30 min for bo1, ~75 min
  for bo3 at game_to=11).

Generation produces the same row regardless of `best_of`. If `best_of` is
changed after matches are generated:

- For matches with `status = 'pending'` or `'scheduled'`: safe, no data change.
- For matches with `match_games` already entered: refuse the change, or warn
  and recompute winners on save. Recommend refuse — surfaced in Open questions.

---

## Tiebreaker rules — round-robin (consolidated)

Recommended default cascade for pbxscape v1:

1. Match win-loss record
2. Head-to-head record among all tied teams (only applied if it fully resolves
   the tie; skip if 3+ teams remain tied)
3. Game win percentage across all matches
4. Total point differential across all matches
5. Total points scored across all matches
6. Seed (lower seed wins)

Apply identically when ranking pool standings before bracket promotion.

**Divergence notes:**

- USAPA: head-to-head and point-differential-in-head-to-head are weighted
  heavier; falls back to total point diff.
- DUPR: skips head-to-head for ties of 3+ because of cycles; uses total point
  diff earlier.
- APP/PPA: prefers fewest points allowed late in the cascade.

Make the cascade configurable per tournament (or per division) — see Open
questions for where it lives.

---

## Open questions

Product decisions needed before implementation. Resolve these in order.

1. **Round-robin `stage` value.** Current `match_stage` enum is
   `('pool', 'bracket')`. Round-robin matches don't fit either cleanly.
   Options: (a) add `'round_robin'` to the enum, (b) reuse `'pool'` with
   `pool_id = NULL`, (c) reuse `'bracket'` with `bracket_round` numbering the
   rotation round. Recommend (a). Requires migration.

2. **Round number persistence.** Currently no column captures the round number
   for round-robin matches (the circle method's round). Add a `round int`
   column to `matches`, or derive at read time from generation timestamp /
   batch id. Recommend column.

3. **Bracket pre-generation vs lazy generation in `pool_to_bracket`.**
   Pre-generate empty bracket matches at division-lock time so the UI can
   render an empty bracket? Or generate only when pool play completes?
   Recommend lazy (generate at promotion) to avoid stale rows when teams
   withdraw mid-pool.

4. **Tiebreaker cascade configuration.** Where does the cascade live? Options:
   (a) hard-coded in app code, (b) JSONB column on `tournaments`, (c) JSONB on
   `divisions`. Recommend (c) — different divisions may use different rules
   (e.g. DUPR-rated division vs unrated).

5. **BYE auto-advancement timing.** Auto-advance BYEs the moment the bracket
   is generated, or at division "lock" / start-of-play? Recommend at
   generation — simpler, no special "lock" event needed.

6. **Forfeit semantics.** USAPA: forfeit gives opponent a win with default
   score (e.g. 11-0). DUPR: often voids match entirely so DUPR rating isn't
   inflated. Pick one default; allow per-match override.

7. **Withdrawal cascade scope.** When a team withdraws mid-tournament, do we
   recompute their prior matches as voided (DUPR convention) or leave them as
   reported (USAPA convention)? Recommend leave reported.

8. **Cross-bracket seeding strictness.** The "1A doesn't meet 1B in round 1"
   rule is straightforward for 2 pools. For 4+ pools the rules get murky
   (avoid same-pool matchups in *all* early rounds, or just round 1?).
   Recommend round 1 only for v1; document the limitation.

9. **`best_of` change after scoring started.** Refuse, warn, or silently
   recompute? Recommend refuse with an explicit "void affected matches first"
   error.

10. **Court assignment.** Out of scope for match *generation*, but the
    scheduler that consumes generated matches needs to know match duration
    estimates (depend on `best_of`, `game_to`). Worth documenting alongside
    this spec when the scheduler is designed.

11. **Seeding when seeds are missing.** Auto-assign trailing seeds to
    null-seed teams, or refuse generation? Recommend warn + auto-assign with
    a visible "auto-seeded" indicator in the UI.

12. **Re-generation.** If admin tweaks the team list after generation, do we
    drop and regenerate (losing scheduled court assignments) or surgically
    patch? Recommend "regenerate requires no matches in `in_progress` or
    `reported` state" with a confirmation modal.

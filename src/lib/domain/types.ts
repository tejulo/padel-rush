export type Gender = 'man' | 'woman'

export type Category = 'men' | 'women' | 'mixed'

export type TournamentState = 'draft' | 'in_progress' | 'finished' | 'completed' | 'cancelled'

export type MatchState = 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'forfeit' | 'cancelled'

export type MatchSlot = 'a' | 'b'

export type MatchOutcome = 'winner' | 'loser'

export type MatchStage =
  | 'winners-round'
  | 'winners-final'
  | 'losers-round'
  | 'losers-final'
  | 'grand-final'
  | 'grand-final-reset'

export type CategoryState = 'draft' | 'locked' | 'in_progress' | 'finished' | 'cancelled'

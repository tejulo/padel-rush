import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['admin', 'organizer'])
export const userStateEnum = pgEnum('user_state', ['active', 'inactive'])
export const genderEnum = pgEnum('gender', ['man', 'woman'])
export const categoryEnum = pgEnum('category', ['men', 'women', 'mixed'])
export const categoryStateEnum = pgEnum('category_state', [
  'draft',
  'locked',
  'in_progress',
  'finished',
  'cancelled',
])
export const tournamentStateEnum = pgEnum('tournament_state', [
  'draft',
  'in_progress',
  'finished',
  'completed',
  'cancelled',
])
export const matchStateEnum = pgEnum('match_state', [
  'pending',
  'scheduled',
  'in_progress',
  'completed',
  'forfeit',
  'cancelled',
])
export const matchFormatEnum = pgEnum('match_format', ['one-set-nine', 'best-of-three'])
export const matchSlotEnum = pgEnum('match_slot', ['a', 'b'])
export const matchOutcomeEnum = pgEnum('match_outcome', ['winner', 'loser'])

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull(),
    state: userStateEnum('state').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('users_username_unique').on(table.username)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('sessions_token_hash_unique').on(table.tokenHash)],
)

export const loginAttempts = pgTable('login_attempts', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  ipAddress: text('ip_address').notNull(),
  successful: boolean('successful').notNull().default(false),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tournaments = pgTable(
  'tournaments',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    date: date('date').notNull(),
    timezone: text('timezone').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    shortMatchMinutes: integer('short_match_minutes').notNull(),
    longMatchMinutes: integer('long_match_minutes').notNull(),
    restMinutes: integer('rest_minutes').notNull(),
    state: tournamentStateEnum('state').notNull().default('draft'),
    publicToken: text('public_token'),
    organizerId: text('organizer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('tournaments_public_token_unique').on(table.publicToken),
    check('tournaments_short_match_minutes_positive', sql`${table.shortMatchMinutes} > 0`),
    check('tournaments_long_match_minutes_positive', sql`${table.longMatchMinutes} > 0`),
    check('tournaments_rest_minutes_nonnegative', sql`${table.restMinutes} >= 0`),
  ],
)

export const courts = pgTable(
  'courts',
  {
    id: text('id').primaryKey(),
    tournamentId: text('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    covered: boolean('covered').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [uniqueIndex('courts_tournament_name_unique').on(table.tournamentId, table.name)],
)

export const participants = pgTable(
  'participants',
  {
    id: text('id').primaryKey(),
    tournamentId: text('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    gender: genderEnum('gender').notNull(),
    level: integer('level').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check('participants_level_range', sql`${table.level} between 1 and 5`)],
)

export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    tournamentId: text('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    category: categoryEnum('category').notNull(),
    state: categoryStateEnum('state').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('categories_tournament_category_unique').on(table.tournamentId, table.category)],
)

export const registrations = pgTable(
  'registrations',
  {
    id: text('id').primaryKey(),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('registrations_participant_category_unique').on(table.participantId, table.categoryId)],
)

export const teams = pgTable(
  'teams',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    levelTotal: integer('level_total').notNull().default(0),
    locked: boolean('locked').notNull().default(false),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
)

export const teamMembers = pgTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('team_members_team_participant_unique').on(table.teamId, table.participantId),
    uniqueIndex('team_members_participant_category_unique').on(table.participantId, table.categoryId),
  ],
)

export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    round: integer('round').notNull(),
    position: integer('position').notNull(),
    format: matchFormatEnum('format').notNull(),
    state: matchStateEnum('state').notNull().default('pending'),
    courtId: text('court_id').references(() => courts.id, { onDelete: 'set null' }),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true }),
    actualStartAt: timestamp('actual_start_at', { withTimezone: true }),
    actualEndAt: timestamp('actual_end_at', { withTimezone: true }),
    score: jsonb('score').$type<unknown>(),
    resultReason: text('result_reason'),
    winnerTeamId: text('winner_team_id').references(() => teams.id, { onDelete: 'set null' }),
    loserTeamId: text('loser_team_id').references(() => teams.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('matches_category_stage_round_position_unique').on(
      table.categoryId,
      table.stage,
      table.round,
      table.position,
    ),
  ],
)

export const matchSlots = pgTable(
  'match_slots',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    slot: matchSlotEnum('slot').notNull(),
    teamId: text('team_id').references(() => teams.id, { onDelete: 'set null' }),
    sourceMatchId: text('source_match_id').references(() => matches.id, { onDelete: 'cascade' }),
    sourceOutcome: matchOutcomeEnum('source_outcome'),
  },
  (table) => [
    uniqueIndex('match_slots_match_slot_unique').on(table.matchId, table.slot),
    check(
      'match_slots_source_pair',
      sql`(${table.sourceMatchId} is null and ${table.sourceOutcome} is null) or (${table.sourceMatchId} is not null and ${table.sourceOutcome} is not null)`,
    ),
  ],
)

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  tournaments: many(tournaments),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const tournamentsRelations = relations(tournaments, ({ one, many }) => ({
  organizer: one(users, { fields: [tournaments.organizerId], references: [users.id] }),
  courts: many(courts),
  participants: many(participants),
  categories: many(categories),
}))

export const courtsRelations = relations(courts, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [courts.tournamentId], references: [tournaments.id] }),
  matches: many(matches),
}))

export const participantsRelations = relations(participants, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [participants.tournamentId], references: [tournaments.id] }),
  registrations: many(registrations),
  teamMembers: many(teamMembers),
}))

export const registrationsRelations = relations(registrations, ({ one }) => ({
  participant: one(participants, { fields: [registrations.participantId], references: [participants.id] }),
  category: one(categories, { fields: [registrations.categoryId], references: [categories.id] }),
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [categories.tournamentId], references: [tournaments.id] }),
  registrations: many(registrations),
  teams: many(teams),
  matches: many(matches),
}))

export const teamsRelations = relations(teams, ({ one, many }) => ({
  category: one(categories, { fields: [teams.categoryId], references: [categories.id] }),
  members: many(teamMembers),
  winnerMatches: many(matches, { relationName: 'winnerTeam' }),
  loserMatches: many(matches, { relationName: 'loserTeam' }),
}))

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  participant: one(participants, { fields: [teamMembers.participantId], references: [participants.id] }),
  category: one(categories, { fields: [teamMembers.categoryId], references: [categories.id] }),
}))

export const matchesRelations = relations(matches, ({ one, many }) => ({
  category: one(categories, { fields: [matches.categoryId], references: [categories.id] }),
  court: one(courts, { fields: [matches.courtId], references: [courts.id] }),
  winnerTeam: one(teams, {
    fields: [matches.winnerTeamId],
    references: [teams.id],
    relationName: 'winnerTeam',
  }),
  loserTeam: one(teams, {
    fields: [matches.loserTeamId],
    references: [teams.id],
    relationName: 'loserTeam',
  }),
  slots: many(matchSlots),
}))

export const matchSlotsRelations = relations(matchSlots, ({ one }) => ({
  match: one(matches, { fields: [matchSlots.matchId], references: [matches.id] }),
  team: one(teams, { fields: [matchSlots.teamId], references: [teams.id] }),
  sourceMatch: one(matches, {
    fields: [matchSlots.sourceMatchId],
    references: [matches.id],
    relationName: 'sourceMatch',
  }),
}))

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Tournament = typeof tournaments.$inferSelect
export type NewTournament = typeof tournaments.$inferInsert
export type Court = typeof courts.$inferSelect
export type Participant = typeof participants.$inferSelect
export type Category = typeof categories.$inferSelect
export type Team = typeof teams.$inferSelect
export type Match = typeof matches.$inferSelect
export type MatchSlot = typeof matchSlots.$inferSelect

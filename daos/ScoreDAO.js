import dbPool from '../modules/db.js';

const SESSION_BREAK_MS = 2 * 60 * 58 * 1000; // 2hours - 2s for the time check query

class ScoreDAO {
	async getStats(user) {
		const db_client = await dbPool.connect();

		try {
			const data = {
				current_player: user.login,
				pbs: [
					await this._getPBs(db_client, user, 18),
					await this._getPBs(db_client, user, 19),
				],
				high_scores: {
					overall: await this._getBestOverall(db_client, user),
					session: await this._getBestInSession(db_client, user),
				},
			};

			// Temporary ... For backward compatibility - Remove after 2022-06-01
			data.high_scores.today = data.high_scores.session;

			return data;
		} catch (err) {
			console.log('Error getting user stats');
			console.error(err);
			return {};
		} finally {
			db_client.release();
		}
	}

	async _getPBs(db_client, user, start_level) {
		const result = await db_client.query(
			`
			SELECT start_level, end_level, score, lines, das_avg, max_drought, tetris_rate
			FROM scores
			WHERE player_id=$1 and start_level=$2
			ORDER BY score DESC
			LIMIT 1
			`,
			[user.id, start_level]
		);

		return result.rows[0];
	}

	async _getBestOverall(db_client, user) {
		const result = await db_client.query(
			`
			SELECT start_level, score, tetris_rate
			FROM scores
			WHERE player_id=$1
			ORDER BY score DESC
			LIMIT 16
			`,
			[user.id]
		);

		return result.rows;
	}

	async _getBest24Hours(db_client, user) {
		const result = await db_client.query(
			`
			SELECT start_level, score, tetris_rate
			FROM scores
			WHERE player_id=$1
				AND datetime >= NOW() - interval '24 hours'
				AND datetime <= NOW()
			ORDER BY score DESC
			LIMIT 16
			`,
			[user.id]
		);

		return result.rows;
	}

	async _getBestInSession(db_client, user) {
		const session = await this._getCurrentSessionId(user, db_client);
		const result = await db_client.query(
			`
			SELECT start_level, score, tetris_rate
			FROM scores
			WHERE player_id=$1
				AND session=$2
			ORDER BY score DESC
			LIMIT 16
			`,
			[user.id, session]
		);

		return result.rows;
	}

	async getPB(user, since = 0) {
		const result = await dbPool.query(
			`
				SELECT score
				FROM scores
				WHERE player_id = $1
				AND datetime >= to_timestamp($2)
				ORDER BY score DESC
				LIMIT 1
			`,
			[user.id, since]
		);

		try {
			return parseInt(result.rows[0].score, 10);
		} catch (err) {
			console.error(err);
			return 0;
		}
	}

	async getPBs181929(user) {
		const result = await dbPool.query(
			`
				SELECT start_level, MAX(score) as score
				FROM scores
				WHERE player_id = $1
				AND start_level IN (18, 19, 29)
				GROUP BY start_level
				ORDER BY start_level ASC
			`,
			[user.id]
		);

		return result.rows.reduce((acc, { start_level, score }) => {
			acc[start_level] = score;
			return acc;
		}, {});
	}

	async getTop3(user, since = 0) {
		const result = await dbPool.query(
			`
				SELECT score, end_level
				FROM scores
				WHERE player_id = $1
				AND datetime >= to_timestamp($2)
				ORDER BY score DESC
				LIMIT 3
			`,
			[user.id, since]
		);

		try {
			return result.rows.map(row => {
				return {
					score: parseInt(row.score, 10),
					end_level: parseInt(row.end_level, 10),
				};
			});
		} catch (err) {
			console.warn(err);
			return [];
		}
	}

	async _getCurrentSessionId(user, db_client = null) {
		const result = await (db_client || dbPool).query(
			`
			SELECT id, datetime, session
			FROM scores
			WHERE player_id=$1
			ORDER BY datetime DESC
			LIMIT 1
			`,
			[user.id]
		);

		const last_game = result.rows[0];

		let session = 1;

		if (last_game) {
			session = last_game.session;

			if (Date.now() - last_game.datetime > SESSION_BREAK_MS) {
				session += 1;
			}
		}

		return session;
	}

	async recordGame(user, game_data) {
		if (!game_data) return;

		const session = await this._getCurrentSessionId(user);
		const result = await dbPool.query(
			`
			INSERT INTO scores
			(
				datetime,
				player_id,
				session,
				start_level,
				end_level,
				score,
				lines,
				tetris_rate,
				num_droughts,
				max_drought,
				das_avg,
				duration,
				clears,
				pieces,
				transition,
				num_frames,
				frame_file,
				manual,
				competition
			)
			VALUES
			(
				NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
			)
			RETURNING id
			`,
			[
				user.id,
				session,
				game_data.start_level,
				game_data.end_level,
				game_data.score,
				game_data.lines,
				game_data.tetris_rate,
				game_data.num_droughts,
				game_data.max_drought,
				game_data.das_avg,
				game_data.duration,
				(game_data.clears || '').slice(0, 600),
				(game_data.pieces || '').slice(0, 2400),
				game_data.transition,
				game_data.num_frames,
				game_data.frame_file,
				!!game_data.manual,
				!!game_data.competition,
			]
		);

		return result.rows[0].id;
	}

	async recordQualResult(user, on_behalf_of_user, score_id, event_name) {
		const result = await dbPool.query(
			`
			INSERT INTO qual_scores
			(
				event,
				player_id,
				score_id,
				on_behalf_of_user_id,
				display_name
			)
			VALUES
			(
				$1, $2, $3, $4, $5
			)
			`,
			[
				event_name,
				user.id,
				score_id,
				on_behalf_of_user.id,
				on_behalf_of_user.display_name,
			]
		);

		return result.rowCount === 1;
	}

	async getQualResults(event_name, max_value = 999999) {
		const result = await dbPool.query(
			`
			SELECT
				qs.on_behalf_of_user_id as user_id,
				qs.display_name as display_name,
				SUM((s.score >= $1)::int) AS num_maxes,
				MAX(CASE WHEN s.score < $1 THEN s.score ELSE 0 END) AS kicker,
				COUNT(*) as num_scores
			FROM qual_scores qs INNER JOIN scores s on qs.score_id = s.id
			WHERE qs.event = $2
			GROUP BY qs.on_behalf_of_user_id, qs.display_name
			ORDER BY num_maxes DESC, kicker DESC;
			`,
			[max_value, event_name]
		);

		// type cast num maxes and scores to int
		result.rows.forEach(row => {
			row.num_maxes = parseInt(row.num_maxes, 10);
			row.num_scores = parseInt(row.num_scores, 10);
		});

		return result.rows;
	}

	async getNumberOfScores(user, options = {}) {
		const { args, conditions } = this.buildConditions(user, options);

		const result = await dbPool.query(
			`
			SELECT count(*)
			FROM scores
			WHERE ${conditions}
		`,
			args
		);

		return parseInt(result.rows[0].count, 10);
	}

	async getScorePage(user, options = {}) {
		options = {
			sort_field: 'datetime',
			sort_order: 'desc',
			page_size: 100,
			page_idx: 0,

			...options,
		};

		const { args, conditions } = this.buildConditions(user, options);

		let null_handling = '';

		if (options.sort_field === 'tetris_rate') {
			null_handling =
				options.sort_order === 'desc' ? 'NULLS last' : 'NULLS first';
		}

		// WARNING: this query uses plain JS variable interpolation, parameters MUST be safe
		const result = await dbPool.query(
			`
			SELECT id, datetime, start_level, end_level, score, lines, tetris_rate,
				   num_droughts, max_drought, das_avg, duration, frame_file, competition
			FROM scores
			WHERE ${conditions}
			ORDER BY ${options.sort_field} ${options.sort_order} ${null_handling}
			LIMIT ${options.page_size} OFFSET ${options.page_size * options.page_idx}
		`,
			args
		);

		return result.rows;
	}

	async deleteScore(user, score_id) {
		return dbPool.query(
			`
			DELETE FROM scores
			WHERE player_id=$1 AND id=$2
			`,
			[user.id, score_id]
		);
	}

	async getScore(user, score_id) {
		const result = await dbPool.query(
			`
			SELECT * FROM scores
			WHERE player_id=$1 AND id=$2
			`,
			[user.id, score_id]
		);

		return result.rows[0];
	}

	async updateScore(user, game_id, competition = false) {
		// this query has the potential to create a conflict with the index IDX_scores_manual_scores
		// and it could throw
		const result = await dbPool.query(
			`
				UPDATE scores
				SET competition=$3
				WHERE player_id=$1 AND id=$2
				`,
			[user.id, game_id, !!competition]
		);

		return result.rowCount === 1;
	}

	async getProgress(user, options = {}) {
		const { args, conditions } = this.buildConditions(user, options);

		const result = await dbPool.query(
			`
			SELECT
				session,
				min(datetime) AS datetime,
				count(id) AS num_games,
				max(score) AS max_score,
				round(avg(score)) AS avg_score
			FROM scores
			WHERE ${conditions}
			GROUP BY session
			ORDER BY session asc
			`,
			args
		);

		return result.rows;
	}

	async getAnonymousScore(score_id) {
		const result = await dbPool.query(
			`
			SELECT s.*, u.login, u.display_name, u.profile_image_url, u.country_code
			FROM scores s, users u
			WHERE s.player_id=u.id
				AND s.id=$1
			`,
			[score_id]
		);

		return result.rows[0];
	}

	async setPB(user, update) {
		const session = await this._getCurrentSessionId(user);

		// atomic upsert
		const result = await dbPool.query(
			`
			INSERT INTO scores
			(
				datetime,
				player_id,
				session,
				start_level,
				end_level,
				score,
				competition,
				manual,

				lines,
				tetris_rate,
				num_droughts,
				max_drought,
				das_avg,
				duration,
				clears,
				pieces,
				transition,
				num_frames,
				frame_file
			)
			VALUES
			(
				NOW(), $1, $2, $3, $4, $5, $6, true, 0, 0, 0, 0, -1, 0, '', '', 0, 0, ''
			)
			ON CONFLICT (player_id, start_level, competition) where manual
			DO UPDATE SET datetime=NOW(), end_level=$4, score=$5
			`,
			[
				user.id,
				session,
				update.start_level,
				update.end_level,
				update.score,
				!!update.competition,
			]
		);

		return result.rowCount === 1;
	}

	// buildConditions: build parameter array and WHERE clause fragment for score queries
	buildConditions(user, options = {}) {
		const args = [user.id];
		let conditions = `player_id=$1`;

		if (options.start_level != null) {
			args.push(options.start_level);
			conditions += ` AND start_level=$${args.length}`;
		}
		if (options.competition === true || options.competition === false) {
			args.push(!!options.competition);
			conditions += ` AND competition=$${args.length}`;
		}
		if (options.since != null) {
			args.push(options.since);
			conditions += ` AND datetime >= to_timestamp($${args.length})`;
		}
		if (options.until != null) {
			args.push(options.until);
			conditions += ` AND datetime < to_timestamp($${args.length})`;
		}

		if (options.game_ids && options.game_ids.length > 0) {
			const placeholders = options.game_ids.map(id => {
				args.push(id);
				return `$${args.length}`;
			});
			conditions += ` AND id IN (${placeholders.join(',')}) `;
		}

		return { args, conditions };
	}

	async getHighlightStats(args, conditions) {
		const hightlights = [
			{ stat: 'highest_score', select: 'score' },
			{
				stat: 'highest_transition',
				select: 'CASE WHEN transition IS NOT NULL THEN transition END',
			},
			{
				stat: 'highest_post',
				select: 'CASE WHEN transition IS NOT NULL THEN score - transition END',
			},
			{ stat: 'highest_lines', select: 'lines' },
		];

		const stats = {};
		for (const hl of hightlights) {
			const result = await dbPool.query(
				`
				SELECT id, datetime, ${hl.select} as value
				FROM scores
				WHERE ${conditions} AND ${hl.select} IS NOT NULL
				ORDER BY value DESC
				LIMIT 1
				`,
				args
			);

			const row = result.rows[0];
			stats[hl.stat] = row
				? {
						value: row.value,
						ids: [row.id],
						datetime: row.datetime,
					}
				: {
						value: null,
						ids: [],
						datetime: null,
					};
		}

		return stats;
	}

	async getAveragesAndOverallStats(args, conditions) {
		const result = await dbPool.query(
			`
			SELECT
				AVG(score)::float AS avg_score,
				AVG(CASE WHEN transition IS NOT NULL THEN transition::INTEGER END)::float AS avg_transition,
				AVG(CASE WHEN transition IS NOT NULL THEN score - transition END)::float AS avg_post,
				AVG(lines)::float AS avg_lines,
				COUNT(id)::integer AS num_games,
				SUM(CASE WHEN transition IS NOT NULL AND transition<>0 THEN 1 ELSE 0 END)::float / COUNT(*) * 100 AS transition_rate,
				STDDEV(score)::float AS score_stddev,
				SUM(CASE WHEN score > 999999 THEN 1 ELSE 0 END)::integer AS num_maxouts
			FROM scores
			WHERE ${conditions}
			`,
			args
		);

		const stats = result.rows[0];
		for (const stat of Object.keys(stats)) {
			stats[stat] = { value: stats[stat], ids: [], datetime: null };
		}

		return result.rows.length > 0 ? result.rows[0] : {};
	}

	getFullStatObjects(current, previous) {
		const stats = {};
		for (const key of Object.keys(current)) {
			const cur = current[key];
			const prev = previous ? previous[key] : undefined;

			const delta =
				prev && prev.value != null && cur.value != null
					? cur.value - prev.value
					: null;

			const pct_change =
				prev && prev.value != null && prev.value !== 0
					? (delta / Math.abs(prev.value)) * 100
					: null;

			stats[key] = {
				value: cur.value,
				delta,
				pct_change,
				current_ids: cur.ids,
				previous_ids: prev ? prev.ids : [],
				datetime: cur.datetime || null,
			};
		}

		return stats;
	}

	async getPerformanceSummaryStats(user, options) {
		const { args, conditions } = this.buildConditions(user, options);
		const highlights = await this.getHighlightStats(args, conditions);
		const averagesAndOveralls = await this.getAveragesAndOverallStats(
			args,
			conditions
		);

		return { ...highlights, ...averagesAndOveralls };
	}

	async getPerformanceSummary(user, options = {}) {
		const current = await this.getPerformanceSummaryStats(user, options);

		let previous = null;
		if (options && options.since) {
			previous = await this.getPerformanceSummaryStats(user, {
				...options,
				since: options.since_prev_start,
				until: options.since_prev_end,
			});
		}

		return this.getFullStatObjects(current, previous);
	}
}

export default new ScoreDAO();

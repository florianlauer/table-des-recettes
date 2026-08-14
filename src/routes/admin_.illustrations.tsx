import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { adminTokenState, useAdminToken } from '../lib/adminToken'
import { dataView } from '../lib/dataView'
import { estimateFrom } from '../lib/estimate'
import { formatCount } from '../lib/formatCount'
import { groupByDay } from '../lib/groupByDay'
import {
  ILLUSTRATION_WORK_LISTED,
  ILLUSTRATION_WORK_MAX,
} from '../lib/illustrationLimits'
import { nonEmpty } from '../lib/journalStats'
import { useGestures, useOrphanedRows } from '../lib/useGestures'
import type { Gestures } from '../lib/useGestures'
import { useServerClock } from '../lib/useServerClock'
import { adminHead } from './-adminHead'
import { AdminSectionState } from './-AdminSectionState'
import { BeautifyStats } from './-BeautifyStats'
import { IllustrationRow } from './-IllustrationRow'
import type { WorkSection } from './-IllustrationRow'
import { OrphanedOutcomes } from './-OrphanedOutcomes'

export const Route = createFileRoute('/admin_/illustrations')({
  component: IllustrationsPage,
  head: adminHead,
})

/**
 * Read off the server rather than retyped: the wire shape is declared once, as a validator, and
 * every shape on this screen is inferred from it. A hand-kept copy is unguarded — it typechecks
 * clean while being wrong, and it drifts weaker than the contract without saying so.
 */
type Work = (typeof api.illustrations.listIllustrationWork)['_returnType']

/**
 * The most counter-intuitive result of the T13 bench, and the screen is the only place where it can
 * act: framed wide, keeping the printed text, the model cleared the credibility barrier 4 times out
 * of 4; framed tight on the dish alone, 1 out of 4. It restores when it has to cut out.
 */
const FRAMING_ADVICE =
  'Photographie la page telle quelle, en gardant le texte imprimé autour du plat.'

/** The three sections that start folded. `toBeautify` is not one of them: it is the main flow. */
type Foldable = 'missing' | 'sourceHasNone' | 'done'

type Limits = {
  toBeautify: number
  missing: number | null
  sourceHasNone: number | null
  done: number | null
}

function IllustrationsPage() {
  const { token } = useAdminToken()
  const adminToken = token ?? ''
  const gestures = useGestures({ epoch: `illustrations:${adminToken}` })
  const { now } = useServerClock(adminToken)

  /**
   * The open state of a folded section **is** its query argument: `null` means its rows are not
   * fetched at all. Its documents are still read server-side, so the summary can carry a number —
   * what folding saves is the urls and the images behind them.
   */
  const [limits, setLimits] = useState<Limits>({
    toBeautify: ILLUSTRATION_WORK_LISTED,
    missing: null,
    sourceHasNone: null,
    done: null,
  })

  const fold = (section: Foldable, open: boolean) =>
    setLimits((current) => ({
      ...current,
      [section]: open ? ILLUSTRATION_WORK_LISTED : null,
    }))
  const showMore = (section: Foldable | 'toBeautify') =>
    setLimits((current) => ({
      ...current,
      [section]:
        (current[section] ?? ILLUSTRATION_WORK_LISTED) +
        ILLUSTRATION_WORK_LISTED,
    }))

  const work = useQuery({
    ...convexQuery(
      api.illustrations.listIllustrationWork,
      adminToken ? { adminToken, limits } : 'skip',
    ),
    retry: false,
  })
  // Hoisted out of the statistics block: the journal that reports what a generation costs is also
  // what says how long one usually takes, and every row's bar reads it.
  const stats = useQuery({
    ...convexQuery(
      api.illustrations.beautifyStats,
      adminToken ? { adminToken } : 'skip',
    ),
    retry: false,
  })
  const estimateMs = estimateFrom(stats.data ?? [])
  const tokenAbsent = adminTokenState(token) === 'absent'
  const statsView = dataView({
    tokenAbsent,
    loading: stats.isLoading,
    error: stats.error,
    data: stats.data,
  })
  const statsRows = statsView.kind === 'ready' ? nonEmpty(statsView.data) : null
  const workView = dataView({
    tokenAbsent,
    loading: work.isLoading,
    error: work.error,
    data: work.data,
  })

  const data = workView.kind === 'ready' ? workView.data : null

  /**
   * A working row can leave the data under its own gesture — a photo attached moves the recipe out of
   * "Sans photo". Its run is kept until it resolves and its message resurfaces at section level;
   * dropping it here would discard the completion instead.
   */
  const liveRowIds = data
    ? new Set<string>(
        [
          ...data.active.rows,
          ...data.toBeautify.rows,
          ...data.missing.rows,
          ...data.sourceHasNone.rows,
          ...data.done.rows,
        ].map((row) => row.id),
      )
    : null
  useOrphanedRows({ gestures, liveRowIds })

  const rowProps = { adminToken, gestures, now, estimateMs }

  return (
    <main className="page admin-page">
      <header className="admin-page__header">
        <h1>Photos des plats</h1>
        <p>
          <Link to="/admin">Retour à l’administration</Link>
        </p>
        <p>{FRAMING_ADVICE}</p>
      </header>

      <OrphanedOutcomes gestures={gestures} />

      <AdminSectionState
        view={workView}
        absent="Saisis le jeton administrateur pour afficher la file des photos."
        retry={() => void work.refetch()}
      />

      {data && (
        <>
          <MigrationBanner migration={data.migration} />

          <section className="illustrations__section">
            <h2>À arbitrer</h2>
            {data.active.count === 0 && (
              <p className="empty">Rien à arbitrer.</p>
            )}
            {data.active.truncated && (
              <p role="alert">
                Plus de générations en cours que l’écran n’en affiche : arbitre
                celles-ci d’abord.
              </p>
            )}
            <DayGroups section={data.active} {...rowProps} />
          </section>

          {/* Always open, and second: this is the flow the screen exists for. A photo posted and not
              yet beautified used to land in "Déjà illustrées", behind a checkbox — the main step
              filed under "finished". */}
          <section className="illustrations__section">
            <h2>À embellir</h2>
            {!data.stagesReady && <MigratingNotice />}
            {data.stagesReady && data.toBeautify.count === 0 && (
              <p className="empty">Aucune photo n’attend d’être embellie.</p>
            )}
            <DayGroups section={data.toBeautify} {...rowProps} />
            <MoreRows
              section={data.toBeautify}
              limit={limits.toBeautify}
              onMore={() => showMore('toBeautify')}
            />
          </section>

          <FoldedSection
            title="Sans photo"
            section={data.missing}
            limit={limits.missing}
            ready={data.stagesReady}
            empty="Toutes les recettes classées ont une photo."
            onFold={(open) => fold('missing', open)}
            onMore={() => showMore('missing')}
            {...rowProps}
          />

          <FoldedSection
            title="Sans photo dans la source"
            section={data.sourceHasNone}
            limit={limits.sourceHasNone}
            ready={data.stagesReady}
            empty="Aucune recette marquée."
            onFold={(open) => fold('sourceHasNone', open)}
            onMore={() => showMore('sourceHasNone')}
            {...rowProps}
          />

          <FoldedSection
            title="Terminées"
            section={data.done}
            limit={limits.done}
            ready={data.stagesReady}
            empty="Aucun embellissement publié."
            onFold={(open) => fold('done', open)}
            onMore={() => showMore('done')}
            {...rowProps}
          />
        </>
      )}

      <section className="admin-page__stats">
        <h2>Générations d’images</h2>
        <AdminSectionState
          view={statsView}
          absent="Saisis le jeton administrateur pour afficher le journal."
          retry={() => void stats.refetch()}
        />
        {estimateMs === null && statsRows && (
          <p>
            Pas encore assez d’appels sur la configuration en service pour
            estimer une durée.
          </p>
        )}
        {statsView.kind === 'ready' &&
          (statsRows ? (
            <BeautifyStats rows={statsRows} />
          ) : (
            <p className="empty">Aucune génération journalisée.</p>
          ))}
      </section>
    </main>
  )
}

type RowProps = {
  adminToken: string
  gestures: Gestures
  now: number
  estimateMs: number | null
}

/** The count a summary can honestly show: exact below the probe, "50+" above it. */
function sectionCount({ count, truncated }: WorkSection): string {
  return truncated ? `${count}+` : `${count}`
}

function MigratingNotice() {
  return <p className="empty">Indisponible pendant la migration.</p>
}

/**
 * The rows of one section, cut by day. The separator is what makes recency legible in a list of
 * fifty: the index already orders by "last time this recipe's photo work moved", so the batch of the
 * day is the top block and nothing has to be sorted here.
 */
function DayGroups({
  section,
  now,
  ...rowProps
}: { section: WorkSection } & RowProps) {
  return groupByDay(section.rows, now).map((group) => (
    // Keyed on the first row and not on the day: the same day can open a second group further down
    // when the order says so, and two `<div key="2026-08-14">` would collide.
    <div className="illustrations__day" key={group.items[0]?.id ?? group.key}>
      <h4 className="illustrations__day-label">{group.label}</h4>
      {group.items.map((row) => (
        <IllustrationRow key={row.id} row={row} now={now} {...rowProps} />
      ))}
    </div>
  ))
}

/**
 * Either a way to see more or an honest wall. At the hard ceiling the button would raise a limit the
 * server clamps straight back, so it gives way to the sentence the project already uses for a capped
 * list — a control that does nothing is worse than naming the limit.
 */
function MoreRows({
  section,
  limit,
  onMore,
}: {
  section: WorkSection
  limit: number | null
  onMore: () => void
}) {
  if (!section.truncated || limit === null) return null
  if (limit >= ILLUSTRATION_WORK_MAX)
    return <p>Liste plafonnée : traite celles-ci, les suivantes viendront.</p>
  return (
    <button type="button" className="illustrations__more" onClick={onMore}>
      Afficher {ILLUSTRATION_WORK_LISTED} de plus
    </button>
  )
}

/**
 * `<details>`/`<summary>` native rather than a JS accordion: the open state is the browser's, and all
 * React adds is telling the query to fetch the rows. Nothing is rendered while folded.
 */
function FoldedSection({
  title,
  section,
  limit,
  ready,
  empty,
  onFold,
  onMore,
  ...rowProps
}: {
  title: string
  section: WorkSection
  limit: number | null
  ready: boolean
  empty: string
  onFold: (open: boolean) => void
  onMore: () => void
} & RowProps) {
  return (
    <details
      className="illustrations__section illustrations__fold"
      onToggle={(event) => onFold(event.currentTarget.open)}
    >
      <summary className="illustrations__fold-summary">
        <span className="illustrations__fold-title">{title}</span>
        {/* An em dash rather than a zero while the backfill runs: nobody counted these yet, and a
            zero would read as an answer. */}
        <span className="illustrations__fold-count">
          {ready ? sectionCount(section) : '—'}
        </span>
      </summary>
      {!ready && <MigratingNotice />}
      {ready && limit !== null && section.count === 0 && (
        <p className="empty">{empty}</p>
      )}
      <DayGroups section={section} {...rowProps} />
      <MoreRows section={section} limit={limit} onMore={onMore} />
    </details>
  )
}

/**
 * No button. The backfill is run by the deploy itself — `vercel.json` in production, the preview
 * workflow after its data import — so there is nothing here for the operator to remember. A screen
 * whose main flow depends on someone pressing "Lancer la migration" is a screen that breaks the day
 * they forget.
 */
function MigrationBanner({ migration }: { migration: Work['migration'] }) {
  if (migration.ready) return null
  const classified = formatCount(
    migration.processed,
    'recette classée',
    'recettes classées',
  )
  // A div, not a `<p role="alert">`: the count below changes as the backfill advances, and announced
  // assertively at every tick it would be noise.
  return (
    <div className="admin-page__banner">
      <p>
        {migration.state === 'inProgress'
          ? `Classement en cours : ${classified}.`
          : migration.state === 'unknown'
            ? 'Les recettes ne sont pas encore classées par étape.'
            : `Le classement s’est interrompu à ${classified}. Il reprend au prochain déploiement.`}
      </p>
      {/* No bar: `listIllustrationWork` reports how many recipes are classified and no total — one
          document read, which is exactly what the batched backfill exists to preserve. A fraction
          would need a denominator nobody can produce without scanning the table. */}
      <p>
        La file par étape est indisponible jusqu’à la fin. L’arbitrage, lui,
        reste entier.
      </p>
    </div>
  )
}

import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import type { ApiError, Lead, LeadStage } from '../types/index.js'

// =============================================================================
// GET /api/leads
// =============================================================================
// Lista paginada de leads con filtros opcionales.
// Accesible por todos los roles autenticados.
//
// Query params (todos opcionales):
//   page      number   Página actual (base 1). Default: 1.
//   limit     number   Registros por página. Default: 10. Máximo: 100.
//   stage     string   Filtrar por stage (enum LeadStage).
//   source    string   Filtrar por fuente exacta.
//   search    string   Búsqueda ILIKE en name y email (requiere índice pg_trgm).
//   date_from string   ISO 8601 — created_at >= date_from.
//   date_to   string   ISO 8601 — created_at <= date_to.
// =============================================================================

export const leadsRouter = Router()

const VALID_STAGES: LeadStage[] = [
  'new','contacted','qualified','proposal','negotiation','won','lost',
]

// ── GET /api/leads/interaction-status ────────────────────────────────────────
// ?city=bucaramanga&since=YYYY-MM-DD&until=YYYY-MM-DD (since/until opcionales)

leadsRouter.get('/interaction-status', authenticate, async (req, res) => {
  try {
    const city  = req.query.city  as string | undefined
    const since = req.query.since as string | undefined
    const until = req.query.until as string | undefined

    if (!city) {
      res.status(400).json({ error: 'Parámetro "city" requerido', status: 400 } as ApiError)
      return
    }

    let query = supabaseAdmin
      .from('leads')
      .select('id, last_activity_at, ghl_date_added')

    // Filtro por ciudad via tag
    query = query.filter('tags', 'cs', `{"${city}"}`)

    if (since) query = query.gte('ghl_date_added', since)
    if (until) query = query.lte('ghl_date_added', `${until}T23:59:59Z`)

    const { data, error } = await query

    if (error) {
      res.status(500).json({ error: error.message, code: 'DB_ERROR', status: 500 } as ApiError)
      return
    }

    const leads = data ?? []
    const total = leads.length

    const withInteraction = leads.filter((l) => {
      if (!l.last_activity_at) return false
      if (!l.ghl_date_added)   return true
      const addedMs  = new Date(l.ghl_date_added).getTime()
      const activeMs = new Date(l.last_activity_at).getTime()
      return activeMs > addedMs + 6 * 3_600_000
    }).length

    const withoutInteraction = total - withInteraction

    res.json({
      city,
      since: since ?? null,
      until: until ?? null,
      total_leads:         total,
      with_interaction:    withInteraction,
      without_interaction: withoutInteraction,
      with_pct:    total > 0 ? Math.round((withInteraction / total)    * 100 * 10) / 10 : 0,
      without_pct: total > 0 ? Math.round((withoutInteraction / total) * 100 * 10) / 10 : 0,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 } as ApiError)
  }
})

// ── GET /api/leads ────────────────────────────────────────────────────────────

leadsRouter.get('/', authenticate, async (req, res) => {
  // ── Parsear y validar parámetros ────────────────────────────────────────────
  const page  = Math.max(1, parseInt(String(req.query.page  ?? 1), 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 10), 10) || 10))
  const from  = (page - 1) * limit
  const to    = from + limit - 1

  const stage     = req.query.stage     as string | undefined
  const source    = req.query.source    as string | undefined
  const search    = req.query.search    as string | undefined
  const date_from = req.query.date_from as string | undefined
  const date_to   = req.query.date_to   as string | undefined

  if (stage && !VALID_STAGES.includes(stage as LeadStage)) {
    const err: ApiError = { error: `Stage inválido: ${stage}`, code: 'INVALID_PARAM', status: 400 }
    res.status(400).json(err)
    return
  }

  try {
    // ── Construir query ─────────────────────────────────────────────────────
    let query = supabaseAdmin
      .from('leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (stage)     query = query.eq('stage', stage)
    if (source)    query = query.eq('source', source)
    if (date_from) query = query.gte('created_at', date_from)
    if (date_to)   query = query.lte('created_at', date_to)

    // Búsqueda textual: usa índices pg_trgm (migración 004) vía ilike
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
    }

    const { data, error, count } = await query

    if (error) {
      const err: ApiError = { error: error.message, code: 'DB_ERROR', status: 500 }
      res.status(500).json(err)
      return
    }

    const total       = count ?? 0
    const total_pages = Math.ceil(total / limit)

    res.json({
      data: data as Lead[],
      meta: { total, page, limit, total_pages },
    })
  } catch (err) {
    const apiErr: ApiError = {
      error:  err instanceof Error ? err.message : 'Error interno del servidor',
      status: 500,
    }
    res.status(500).json(apiErr)
  }
})

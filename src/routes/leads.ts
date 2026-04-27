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

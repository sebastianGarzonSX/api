import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import type { DashboardKPIs, StageCount, SourceCount } from './dashboard.types.js'
import type { ApiError } from '../types/index.js'

export const dashboardRouter = Router()

// ── Stage key mapping ─────────────────────────────────────────────────────────

const STAGE_PATTERNS: Array<{ key: string; patterns: string[] }> = [
  { key: 'cold',       patterns: ['frío', 'frio', 'sin interac', 'cold'] },
  { key: 'interacted', patterns: ['interactuó', 'interactuo', 'contactad', 'respondió', 'respondio', 'interacción'] },
  { key: 'survey',     patterns: ['pregunta', 'muestreo', 'lead magnet', 'primera'] },
  { key: 'decision',   patterns: ['decisión', 'decision', 'evaluac', 'considera'] },
  { key: 'payment',    patterns: ['pago', 'solicitud', 'link', 'precio'] },
  { key: 'won',        patterns: ['venta', 'ganado', 'won', 'compra', 'cerró', 'cerro', 'realizada'] },
]

function mapStageKey(stageName: string): string | null {
  const lower = stageName.toLowerCase()
  for (const { key, patterns } of STAGE_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) return key
  }
  return null
}

// ── GET /api/dashboard/kpis ───────────────────────────────────────────────────

dashboardRouter.get('/kpis', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_dashboard_kpis')
    if (error) {
      res.status(500).json({ error: error.message, code: 'DB_ERROR', status: 500 } as ApiError)
      return
    }
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 } as ApiError)
  }
})

// ── GET /api/dashboard/funnel ─────────────────────────────────────────────────
// ?city=bucaramanga&since=YYYY-MM-DD&until=YYYY-MM-DD&pipeline_type=registro|venta

dashboardRouter.get('/funnel', authenticate, async (req, res) => {
  try {
    const city          = req.query.city          as string | undefined
    const since         = req.query.since         as string | undefined
    const until         = req.query.until         as string | undefined
    const pipelineType  = (req.query.pipeline_type as string | undefined) ?? 'registro'

    if (!city) {
      res.status(400).json({ error: 'Parámetro "city" requerido', status: 400 } as ApiError)
      return
    }
    if (!since || !until) {
      res.status(400).json({ error: 'Parámetros "since" y "until" requeridos', status: 400 } as ApiError)
      return
    }

    const { data, error } = await supabaseAdmin.rpc('get_funnel_by_city', {
      p_city:          city,
      p_since:         since,
      p_until:         until,
      p_pipeline_type: pipelineType,
    })

    if (error) {
      res.status(500).json({ error: error.message, code: 'DB_ERROR', status: 500 } as ApiError)
      return
    }

    // Enriquecer cada etapa con stage_key y cost_per_lead
    const result = data as {
      city: string
      since: string
      until: string
      pipeline_type: string
      total_leads: number
      meta_spend: number
      stages: Array<{ stage_name: string; stage_position: number; count: number; won: number; lost: number }>
    }

    const enrichedStages = (result.stages ?? []).map((s) => ({
      stage_key:     mapStageKey(s.stage_name),
      stage_name:    s.stage_name,
      count:         s.count,
      percentage:    result.total_leads > 0
        ? Math.round((s.count / result.total_leads) * 100 * 10) / 10
        : 0,
      cost_per_lead: result.meta_spend > 0 && s.count > 0
        ? Math.round((result.meta_spend / s.count) * 100) / 100
        : null,
    }))

    res.json({ ...result, stages: enrichedStages })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 } as ApiError)
  }
})

// ── GET /api/dashboard/traffic ────────────────────────────────────────────────
// ?since=YYYY-MM-DD&until=YYYY-MM-DD&city=bucaramanga (city opcional)

dashboardRouter.get('/traffic', authenticate, async (req, res) => {
  try {
    const since = req.query.since as string | undefined
    const until = req.query.until as string | undefined
    const city  = (req.query.city as string | undefined) ?? null

    if (!since || !until) {
      res.status(400).json({ error: 'Parámetros "since" y "until" requeridos', status: 400 } as ApiError)
      return
    }

    const { data, error } = await supabaseAdmin.rpc('get_traffic_kpis', {
      p_since: since,
      p_until: until,
      p_city:  city,
    })

    if (error) {
      res.status(500).json({ error: error.message, code: 'DB_ERROR', status: 500 } as ApiError)
      return
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 } as ApiError)
  }
})

// ── GET /api/dashboard/ads-preview ───────────────────────────────────────────
// ?since=YYYY-MM-DD&until=YYYY-MM-DD

dashboardRouter.get('/ads-preview', authenticate, async (req, res) => {
  try {
    const since = req.query.since as string | undefined
    const until = req.query.until as string | undefined

    if (!since || !until) {
      res.status(400).json({ error: 'Parámetros "since" y "until" requeridos', status: 400 } as ApiError)
      return
    }

    const { data, error } = await supabaseAdmin
      .from('meta_ads')
      .select('ad_id, ad_name, campaign_name, adset_name, ad_status, thumbnail_url, preview_link, spend, impressions, clicks, ctr, conversions, cost_per_result')
      .gte('date_start', since)
      .lte('date_stop',  until)
      .not('thumbnail_url', 'is', null)
      .order('spend', { ascending: false })
      .limit(50)

    if (error) {
      res.status(500).json({ error: error.message, code: 'DB_ERROR', status: 500 } as ApiError)
      return
    }

    const ads = (data ?? []).map((row) => ({
      ad_id:         row.ad_id,
      ad_name:       row.ad_name ?? '',
      campaign_name: row.campaign_name ?? '',
      adset_name:    row.adset_name ?? null,
      status:        (row.ad_status ?? 'UNKNOWN') as string,
      thumbnail_url: row.thumbnail_url ?? null,
      preview_link:  row.preview_link  ?? null,
      spend:         row.spend       ?? 0,
      impressions:   row.impressions ?? 0,
      clicks:        row.clicks      ?? 0,
      ctr:           row.ctr         ?? 0,
      conversions:   row.conversions ?? 0,
      cpl:           row.conversions > 0 && row.spend > 0
        ? Math.round((row.spend / row.conversions) * 100) / 100
        : null,
    }))

    res.json({ since, until, ads })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 } as ApiError)
  }
})

// ── GET /api/dashboard/survey ─────────────────────────────────────────────────
// ?since=YYYY-MM-DD&until=YYYY-MM-DD&city=bucaramanga (city opcional)

dashboardRouter.get('/survey', authenticate, async (req, res) => {
  try {
    const since = req.query.since as string | undefined
    const until = req.query.until as string | undefined
    const city  = (req.query.city as string | undefined) ?? null

    if (!since || !until) {
      res.status(400).json({ error: 'Parámetros "since" y "until" requeridos', status: 400 } as ApiError)
      return
    }

    const { data, error } = await supabaseAdmin.rpc('get_survey_breakdown', {
      p_since: since,
      p_until: until,
      p_city:  city,
    })

    if (error) {
      res.status(500).json({ error: error.message, code: 'DB_ERROR', status: 500 } as ApiError)
      return
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 } as ApiError)
  }
})

export type { DashboardKPIs, StageCount, SourceCount }

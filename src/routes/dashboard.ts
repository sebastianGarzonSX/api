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

// ── Helper: meta spend filtrado por campaign_ids ─────────────────────────────

async function getFilteredMetaSpend(
  since: string,
  until: string,
  campaignIds: string[]
): Promise<number> {
  let query = supabaseAdmin
    .from('meta_campaigns')
    .select('spend')
    .gte('date_start', since)
    .lte('date_stop', until)

  if (campaignIds.length > 0) {
    query = query.in('campaign_id', campaignIds)
  }

  const { data } = await query
  return (data ?? []).reduce((sum, r) => sum + (r.spend ?? 0), 0)
}

async function getFilteredMetaTotals(
  since: string,
  until: string,
  campaignIds: string[]
) {
  let query = supabaseAdmin
    .from('meta_campaigns')
    .select('spend, impressions, clicks, conversions')
    .gte('date_start', since)
    .lte('date_stop', until)

  if (campaignIds.length > 0) {
    query = query.in('campaign_id', campaignIds)
  }

  const { data } = await query
  const rows = data ?? []
  return {
    spend:       rows.reduce((s, r) => s + (r.spend ?? 0), 0),
    impressions: rows.reduce((s, r) => s + (r.impressions ?? 0), 0),
    clicks:      rows.reduce((s, r) => s + (r.clicks ?? 0), 0),
    conversions: rows.reduce((s, r) => s + (r.conversions ?? 0), 0),
  }
}

function parseCampaignIds(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

// ── GET /api/dashboard/funnel ─────────────────────────────────────────────────
// ?city=bucaramanga&since=YYYY-MM-DD&until=YYYY-MM-DD&pipeline_type=registro|venta
// &campaign_ids=id1,id2 (opcional — filtra el meta_spend por esas campañas)

dashboardRouter.get('/funnel', authenticate, async (req, res) => {
  try {
    const city          = req.query.city          as string | undefined
    const since         = req.query.since         as string | undefined
    const until         = req.query.until         as string | undefined
    const pipelineType  = (req.query.pipeline_type as string | undefined) ?? 'registro'
    const campaignIds   = parseCampaignIds(req.query.campaign_ids)

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

    const result = data as {
      city: string
      since: string
      until: string
      pipeline_type: string
      total_leads: number
      meta_spend: number
      stages: Array<{ stage_name: string; stage_position: number; count: number; won: number; lost: number }>
    }

    // Si se pasaron campaign_ids, recalcular meta_spend solo de esas campañas
    const metaSpend = campaignIds.length > 0
      ? await getFilteredMetaSpend(since, until, campaignIds)
      : result.meta_spend

    const enrichedStages = (result.stages ?? []).map((s) => ({
      stage_key:     mapStageKey(s.stage_name),
      stage_name:    s.stage_name,
      count:         s.count,
      percentage:    result.total_leads > 0
        ? Math.round((s.count / result.total_leads) * 100 * 10) / 10
        : 0,
      cost_per_lead: metaSpend > 0 && s.count > 0
        ? Math.round((metaSpend / s.count) * 100) / 100
        : null,
    }))

    res.json({ ...result, meta_spend: metaSpend, stages: enrichedStages })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 } as ApiError)
  }
})

// ── GET /api/dashboard/traffic ────────────────────────────────────────────────
// ?since=YYYY-MM-DD&until=YYYY-MM-DD&city=bucaramanga (city opcional)
// &campaign_ids=id1,id2 (opcional — recalcula métricas Meta solo de esas campañas)

dashboardRouter.get('/traffic', authenticate, async (req, res) => {
  try {
    const since       = req.query.since as string | undefined
    const until       = req.query.until as string | undefined
    const city        = (req.query.city as string | undefined) ?? null
    const campaignIds = parseCampaignIds(req.query.campaign_ids)

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

    // Si se filtra por campañas, recalcular las métricas de Meta
    if (campaignIds.length > 0) {
      const meta = await getFilteredMetaTotals(since, until, campaignIds)

      const result = data as Record<string, unknown>
      result.meta_spend       = meta.spend
      result.meta_impressions = meta.impressions
      result.meta_clicks      = meta.clicks
      result.meta_leads       = meta.conversions

      result.meta_ctr = meta.impressions > 0
        ? Math.round((meta.clicks / meta.impressions) * 100 * 10000) / 10000
        : 0
      result.meta_cpc = meta.clicks > 0
        ? Math.round((meta.spend / meta.clicks) * 10000) / 10000
        : 0
      result.meta_cpl = meta.conversions > 0
        ? Math.round((meta.spend / meta.conversions) * 10000) / 10000
        : 0

      const crmLeads = (result.crm_leads as number) ?? 0
      result.crm_cpl = crmLeads > 0
        ? Math.round((meta.spend / crmLeads) * 10000) / 10000
        : 0
      result.variation_absolute = meta.conversions - crmLeads
      result.variation_pct = meta.conversions > 0
        ? Math.round(((meta.conversions - crmLeads) / meta.conversions) * 100 * 100) / 100
        : 0
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 } as ApiError)
  }
})

// ── GET /api/dashboard/campaigns ─────────────────────────────────────────────
// ?since=YYYY-MM-DD&until=YYYY-MM-DD&account_type=eventos|clase
// Lista campañas únicas de meta_campaigns con gasto total, para el selector.
// account_type=eventos  → filtra por META_AD_ACCOUNT_ID_EVENTOS (CP5)
// account_type=clase    → filtra por META_AD_ACCOUNT_ID       (CP6)
// Sin account_type      → todas las cuentas

dashboardRouter.get('/campaigns', authenticate, async (req, res) => {
  try {
    const since        = req.query.since        as string | undefined
    const until        = req.query.until        as string | undefined
    const accountType  = req.query.account_type as string | undefined

    if (!since || !until) {
      res.status(400).json({ error: 'Parámetros "since" y "until" requeridos', status: 400 } as ApiError)
      return
    }

    // Resolver account_id según el tipo solicitado
    let filterAccountId: string | undefined
    if (accountType === 'eventos') {
      filterAccountId = process.env.META_AD_ACCOUNT_ID_EVENTOS
    } else if (accountType === 'clase') {
      filterAccountId = process.env.META_AD_ACCOUNT_ID
    }

    let allRows: Array<{ campaign_id: string; campaign_name: string; spend: number }> = []
    let from = 0
    const PAGE = 1000

    while (true) {
      let query = supabaseAdmin
        .from('meta_campaigns')
        .select('campaign_id, campaign_name, spend')
        .gte('date_start', since)
        .lte('date_stop', until)

      if (filterAccountId) {
        query = query.eq('account_id', filterAccountId)
      }

      const { data, error } = await query.range(from, from + PAGE - 1)

      if (error) {
        res.status(500).json({ error: error.message, code: 'DB_ERROR', status: 500 } as ApiError)
        return
      }

      allRows = allRows.concat(data ?? [])
      if (!data || data.length < PAGE) break
      from += PAGE
    }

    const byId = new Map<string, { campaign_id: string; campaign_name: string; spend: number }>()
    for (const row of allRows) {
      const cur = byId.get(row.campaign_id)
      if (!cur) {
        byId.set(row.campaign_id, {
          campaign_id:   row.campaign_id,
          campaign_name: row.campaign_name ?? '',
          spend:         row.spend ?? 0,
        })
      } else {
        cur.spend += row.spend ?? 0
      }
    }

    const campaigns = [...byId.values()].sort((a, b) => b.spend - a.spend)
    res.json({ campaigns, since, until })
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

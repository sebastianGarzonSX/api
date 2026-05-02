import { Router } from 'express'
import { createHmac } from 'crypto'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import type { ApiError } from '../types/index.js'

export const adsmanagerRouter = Router()

const META_BASE       = 'https://graph.facebook.com/v20.0'
const META_TIMEOUT_MS = 30_000
const ENV_TOKEN       = process.env.META_ACCESS_TOKEN ?? ''
const ENV_SECRET      = process.env.META_APP_SECRET   ?? ''

// ── Helpers ───────────────────────────────────────────────────────────────────

function appSecretProof(token: string): string {
  if (!ENV_SECRET) return ''
  return createHmac('sha256', ENV_SECRET).update(token).digest('hex')
}

async function metaFetch(path: string, token: string, extraParams: Record<string, string> = {}): Promise<unknown> {
  const proof = appSecretProof(token)
  const params = new URLSearchParams({
    access_token: token,
    ...(proof ? { appsecret_proof: proof } : {}),
    ...extraParams,
  })
  const url = `${META_BASE}${path}?${params}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS)
  const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Meta API ${res.status}: ${body}`)
  }
  return res.json()
}

async function metaPost(path: string, token: string, body: Record<string, string>): Promise<unknown> {
  const proof = appSecretProof(token)
  const params = new URLSearchParams({
    access_token: token,
    ...(proof ? { appsecret_proof: proof } : {}),
  })
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS)
  const res = await fetch(`${META_BASE}${path}?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  ctrl.signal,
  }).finally(() => clearTimeout(t))
  if (!res.ok) {
    const b = await res.text().catch(() => '')
    throw new Error(`Meta API POST ${res.status}: ${b}`)
  }
  return res.json()
}

// Paginar todos los resultados de Meta
async function metaFetchAll<T>(path: string, token: string, params: Record<string, string>): Promise<T[]> {
  const all: T[] = []

  const proof = appSecretProof(token)
  const baseParams = new URLSearchParams({
    access_token: token,
    ...(proof ? { appsecret_proof: proof } : {}),
    ...params,
  })
  let url: string | undefined = `${META_BASE}${path}?${baseParams}`

  while (url) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS)
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
    if (!res.ok) {
      const b = await res.text().catch(() => '')
      throw new Error(`Meta API ${res.status}: ${b}`)
    }
    const page = await res.json() as { data?: T[]; paging?: { next?: string } }
    if (page.data) all.push(...page.data)
    url = page.paging?.next
  }
  return all
}

// Obtener token del usuario (fallback a ENV)
async function getUserToken(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('meta_token')
    .eq('id', userId)
    .single()
  if (error) {
    console.error('[getUserToken] Supabase error:', error.message)
  }
  const userToken = (data as any)?.meta_token
  if (!userToken && !ENV_TOKEN) {
    console.warn('[getUserToken] No hay meta_token en DB ni META_ACCESS_TOKEN en env para user', userId)
  }
  return userToken || ENV_TOKEN
}

// Parsear date preset o rango custom → { since, until }
function parseDateRange(date: string, since?: string, until?: string): { since: string; until: string } {
  if (since && until) return { since, until }
  const now   = new Date()
  const today = now.toISOString().slice(0, 10)
  const days  = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10)
  const presets: Record<string, () => { since: string; until: string }> = {
    today:       () => ({ since: today, until: today }),
    yesterday:   () => { const y = days(1); return { since: y, until: y } },
    last_7d:     () => ({ since: days(6), until: today }),
    last_14d:    () => ({ since: days(13), until: today }),
    last_30d:    () => ({ since: days(29), until: today }),
    last_90d:    () => ({ since: days(89), until: today }),
    this_month:  () => { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { since: d.toISOString().slice(0, 10), until: today } },
    last_month:  () => {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const l = new Date(now.getFullYear(), now.getMonth(), 0)
      return { since: f.toISOString().slice(0, 10), until: l.toISOString().slice(0, 10) }
    },
  }
  return (presets[date] ?? presets['last_30d'])()
}

// ── GET /api/adsmanager/accounts ─────────────────────────────────────────────
adsmanagerRouter.get('/accounts', authenticate, async (req, res) => {
  try {
    const token = await getUserToken(req.user!.id)
    if (!token) {
      console.warn('[Accounts] No token available for user', req.user!.id)
      res.status(400).json({ error: 'No hay token de Meta configurado. Ve a Configuración para agregar tu token.', accounts: [] })
      return
    }

    const data = await metaFetch('/me/adaccounts', token, {
      fields: 'id,name,currency,account_status',
      limit:  '25',
    }) as { data?: Array<{ id: string; name: string; currency: string; account_status: number }> }

    const accounts = (data.data ?? [])
      .filter(a => a.account_status === 1)
      .map(a => ({ id: a.id, name: a.name, currency: a.currency }))

    res.json(accounts)
  } catch (err) {
    console.error('[Accounts]', err)
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('190') || msg.includes('Invalid') || msg.includes('expired')) {
      res.status(401).json({ error: 'Token de Meta inválido o expirado. Actualízalo en Configuración.', accounts: [] })
    } else {
      res.status(500).json({ error: msg || 'Error al conectar con Meta', accounts: [] })
    }
  }
})

// ── GET /api/adsmanager/overview ──────────────────────────────────────────────
adsmanagerRouter.get('/overview', authenticate, async (req, res) => {
  try {
    const q       = req.query as Record<string, string>
    const account = q['account']
    const date    = q['date'] ?? 'last_30d'
    const compare = q['compare'] === '1'
    const range   = parseDateRange(date, q['since'], q['until'])

    if (!account) { res.status(400).json({ error: 'account requerido' }); return }

    const token = await getUserToken(req.user!.id)

    const insightFields = [
      'campaign_id', 'campaign_name',
      'impressions', 'clicks', 'spend', 'reach', 'ctr', 'cpm', 'frequency',
      'actions', 'cost_per_action_type', 'purchase_roas',
    ].join(',')

    const [campaigns, prevCampaigns, campaignMeta] = await Promise.all([
      metaFetchAll<Record<string, unknown>>(`/${account}/insights`, token, {
        fields:         insightFields,
        level:          'campaign',
        time_range:     JSON.stringify({ since: range.since, until: range.until }),
        limit:          '200',
      }),
      compare ? metaFetchAll<Record<string, unknown>>(`/${account}/insights`, token, {
        fields:         insightFields,
        level:          'campaign',
        time_range:     JSON.stringify({
          since: new Date(new Date(range.since).getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
          until: new Date(new Date(range.until).getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
        }),
        limit: '200',
      }) : Promise.resolve([]),
      metaFetchAll<Record<string, unknown>>(`/${account}/campaigns`, token, {
        fields: 'id,name,status,effective_status,daily_budget',
        limit:  '200',
      }),
    ])

    const campaignMetaMap = new Map<string, Record<string, unknown>>()
    for (const c of campaignMeta) {
      campaignMetaMap.set(c['id'] as string, c)
    }

    // Aggregate by campaign
    const byId = new Map<string, Record<string, unknown>>()
    for (const row of campaigns) {
      const id = row['campaign_id'] as string
      if (!byId.has(id)) {
        byId.set(id, { ...row, _rows: 1 })
      } else {
        const cur = byId.get(id)!
        cur['spend']       = (parseFloat(cur['spend'] as string ?? '0') + parseFloat(row['spend'] as string ?? '0'))
        cur['impressions'] = (parseInt(cur['impressions'] as string ?? '0', 10) + parseInt(row['impressions'] as string ?? '0', 10))
        cur['clicks']      = (parseInt(cur['clicks'] as string ?? '0', 10) + parseInt(row['clicks'] as string ?? '0', 10))
        cur['reach']       = (parseInt(cur['reach'] as string ?? '0', 10) + parseInt(row['reach'] as string ?? '0', 10))
        cur['_rows']       = (cur['_rows'] as number) + 1
        // Merge actions
        const curActions  = (cur['actions']  as Array<Record<string, unknown>>) ?? []
        const rowActions  = (row['actions']  as Array<Record<string, unknown>>) ?? []
        const merged: Record<string, number> = {}
        for (const a of [...curActions, ...rowActions]) {
          const k = a['action_type'] as string
          merged[k] = (merged[k] ?? 0) + parseFloat(a['value'] as string ?? '0')
        }
        cur['actions'] = Object.entries(merged).map(([action_type, value]) => ({ action_type, value: String(value) }))
      }
    }

    const normCampaigns = [...byId.values()].map(row => {
      const spend       = parseFloat(row['spend'] as string ?? '0')
      const impressions = parseInt(row['impressions'] as string ?? '0', 10)
      const clicks      = parseInt(row['clicks'] as string ?? '0', 10)
      const actions     = (row['actions'] as Array<Record<string, string>>) ?? []
      const campId      = row['campaign_id'] as string
      const meta        = campaignMetaMap.get(campId)

      const getAction = (types: string[]) =>
        actions.filter(a => types.includes(a['action_type'])).reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)

      const purchases  = getAction(['purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'])
      const leads      = getAction(['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'])
      const initPmt    = getAction(['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout'])
      const revenue    = (row['purchase_roas'] as Array<{value: string}>)?.[0]
        ? spend * parseFloat((row['purchase_roas'] as Array<{value: string}>)[0].value)
        : 0

      return {
        campaign_id:     campId,
        campaign_name:   row['campaign_name'],
        status:          meta?.['effective_status'] ?? meta?.['status'] ?? 'UNKNOWN',
        daily_budget:    meta?.['daily_budget'] ?? null,
        spend,
        impressions,
        clicks,
        reach:           parseInt(row['reach'] as string ?? '0', 10),
        ctr:             impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpm:             impressions > 0 ? (spend / impressions) * 1000 : 0,
        frequency:       parseFloat(row['frequency'] as string ?? '0'),
        purchases,
        leads,
        init_payments:   initPmt,
        revenue,
        roas:            spend > 0 ? revenue / spend : 0,
        cpa:             purchases > 0 ? spend / purchases : 0,
        cpl:             leads > 0    ? spend / leads    : 0,
      }
    })

    // Totals
    const totals = normCampaigns.reduce((acc, c) => {
      acc.spend       += c.spend
      acc.impressions += c.impressions
      acc.clicks      += c.clicks
      acc.purchases   += c.purchases
      acc.leads       += c.leads
      acc.revenue     += c.revenue
      return acc
    }, { spend: 0, impressions: 0, clicks: 0, purchases: 0, leads: 0, revenue: 0 })

    Object.assign(totals, {
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      cpa:  totals.purchases > 0 ? totals.spend / totals.purchases : 0,
      ctr:  totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    })

    // Previous period totals
    let prevTotals = null
    if (compare && prevCampaigns.length) {
      const pSpend = prevCampaigns.reduce((s, r) => s + parseFloat(r['spend'] as string ?? '0'), 0)
      const pImpr  = prevCampaigns.reduce((s, r) => s + parseInt(r['impressions'] as string ?? '0', 10), 0)
      const pClk   = prevCampaigns.reduce((s, r) => s + parseInt(r['clicks'] as string ?? '0', 10), 0)
      prevTotals = { spend: pSpend, impressions: pImpr, clicks: pClk, ctr: pImpr > 0 ? (pClk / pImpr) * 100 : 0 }
    }

    res.json({
      campaigns: normCampaigns.sort((a, b) => b.spend - a.spend),
      totals,
      prevTotals,
      since: range.since,
      until: range.until,
    })
  } catch (err) {
    console.error('[Overview]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error', status: 500 })
  }
})

// ── POST /api/adsmanager/pause ────────────────────────────────────────────────
adsmanagerRouter.post('/pause', authenticate, async (req, res) => {
  try {
    const { id, level = 'CAMPAIGN' } = req.body as { id: string; level?: string }
    if (!id) { res.status(400).json({ error: 'id requerido' }); return }
    const token = await getUserToken(req.user!.id)
    await metaPost(`/${id}`, token, { status: 'PAUSED' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── POST /api/adsmanager/activate ─────────────────────────────────────────────
adsmanagerRouter.post('/activate', authenticate, async (req, res) => {
  try {
    const { id } = req.body as { id: string }
    if (!id) { res.status(400).json({ error: 'id requerido' }); return }
    const token = await getUserToken(req.user!.id)
    await metaPost(`/${id}`, token, { status: 'ACTIVE' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── POST /api/adsmanager/bulk-action ─────────────────────────────────────────
adsmanagerRouter.post('/bulk-action', authenticate, async (req, res) => {
  try {
    const { ids, action } = req.body as { ids: string[]; action: 'pause' | 'activate' }
    if (!ids?.length || !action) { res.status(400).json({ error: 'ids y action requeridos' }); return }
    const token  = await getUserToken(req.user!.id)
    const status = action === 'pause' ? 'PAUSED' : 'ACTIVE'
    await Promise.all(ids.map(id => metaPost(`/${id}`, token, { status })))
    res.json({ success: true, updated: ids.length })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── POST /api/adsmanager/budget ───────────────────────────────────────────────
adsmanagerRouter.post('/budget', authenticate, async (req, res) => {
  try {
    const { id, daily_budget } = req.body as { id: string; daily_budget: number }
    if (!id || !daily_budget) { res.status(400).json({ error: 'id y daily_budget requeridos' }); return }
    const token = await getUserToken(req.user!.id)
    // Meta budget is in cents
    await metaPost(`/${id}`, token, { daily_budget: String(Math.round(daily_budget * 100)) })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── GET /api/adsmanager/top-ads ───────────────────────────────────────────────
adsmanagerRouter.get('/top-ads', authenticate, async (req, res) => {
  try {
    const q       = req.query as Record<string, string>
    const account = q['account']
    const date    = q['date'] ?? 'last_30d'
    const limit   = parseInt(q['limit'] ?? '5', 10)
    const range   = parseDateRange(date, q['since'], q['until'])

    if (!account) { res.status(400).json({ error: 'account requerido' }); return }
    const token = await getUserToken(req.user!.id)

    const fields = [
      'ad_id', 'ad_name', 'campaign_name', 'campaign_id',
      'impressions', 'clicks', 'spend', 'ctr', 'cpm',
      'actions', 'purchase_roas',
    ].join(',')

    const ads = await metaFetchAll<Record<string, unknown>>(`/${account}/insights`, token, {
      fields,
      level:      'ad',
      time_range: JSON.stringify({ since: range.since, until: range.until }),
      limit:      '200',
    })

    // Aggregate by ad_id
    const byAd = new Map<string, Record<string, unknown>>()
    for (const row of ads) {
      const id = row['ad_id'] as string
      if (!byAd.has(id)) {
        byAd.set(id, { ...row, spend: parseFloat(row['spend'] as string ?? '0') })
      } else {
        const cur = byAd.get(id)!
        cur['spend'] = (cur['spend'] as number) + parseFloat(row['spend'] as string ?? '0')
        cur['impressions'] = (parseInt(cur['impressions'] as string ?? '0', 10) + parseInt(row['impressions'] as string ?? '0', 10))
        cur['clicks'] = (parseInt(cur['clicks'] as string ?? '0', 10) + parseInt(row['clicks'] as string ?? '0', 10))
      }
    }

    const sorted = [...byAd.values()]
      .map(row => {
        const spend       = typeof row['spend'] === 'number' ? row['spend'] : parseFloat(row['spend'] as string ?? '0')
        const impressions = parseInt(row['impressions'] as string ?? '0', 10)
        const clicks      = parseInt(row['clicks'] as string ?? '0', 10)
        const actions     = (row['actions'] as Array<Record<string, string>>) ?? []
        const purchases   = actions.filter(a => a['action_type'] === 'purchase' || a['action_type'] === 'offsite_conversion.fb_pixel_purchase')
          .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
        const leads       = actions.filter(a => ['lead','offsite_conversion.fb_pixel_lead'].includes(a['action_type']))
          .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
        return {
          ad_id:         row['ad_id'],
          ad_name:       row['ad_name'],
          campaign_name: row['campaign_name'],
          campaign_id:   row['campaign_id'],
          spend,
          impressions,
          clicks,
          ctr:  impressions > 0 ? (clicks / impressions) * 100 : 0,
          cpm:  impressions > 0 ? (spend / impressions) * 1000 : 0,
          cpa:  purchases  > 0 ? spend / purchases : 0,
          cpl:  leads      > 0 ? spend / leads : 0,
          purchases,
          leads,
        }
      })
      .sort((a, b) => b.spend - a.spend)
      .slice(0, limit)

    // Get previews for top ad IDs
    const adIds = sorted.map(a => a.ad_id as string)
    let previews: Record<string, unknown> = {}
    if (adIds.length && token) {
      try {
        const proof  = appSecretProof(token)
        const params = new URLSearchParams({
          ids:          adIds.join(','),
          fields:       'id,preview_shareable_link,creative{thumbnail_url,image_url}',
          access_token: token,
          ...(proof ? { appsecret_proof: proof } : {}),
        })
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS)
        const r = await fetch(`${META_BASE}/?${params}`, { signal: ctrl.signal }).finally(() => clearTimeout(t))
        if (r.ok) previews = await r.json() as Record<string, unknown>
      } catch { /* non-fatal */ }
    }

    const result = sorted.map(a => ({
      ...a,
      preview_url:   (previews[a.ad_id as string] as any)?.preview_shareable_link ?? null,
      thumbnail_url: (previews[a.ad_id as string] as any)?.creative?.thumbnail_url ?? (previews[a.ad_id as string] as any)?.creative?.image_url ?? null,
    }))

    res.json({ ads: result, since: range.since, until: range.until })
  } catch (err) {
    console.error('[TopAds]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── GET /api/adsmanager/countries ─────────────────────────────────────────────
adsmanagerRouter.get('/countries', authenticate, async (req, res) => {
  try {
    const q       = req.query as Record<string, string>
    const account = q['account']
    const date    = q['date'] ?? 'last_30d'
    const range   = parseDateRange(date, q['since'], q['until'])

    if (!account) { res.status(400).json({ error: 'account requerido' }); return }
    const token = await getUserToken(req.user!.id)

    const rows = await metaFetchAll<Record<string, unknown>>(`/${account}/insights`, token, {
      fields:     'spend,impressions,clicks,ctr,actions,purchase_roas',
      level:      'campaign',
      breakdowns: 'country',
      time_range: JSON.stringify({ since: range.since, until: range.until }),
      limit:      '200',
    })

    const byCountry = new Map<string, { country: string; spend: number; impressions: number; clicks: number; purchases: number; revenue: number }>()
    for (const row of rows) {
      const country = (row['country'] as string) ?? 'XX'
      const cur = byCountry.get(country) ?? { country, spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 }
      cur.spend       += parseFloat(row['spend'] as string ?? '0')
      cur.impressions += parseInt(row['impressions'] as string ?? '0', 10)
      cur.clicks      += parseInt(row['clicks'] as string ?? '0', 10)
      const actions = (row['actions'] as Array<Record<string, string>>) ?? []
      const purchases = actions.filter(a => a['action_type'] === 'purchase' || a['action_type'] === 'offsite_conversion.fb_pixel_purchase')
        .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
      const roas = (row['purchase_roas'] as Array<{ value: string }>)?.[0]
      if (roas) cur.revenue += cur.spend * parseFloat(roas.value)
      cur.purchases += purchases
      byCountry.set(country, cur)
    }

    const result = [...byCountry.values()]
      .map(c => ({
        ...c,
        ctr:  c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
        cpm:  c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
        cpa:  c.purchases > 0 ? c.spend / c.purchases : 0,
        roas: c.spend > 0 ? c.revenue / c.spend : 0,
      }))
      .sort((a, b) => b.spend - a.spend)

    res.json({ countries: result, since: range.since, until: range.until })
  } catch (err) {
    console.error('[Countries]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── GET /api/adsmanager/launches ──────────────────────────────────────────────
adsmanagerRouter.get('/launches', authenticate, async (req, res) => {
  try {
    const q       = req.query as Record<string, string>
    const account = q['account']
    const date    = q['date'] ?? 'last_90d'
    const range   = parseDateRange(date, q['since'], q['until'])

    if (!account) { res.status(400).json({ error: 'account requerido' }); return }
    const token = await getUserToken(req.user!.id)

    const fields = [
      'campaign_id','campaign_name','date_start','date_stop',
      'spend','impressions','clicks','ctr','cpm','frequency',
      'actions','cost_per_action_type','purchase_roas',
    ].join(',')

    const rows = await metaFetchAll<Record<string, unknown>>(`/${account}/insights`, token, {
      fields,
      level:          'campaign',
      time_increment: '1',
      time_range:     JSON.stringify({ since: range.since, until: range.until }),
      limit:          '500',
    })

    // Group by "launch" — extract name before first date-like pattern
    const byLaunch = new Map<string, {
      name: string; campaigns: Set<string>
      spend: number; impressions: number; clicks: number
      purchases: number; leads: number; revenue: number
      days: Set<string>
    }>()

    for (const row of rows) {
      const campName = (row['campaign_name'] as string) ?? ''
      // Extract launch name: everything before the last date-segment " DD/MM" or " FECHA"
      const launchName = campName.replace(/\s+\d{1,2}\/\w+.*$/, '').trim() || campName

      const cur = byLaunch.get(launchName) ?? {
        name: launchName, campaigns: new Set<string>(), days: new Set<string>(),
        spend: 0, impressions: 0, clicks: 0, purchases: 0, leads: 0, revenue: 0,
      }
      cur.campaigns.add(row['campaign_id'] as string)
      cur.days.add(row['date_start'] as string)
      cur.spend       += parseFloat(row['spend'] as string ?? '0')
      cur.impressions += parseInt(row['impressions'] as string ?? '0', 10)
      cur.clicks      += parseInt(row['clicks'] as string ?? '0', 10)
      const actions = (row['actions'] as Array<Record<string, string>>) ?? []
      cur.purchases += actions.filter(a => a['action_type'] === 'purchase' || a['action_type'] === 'offsite_conversion.fb_pixel_purchase')
        .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
      cur.leads += actions.filter(a => ['lead','offsite_conversion.fb_pixel_lead'].includes(a['action_type']))
        .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
      const roas = (row['purchase_roas'] as Array<{ value: string }>)?.[0]
      if (roas && cur.spend > 0) cur.revenue = cur.spend * parseFloat(roas.value)
      byLaunch.set(launchName, cur)
    }

    const launches = [...byLaunch.values()]
      .map(l => ({
        name:        l.name,
        campaigns:   l.campaigns.size,
        spend:       l.spend,
        impressions: l.impressions,
        clicks:      l.clicks,
        purchases:   l.purchases,
        leads:       l.leads,
        revenue:     l.revenue,
        roas:        l.spend > 0 ? l.revenue / l.spend : 0,
        cpa:         l.purchases > 0 ? l.spend / l.purchases : 0,
        cpl:         l.leads > 0 ? l.spend / l.leads : 0,
        ctr:         l.impressions > 0 ? (l.clicks / l.impressions) * 100 : 0,
        days:        l.days.size,
      }))
      .filter(l => l.spend > 0)
      .sort((a, b) => b.spend - a.spend)

    res.json({ launches, since: range.since, until: range.until })
  } catch (err) {
    console.error('[Launches]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── GET /api/adsmanager/recommendations ───────────────────────────────────────
adsmanagerRouter.get('/recommendations', authenticate, async (req, res) => {
  try {
    const q       = req.query as Record<string, string>
    const account = q['account']
    const date    = q['date'] ?? 'last_30d'
    const range   = parseDateRange(date, q['since'], q['until'])

    if (!account) { res.status(400).json({ error: 'account requerido' }); return }
    const token = await getUserToken(req.user!.id)

    const insFields = ['campaign_id','campaign_name','spend','impressions','clicks','ctr','actions','purchase_roas'].join(',')
    const [rows, campMeta] = await Promise.all([
      metaFetchAll<Record<string, unknown>>(`/${account}/insights`, token, {
        fields:     insFields,
        level:      'campaign',
        time_range: JSON.stringify({ since: range.since, until: range.until }),
        limit:      '200',
      }),
      metaFetchAll<Record<string, unknown>>(`/${account}/campaigns`, token, {
        fields: 'id,effective_status',
        limit:  '200',
      }),
    ])

    const campStatusMap = new Map<string, string>()
    for (const c of campMeta) campStatusMap.set(c['id'] as string, c['effective_status'] as string)

    // Aggregate by campaign_id to avoid duplicates from pagination
    const byId = new Map<string, Record<string, unknown>>()
    for (const row of rows) {
      const id = row['campaign_id'] as string
      if (!byId.has(id)) {
        byId.set(id, { ...row, spend: parseFloat(row['spend'] as string ?? '0') })
      } else {
        const cur = byId.get(id)!
        cur['spend'] = (cur['spend'] as number) + parseFloat(row['spend'] as string ?? '0')
        cur['impressions'] = (parseInt(cur['impressions'] as string ?? '0', 10) + parseInt(row['impressions'] as string ?? '0', 10))
        cur['clicks'] = (parseInt(cur['clicks'] as string ?? '0', 10) + parseInt(row['clicks'] as string ?? '0', 10))
        const curActions = (cur['actions'] as Array<Record<string, unknown>>) ?? []
        const rowActions = (row['actions'] as Array<Record<string, unknown>>) ?? []
        const merged: Record<string, number> = {}
        for (const a of [...curActions, ...rowActions]) {
          const k = a['action_type'] as string
          merged[k] = (merged[k] ?? 0) + parseFloat(a['value'] as string ?? '0')
        }
        cur['actions'] = Object.entries(merged).map(([action_type, value]) => ({ action_type, value: String(value) }))
      }
    }

    const campaigns = [...byId.values()].map(row => {
      const spend       = typeof row['spend'] === 'number' ? row['spend'] : parseFloat(row['spend'] as string ?? '0')
      const impressions = parseInt(row['impressions'] as string ?? '0', 10)
      const clicks      = parseInt(row['clicks'] as string ?? '0', 10)
      const actions     = (row['actions'] as Array<Record<string, string>>) ?? []
      const purchases   = actions.filter(a => a['action_type'] === 'purchase' || a['action_type'] === 'offsite_conversion.fb_pixel_purchase')
        .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
      const leads       = actions.filter(a => ['lead','offsite_conversion.fb_pixel_lead'].includes(a['action_type']))
        .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
      const roas        = (row['purchase_roas'] as Array<{ value: string }>)?.[0]
      const revenue     = roas ? spend * parseFloat(roas.value) : 0
      return {
        id:         row['campaign_id'],
        name:       row['campaign_name'],
        status:     campStatusMap.get(row['campaign_id'] as string) ?? 'UNKNOWN',
        spend, impressions, clicks, purchases, leads, revenue,
        ctr:   impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpa:   purchases  > 0 ? spend / purchases : 0,
        cpl:   leads      > 0 ? spend / leads : 0,
        roas:  spend      > 0 ? revenue / spend : 0,
      }
    })

    const avgCpa  = (() => { const actives = campaigns.filter(c => c.cpa > 0); return actives.length ? actives.reduce((s, c) => s + c.cpa, 0) / actives.length : 0 })()
    const avgCtr  = (() => { const actives = campaigns.filter(c => c.ctr > 0); return actives.length ? actives.reduce((s, c) => s + c.ctr, 0) / actives.length : 0 })()

    const pause:  typeof campaigns = []
    const scale:  typeof campaigns = []
    const review: typeof campaigns = []
    const ok:     typeof campaigns = []

    for (const c of campaigns) {
      if (c.spend < 1) continue
      if (c.cpa > 0 && c.cpa > avgCpa * 2) { pause.push(c); continue }
      if (c.roas > 2 && c.spend > 50)       { scale.push(c); continue }
      if (c.ctr > avgCtr * 1.5 && c.purchases === 0) { review.push(c); continue }
      ok.push(c)
    }

    res.json({ pause, scale, review, ok, avgCpa, avgCtr, since: range.since, until: range.until })
  } catch (err) {
    console.error('[Recommendations]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── GET /api/adsmanager/projections ───────────────────────────────────────────
adsmanagerRouter.get('/projections', authenticate, async (req, res) => {
  try {
    const q       = req.query as Record<string, string>
    const account = q['account']
    const date    = q['date'] ?? 'last_30d'
    const range   = parseDateRange(date, q['since'], q['until'])

    if (!account) { res.status(400).json({ error: 'account requerido' }); return }
    const token = await getUserToken(req.user!.id)

    const fields = ['spend','impressions','clicks','ctr','cpm','frequency','actions','purchase_roas'].join(',')
    const rows = await metaFetchAll<Record<string, unknown>>(`/${account}/insights`, token, {
      fields,
      level:      'account',
      time_range: JSON.stringify({ since: range.since, until: range.until }),
      limit:      '1',
    })

    const row = rows[0] ?? {}
    const spend       = parseFloat(row['spend'] as string ?? '0')
    const impressions = parseInt(row['impressions'] as string ?? '0', 10)
    const clicks      = parseInt(row['clicks'] as string ?? '0', 10)
    const actions     = (row['actions'] as Array<Record<string, string>>) ?? []
    const purchases   = actions.filter(a => a['action_type'] === 'purchase' || a['action_type'] === 'offsite_conversion.fb_pixel_purchase')
      .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
    const leads       = actions.filter(a => ['lead','offsite_conversion.fb_pixel_lead'].includes(a['action_type']))
      .reduce((s, a) => s + parseFloat(a['value'] ?? '0'), 0)
    const roas        = (row['purchase_roas'] as Array<{ value: string }>)?.[0]
    const revenue     = roas ? spend * parseFloat(roas.value) : 0

    res.json({
      spend, impressions, clicks, purchases, leads, revenue,
      cpm:          impressions > 0 ? (spend / impressions) * 1000 : 0,
      ctr:          impressions > 0 ? (clicks / impressions) * 100  : 0,
      close_rate:   leads > 0    ? purchases / leads * 100 : 0,
      avg_ticket:   purchases > 0 ? revenue  / purchases : 0,
      since:        range.since,
      until:        range.until,
    })
  } catch (err) {
    console.error('[Projections]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── GET /api/adsmanager/config ─────────────────────────────────────────────────
adsmanagerRouter.get('/config', authenticate, async (req, res) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('meta_account_id')
      .eq('id', req.user!.id)
      .single()

    res.json({
      defaultAccount:  (profile as any)?.meta_account_id ?? process.env.META_AD_ACCOUNT_ID ?? null,
      defaultToken:    req.user!.role === 'admin' ? ENV_TOKEN : null,
      vapidPublicKey:  process.env.VAPID_PUBLIC_KEY ?? null,
    })
  } catch (err) {
    res.json({ defaultAccount: null, defaultToken: null, vapidPublicKey: null })
  }
})

// ── POST /api/adsmanager/save-token ──────────────────────────────────────────
adsmanagerRouter.post('/save-token', authenticate, async (req, res) => {
  try {
    const { token, account_id } = req.body as { token: string; account_id?: string }
    const updates: Record<string, unknown> = {}
    if (token)      updates['meta_token']      = token
    if (account_id) updates['meta_account_id'] = account_id

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'token o account_id requerido' })
      return
    }

    // Validar token contra Meta antes de guardar
    if (token) {
      try {
        const check = await metaFetch('/me', token, { fields: 'id,name' })
        console.log('[save-token] Token válido, usuario Meta:', (check as any)?.name ?? (check as any)?.id)
      } catch (metaErr) {
        const msg = metaErr instanceof Error ? metaErr.message : ''
        console.error('[save-token] Token inválido:', msg)
        res.status(400).json({ error: 'Token de Meta inválido o expirado. Verifica que sea correcto.' })
        return
      }
    }

    const { error } = await supabaseAdmin.from('users').update(updates).eq('id', req.user!.id)
    if (error) {
      console.error('[save-token] Supabase error:', error)
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[save-token]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── POST /api/adsmanager/save-name ───────────────────────────────────────────
adsmanagerRouter.post('/save-name', authenticate, async (req, res) => {
  try {
    const { name } = req.body as { name: string }
    if (!name) { res.status(400).json({ error: 'name requerido' }); return }
    await supabaseAdmin.from('users').update({ name }).eq('id', req.user!.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── GET /api/adsmanager/me ────────────────────────────────────────────────────
adsmanagerRouter.get('/me', authenticate, async (req, res) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('id, name, role, plan, meta_token, meta_account_id, hotmart_email')
      .eq('id', req.user!.id)
      .single()

    await supabaseAdmin.from('users').update({ last_login: new Date().toISOString() }).eq('id', req.user!.id)
    res.json({ id: req.user!.id, email: req.user!.email, ...(profile as object) })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── GET /api/version ─────────────────────────────────────────────────────────
adsmanagerRouter.get('/version', (_req, res) => {
  res.json({ v: process.env.APP_VERSION ?? '1.0.0' })
})

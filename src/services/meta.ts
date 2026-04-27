// =============================================================================
// Servicio Meta Marketing API
// =============================================================================
// Obtiene métricas de campañas de anuncios de Facebook/Instagram.
// Usa la Graph API v20.0 con un User Token o System User Token.
//
// Variables de entorno requeridas:
//   META_ACCESS_TOKEN   — Token de acceso (2h, 60 días, o permanente)
//   META_AD_ACCOUNT_ID  — ID de la cuenta publicitaria (sin el prefijo "act_")
//   META_APP_SECRET     — Clave secreta de la app (para appsecret_proof y extensión de token)
// =============================================================================

import { createHmac } from 'crypto'

const META_BASE       = 'https://graph.facebook.com/v20.0'
const META_TOKEN      = process.env.META_ACCESS_TOKEN
const META_ACCOUNT    = process.env.META_AD_ACCOUNT_ID
const META_SECRET     = process.env.META_APP_SECRET
const META_TIMEOUT_MS = 45_000  // Meta puede ser lenta; 45 s por request

if (!META_TOKEN || !META_ACCOUNT) {
  console.warn('[Meta] META_ACCESS_TOKEN o META_AD_ACCOUNT_ID no definidos — sync de Meta deshabilitado.')
}

// appsecret_proof: HMAC-SHA256(app_secret, access_token)
// Requerido por la Marketing API cuando "Require App Secret" está activado en la app.
function getAppSecretProof(token: string): string | undefined {
  if (!META_SECRET) return undefined
  return createHmac('sha256', META_SECRET).update(token).digest('hex')
}

// ── Extensión de token ────────────────────────────────────────────────────────

export interface TokenInfo {
  access_token: string
  expires_in?:  number   // segundos hasta expiración (undefined = no expira)
  type:         string
}

/**
 * Extiende un token de corta duración (2h) a larga duración (60 días).
 * Requiere META_APP_SECRET en el entorno.
 */
export async function extendToken(shortLivedToken: string): Promise<TokenInfo> {
  const appId = process.env.META_APP_ID
  if (!appId || !META_SECRET) {
    throw new Error('META_APP_ID y META_APP_SECRET son requeridos para extender el token')
  }

  const params = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         appId,
    client_secret:     META_SECRET,
    fb_exchange_token: shortLivedToken,
  })

  const res = await fetch(`${META_BASE}/oauth/access_token?${params.toString()}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Meta token exchange ${res.status}: ${body}`)
  }

  return res.json() as Promise<TokenInfo>
}

// ── Tipos internos (forma cruda de la Graph API) ──────────────────────────────

interface MetaActionValue {
  action_type: string
  value:       string
}

interface MetaInsightRaw {
  campaign_id:           string
  campaign_name:         string
  date_start:            string
  date_stop:             string
  impressions:           string
  clicks:                string
  spend:                 string
  reach:                 string
  ctr:                   string
  cpm:                   string
  actions?:              MetaActionValue[]
  cost_per_action_type?: MetaActionValue[]
}

interface MetaInsightsPage {
  data:    MetaInsightRaw[]
  paging?: {
    cursors?: { before: string; after: string }
    next?:    string
  }
}

// ── Tipos exportados (normalizados) ──────────────────────────────────────────

export interface MetaCampaignMetrics {
  campaign_id:     string
  campaign_name:   string
  date_start:      string  // YYYY-MM-DD
  date_stop:       string  // YYYY-MM-DD
  impressions:     number
  clicks:          number
  spend:           number
  reach:           number
  ctr:             number
  cpm:             number
  conversions:     number
  cost_per_result: number
}

// Igual que MetaCampaignMetrics pero con ad_id/ad_name para el join con GHL
export interface MetaAdMetrics {
  ad_id:           string
  ad_name:         string
  adset_id:        string
  adset_name:      string
  campaign_id:     string
  campaign_name:   string
  date_start:      string
  date_stop:       string
  impressions:     number
  clicks:          number
  spend:           number
  reach:           number
  ctr:             number
  cpm:             number
  conversions:     number
  cost_per_result: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONVERSION_ACTION_TYPES = new Set([
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.lead_grouped',
  'onsite_conversion.messaging_first_reply',
])

function parseNum(s: string | undefined): number {
  const n = parseFloat(s ?? '0')
  return isNaN(n) ? 0 : n
}

function extractConversions(actions?: MetaActionValue[]): number {
  if (!actions) return 0
  return actions
    .filter((a) => CONVERSION_ACTION_TYPES.has(a.action_type))
    .reduce((acc, a) => acc + parseNum(a.value), 0)
}

function extractCostPerResult(
  actions?:             MetaActionValue[],
  costPerActionType?:   MetaActionValue[],
): number {
  if (!costPerActionType || !actions) return 0
  // Busca el cost_per_action del primer tipo de conversión que tenga datos
  for (const actionType of CONVERSION_ACTION_TYPES) {
    const hasCounts = actions.some((a) => a.action_type === actionType && parseNum(a.value) > 0)
    if (!hasCounts) continue
    const cpa = costPerActionType.find((c) => c.action_type === actionType)
    if (cpa) return parseNum(cpa.value)
  }
  return 0
}

function normalizeInsight(raw: MetaInsightRaw): MetaCampaignMetrics {
  return {
    campaign_id:     raw.campaign_id,
    campaign_name:   raw.campaign_name,
    date_start:      raw.date_start,
    date_stop:       raw.date_stop,
    impressions:     Math.round(parseNum(raw.impressions)),
    clicks:          Math.round(parseNum(raw.clicks)),
    spend:           parseNum(raw.spend),
    reach:           Math.round(parseNum(raw.reach)),
    ctr:             parseNum(raw.ctr),
    cpm:             parseNum(raw.cpm),
    conversions:     Math.round(extractConversions(raw.actions)),
    cost_per_result: extractCostPerResult(raw.actions, raw.cost_per_action_type),
  }
}

// ── Fetch principal ───────────────────────────────────────────────────────────

/**
 * Descarga métricas de campañas de Meta Ads para un rango de fechas.
 * Devuelve un registro por (campaña × día).
 *
 * @param since  Fecha de inicio en formato YYYY-MM-DD
 * @param until  Fecha de fin en formato YYYY-MM-DD
 */
export async function fetchCampaignInsights(
  since: string,
  until: string,
): Promise<MetaCampaignMetrics[]> {
  if (!META_TOKEN || !META_ACCOUNT) {
    throw new Error('META_ACCESS_TOKEN y META_AD_ACCOUNT_ID son requeridos para sync de Meta')
  }

  const fields = [
    'campaign_id',
    'campaign_name',
    'impressions',
    'clicks',
    'spend',
    'reach',
    'ctr',
    'cpm',
    'actions',
    'cost_per_action_type',
  ].join(',')

  const proof = getAppSecretProof(META_TOKEN)

  const params = new URLSearchParams({
    fields,
    level:          'campaign',
    time_increment: '1',
    time_range:     JSON.stringify({ since, until }),
    limit:          '500',
    access_token:   META_TOKEN,
    ...(proof ? { appsecret_proof: proof } : {}),
  })

  let url: string | undefined = `${META_BASE}/act_${META_ACCOUNT}/insights?${params.toString()}`
  const all: MetaCampaignMetrics[] = []
  let pageNum = 0

  console.log(`[Meta] Iniciando fetch de insights. Rango: ${since} → ${until}`)

  while (url) {
    pageNum++
    console.log(`[Meta] Página ${pageNum} — acumulados: ${all.length}`)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS)
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Meta API ${res.status}: ${body}`)
    }

    const page = await res.json() as MetaInsightsPage

    if (page.data) {
      all.push(...page.data.map(normalizeInsight))
    }

    url = page.paging?.next
  }

  console.log(`[Meta] Fetch completo: ${all.length} registros (${pageNum} páginas)`)
  return all
}

// ── Fetch a nivel de anuncio (para join con GHL attribution_ad_id) ─────────────
// GHL guarda el ad_id del anuncio específico en leads.attribution_ad_id.
// Este endpoint descarga métricas por ad_id para el cruce correcto.

interface MetaAdInsightRaw extends MetaInsightRaw {
  ad_id:      string
  ad_name:    string
  adset_id:   string
  adset_name: string
}

function normalizeAdInsight(raw: MetaAdInsightRaw): MetaAdMetrics {
  return {
    ad_id:           raw.ad_id,
    ad_name:         raw.ad_name         ?? '',
    adset_id:        raw.adset_id        ?? '',
    adset_name:      raw.adset_name      ?? '',
    campaign_id:     raw.campaign_id,
    campaign_name:   raw.campaign_name   ?? '',
    date_start:      raw.date_start,
    date_stop:       raw.date_stop,
    impressions:     Math.round(parseNum(raw.impressions)),
    clicks:          Math.round(parseNum(raw.clicks)),
    spend:           parseNum(raw.spend),
    reach:           Math.round(parseNum(raw.reach)),
    ctr:             parseNum(raw.ctr),
    cpm:             parseNum(raw.cpm),
    conversions:     Math.round(extractConversions(raw.actions)),
    cost_per_result: extractCostPerResult(raw.actions, raw.cost_per_action_type),
  }
}

/**
 * Descarga métricas de Meta Ads a nivel de anuncio individual.
 * Permite cruzar con leads.attribution_ad_id de GHL para ROAS por anuncio.
 */
export async function fetchAdInsights(
  since: string,
  until: string,
): Promise<MetaAdMetrics[]> {
  if (!META_TOKEN || !META_ACCOUNT) {
    throw new Error('META_ACCESS_TOKEN y META_AD_ACCOUNT_ID son requeridos')
  }

  const fields = [
    'ad_id',
    'ad_name',
    'adset_id',
    'adset_name',
    'campaign_id',
    'campaign_name',
    'impressions',
    'clicks',
    'spend',
    'reach',
    'ctr',
    'cpm',
    'actions',
    'cost_per_action_type',
  ].join(',')

  const proof = getAppSecretProof(META_TOKEN)

  const params = new URLSearchParams({
    fields,
    level:          'ad',
    time_increment: '1',
    time_range:     JSON.stringify({ since, until }),
    limit:          '500',
    access_token:   META_TOKEN,
    ...(proof ? { appsecret_proof: proof } : {}),
  })

  let url: string | undefined = `${META_BASE}/act_${META_ACCOUNT}/insights?${params.toString()}`
  const all: MetaAdMetrics[] = []
  let pageNum = 0

  console.log(`[Meta] Iniciando fetch de insights a nivel AD. Rango: ${since} → ${until}`)

  while (url) {
    pageNum++
    console.log(`[Meta] Ad-level página ${pageNum} — acumulados: ${all.length}`)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS)
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Meta API (ad level) ${res.status}: ${body}`)
    }

    const page = await res.json() as { data?: MetaAdInsightRaw[]; paging?: { next?: string } }
    if (page.data) {
      all.push(...page.data.map(normalizeAdInsight))
    }
    url = page.paging?.next
  }

  console.log(`[Meta] Ad-level fetch completo: ${all.length} registros`)
  return all
}

// ── Thumbnails y preview links de anuncios ─────────────────────────────────────
// Hace un batch request con todos los ad_ids únicos para obtener:
//   thumbnail_url  → imagen de la creatividad (video o imagen)
//   preview_link   → link compartible para ver el anuncio en Meta

// Posibles estados de un anuncio en Meta
export type MetaAdStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED' | 'UNKNOWN'

export interface AdCreativeInfo {
  ad_id:         string
  thumbnail_url: string | null
  preview_link:  string | null
  ad_status:     MetaAdStatus
}

export async function fetchAdCreatives(adIds: string[]): Promise<AdCreativeInfo[]> {
  if (!META_TOKEN || adIds.length === 0) return []

  const proof = getAppSecretProof(META_TOKEN)
  const results: AdCreativeInfo[] = []

  const CHUNK = 50
  for (let i = 0; i < adIds.length; i += CHUNK) {
    const chunk = adIds.slice(i, i + CHUNK)
    const params = new URLSearchParams({
      ids:          chunk.join(','),
      fields:       'id,status,effective_status,preview_shareable_link,creative{thumbnail_url,image_url}',
      access_token: META_TOKEN,
      ...(proof ? { appsecret_proof: proof } : {}),
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS)
    const res = await fetch(`${META_BASE}/?${params}`, { signal: controller.signal })
      .finally(() => clearTimeout(timer))

    if (!res.ok) {
      console.warn(`[Meta] fetchAdCreatives ${res.status} — omitiendo chunk`)
      continue
    }

    const body = await res.json() as Record<string, {
      id:                     string
      status?:                string
      effective_status?:      string
      preview_shareable_link?: string
      creative?: { thumbnail_url?: string; image_url?: string }
    }>

    for (const adId of chunk) {
      const ad = body[adId]
      if (!ad) continue
      // effective_status refleja el estado real incluyendo si la campaña padre está pausada
      const rawStatus = (ad.effective_status ?? ad.status ?? 'UNKNOWN').toUpperCase()
      const adStatus: MetaAdStatus =
        rawStatus === 'ACTIVE'   ? 'ACTIVE'   :
        rawStatus === 'PAUSED'   ? 'PAUSED'   :
        rawStatus === 'ARCHIVED' ? 'ARCHIVED' :
        rawStatus === 'DELETED'  ? 'DELETED'  : 'UNKNOWN'

      results.push({
        ad_id:         adId,
        thumbnail_url: ad.creative?.thumbnail_url ?? ad.creative?.image_url ?? null,
        preview_link:  ad.preview_shareable_link ?? null,
        ad_status:     adStatus,
      })
    }

    console.log(`[Meta] Creatives chunk ${i / CHUNK + 1}: ${results.length} obtenidos`)
  }

  return results
}

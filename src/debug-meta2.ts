/**
 * Diagnóstico extendido: cuentas disponibles, campañas archivadas, ad ID de GHL
 * Corre: npx tsx src/debug-meta2.ts
 */
import 'dotenv/config'
import { createHmac } from 'crypto'

const TOKEN  = process.env.META_ACCESS_TOKEN!
const ACCT   = process.env.META_AD_ACCOUNT_ID!
const SECRET = process.env.META_APP_SECRET!
const BASE   = 'https://graph.facebook.com/v20.0'

const ap = createHmac('sha256', SECRET).update(TOKEN).digest('hex')

async function get(path: string, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ access_token: TOKEN, appsecret_proof: ap, ...extra })
  const r = await fetch(`${BASE}${path}?${p}`)
  return r.json()
}

async function main() {
  // ── 1. Todas las cuentas publicitarias del token ─────────────────────────
  console.log('\n=== 1. TODAS LAS CUENTAS PUBLICITARIAS ===')
  const adAccounts = await get('/me/adaccounts', {
    fields: 'id,name,account_status,currency,business',
    limit:  '20',
  }) as { data?: Array<{id: string; name: string; account_status: number; currency: string; business?: {id: string; name: string}}> }
  if (adAccounts.data?.length) {
    adAccounts.data.forEach((a) =>
      console.log(`  · act_${a.id} | ${a.name} | ${a.currency} | estado: ${a.account_status} | negocio: ${a.business?.name ?? 'personal'}`)
    )
  } else {
    console.log('  Sin cuentas o sin acceso:', JSON.stringify(adAccounts))
  }

  // ── 2. Campañas incluyendo archivadas/pausadas ────────────────────────────
  console.log('\n=== 2. CAMPAÑAS (todos los estados) ===')
  const camps = await get(`/act_${ACCT}/campaigns`, {
    fields:           'id,name,status,effective_status,objective',
    effective_status: JSON.stringify(['ACTIVE','PAUSED','ARCHIVED','DELETED','CAMPAIGN_PAUSED']),
    limit:            '10',
  }) as { data?: Array<{id: string; name: string; status: string; effective_status: string}>; error?: {message: string} }

  if (camps.error) {
    console.log('  Error:', camps.error.message)
  } else if (camps.data?.length) {
    camps.data.forEach((c) =>
      console.log(`  · [${c.effective_status}] ${c.name} (${c.id})`)
    )
  } else {
    console.log('  Sin campañas en esta cuenta.')
  }

  // ── 3. Verificar el ad ID específico que viene en las atribuciones de GHL ─
  console.log('\n=== 3. AD ID DE GHL (120242628601930178) ===')
  const ad = await get('/120242628601930178', {
    fields: 'id,name,status,campaign_id,account_id,adset_id',
  }) as Record<string, string>
  if ((ad as any).error) {
    console.log('  Error:', (ad as any).error.message)
    console.log('  (Posiblemente pertenece a otra cuenta)')
  } else {
    console.log(`  Ad: ${ad.name} | cuenta: ${ad.account_id} | campaña: ${ad.campaign_id}`)
  }

  // ── 4. Insights últimos 30 días (todos los estados) ───────────────────────
  console.log('\n=== 4. INSIGHTS ÚLTIMOS 30 DÍAS ===')
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const until = new Date().toISOString().slice(0, 10)
  const insights = await get(`/act_${ACCT}/insights`, {
    fields:         'campaign_name,impressions,clicks,spend',
    level:          'campaign',
    time_range:     JSON.stringify({ since, until }),
    limit:          '5',
  }) as { data?: Array<{campaign_name: string; impressions: string; clicks: string; spend: string}>; error?: {message: string} }

  if (insights.error) {
    console.log('  Error:', insights.error.message)
  } else if (insights.data?.length) {
    insights.data.forEach((r) =>
      console.log(`  · ${r.campaign_name}: ${r.impressions} imp | $${r.spend}`)
    )
  } else {
    console.log('  Sin datos en los últimos 30 días para esta cuenta.')
  }
}

main().catch(console.error)

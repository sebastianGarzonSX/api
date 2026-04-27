/**
 * Script de diagnóstico Meta Ads API
 * Corre: npx tsx src/debug-meta.ts
 */
import 'dotenv/config'
import { createHmac } from 'crypto'

const TOKEN   = process.env.META_ACCESS_TOKEN
const ACCOUNT = process.env.META_AD_ACCOUNT_ID
const SECRET  = process.env.META_APP_SECRET
const APP_ID  = process.env.META_APP_ID
const BASE    = 'https://graph.facebook.com/v20.0'

console.log('\n=== DEBUG META ADS ===')
console.log('META_ACCESS_TOKEN  :', TOKEN  ? `${TOKEN.slice(0, 20)}...` : '❌ NO DEFINIDO')
console.log('META_AD_ACCOUNT_ID :', ACCOUNT || '❌ NO DEFINIDO')
console.log('META_APP_ID        :', APP_ID  || '❌ NO DEFINIDO')
console.log('META_APP_SECRET    :', SECRET  ? `${SECRET.slice(0, 8)}...` : '❌ NO DEFINIDO')
console.log()

if (!TOKEN) { console.error('Falta META_ACCESS_TOKEN'); process.exit(1) }

function proof(token: string) {
  if (!SECRET) return undefined
  return createHmac('sha256', SECRET).update(token).digest('hex')
}

async function get(path: string, params: Record<string, string> = {}) {
  const p = new URLSearchParams({ ...params, access_token: TOKEN! })
  const ap = proof(TOKEN!)
  if (ap) p.set('appsecret_proof', ap)
  const url = `${BASE}${path}?${p.toString()}`
  console.log(`→ GET ${BASE}${path}`)
  const res = await fetch(url)
  const body = await res.json() as Record<string, unknown>
  console.log(`← ${res.status}`)
  if (!res.ok) {
    console.error('Error:', JSON.stringify(body, null, 2))
    return null
  }
  return body
}

async function main() {
  // ── 1. Verificar que el token es válido ──────────────────────────────────
  console.log('--- 1. Verificar token (GET /me) ---')
  const me = await get('/me', { fields: 'id,name' })
  if (!me) { console.error('Token inválido o expirado.'); process.exit(1) }
  console.log(`Token válido. Usuario/entidad: ${me.name ?? me.id}\n`)

  if (!ACCOUNT) { console.error('Falta META_AD_ACCOUNT_ID'); process.exit(1) }

  // ── 2. Verificar acceso a la cuenta publicitaria ─────────────────────────
  console.log('--- 2. Info de la cuenta publicitaria ---')
  const acct = await get(`/act_${ACCOUNT}`, { fields: 'id,name,currency,account_status' })
  if (!acct) { console.error('Sin acceso a la cuenta publicitaria.'); process.exit(1) }
  console.log(`Cuenta: ${acct.name} | Moneda: ${acct.currency} | Estado: ${acct.account_status}\n`)

  // ── 3. Listar campañas activas ────────────────────────────────────────────
  console.log('--- 3. Campañas (primeras 5) ---')
  const camps = await get(`/act_${ACCOUNT}/campaigns`, {
    fields: 'id,name,status,objective',
    limit:  '5',
  })
  if (camps && Array.isArray((camps as any).data)) {
    const list = (camps as any).data as Array<{id: string; name: string; status: string}>
    console.log(`Total campañas en respuesta: ${list.length}`)
    list.forEach((c) => console.log(`  · [${c.status}] ${c.name} (${c.id})`))
  }
  console.log()

  // ── 4. Fetch de insights (últimos 7 días) ────────────────────────────────
  console.log('--- 4. Insights últimos 7 días ---')
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const until = new Date().toISOString().slice(0, 10)

  const insights = await get(`/act_${ACCOUNT}/insights`, {
    fields:         'campaign_name,impressions,clicks,spend,ctr,cpm',
    level:          'campaign',
    time_range:     JSON.stringify({ since, until }),
    limit:          '5',
  })

  if (insights && Array.isArray((insights as any).data)) {
    const rows = (insights as any).data as Array<Record<string, string>>
    if (rows.length === 0) {
      console.log('Sin datos de insights en los últimos 7 días.')
    } else {
      console.log(`Registros recibidos: ${rows.length}`)
      rows.forEach((r) => {
        console.log(`  · ${r.campaign_name}: ${r.impressions} imp | ${r.clicks} clicks | $${r.spend} | CTR ${r.ctr}%`)
      })
    }
  }
  console.log()

  console.log('✅ Diagnóstico completado. La API de Meta está funcionando correctamente.')
}

main().catch((err) => {
  console.error('\n❌ Error fatal:', err.message)
  process.exit(1)
})

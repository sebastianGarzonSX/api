import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { dashboardRouter }      from './routes/dashboard.js'
import { leadsRouter }           from './routes/leads.js'
import { opportunitiesRouter }   from './routes/opportunities.js'
import { syncRouter }            from './routes/sync.js'
import { metaRouter }            from './routes/meta.js'
import { reportsRouter }         from './routes/reports.js'
import { claseRouter }           from './routes/clase.js'
import { adsmanagerRouter }      from './routes/adsmanager.js'
import { hotmartRouter }         from './routes/hotmart.js'
import { utmRouter }             from './routes/utm.js'
import { announcementsRouter }   from './routes/announcements.js'
import { tutorialsRouter }       from './routes/tutorials.js'
import { pushRouter }            from './routes/push.js'
import { adminRouter }           from './routes/admin.js'
import { startSyncJob }          from './jobs/syncJob.js'

// ── Validar variables críticas al arrancar ────────────────────────────────────
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]
const missing = REQUIRED_ENV.filter((k) => !process.env[k])
if (missing.length > 0) {
  console.error(`[Startup] Variables de entorno faltantes: ${missing.join(', ')}`)
  process.exit(1)
}

// ── App Express ───────────────────────────────────────────────────────────────
const app  = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)

// CORS — el frontend Next.js (localhost:3000 en dev) hace proxy a este puerto
const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',')
app.use(cors({ origin: corsOrigins, credentials: true }))

app.use(express.json())

// ── Health check (sin auth, para load balancer / Docker) ─────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// ── Rutas ──────────────────────────────────────────────────────────────────────
// Prefijo /api/* — Next.js reescribe /api/* hacia este servidor
app.use('/api/dashboard',       dashboardRouter)
app.use('/api/leads',           leadsRouter)
app.use('/api/opportunities',   opportunitiesRouter)
app.use('/api/sync',            syncRouter)
app.use('/api/meta',            metaRouter)
app.use('/api/reports',         reportsRouter)
app.use('/api/clase',           claseRouter)
// AdsManager PRO
app.use('/api/adsmanager',      adsmanagerRouter)
app.use('/api/hotmart',         hotmartRouter)
app.post('/webhook/hotmart',    (req, res, next) => {
  req.url = '/webhook'
  hotmartRouter(req, res, next)
})
app.use('/api/utm',             utmRouter)
app.use('/api/announcements',   announcementsRouter)
app.use('/api/tutorials',       tutorialsRouter)
app.use('/api/push',            pushRouter)
app.use('/api/admin',           adminRouter)

// ── 404 global ────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', status: 404 })
})

// ── Error global ──────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Express Error]', err)
  res.status(500).json({ error: 'Error interno del servidor', status: 500 })
})

// ── Arrancar ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[API] Servidor escuchando en http://localhost:${PORT}`)
  startSyncJob()
})

export default app

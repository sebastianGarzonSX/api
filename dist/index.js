"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dashboard_js_1 = require("./routes/dashboard.js");
const leads_js_1 = require("./routes/leads.js");
const opportunities_js_1 = require("./routes/opportunities.js");
const sync_js_1 = require("./routes/sync.js");
const meta_js_1 = require("./routes/meta.js");
const reports_js_1 = require("./routes/reports.js");
const syncJob_js_1 = require("./jobs/syncJob.js");
// ── Validar variables críticas al arrancar ────────────────────────────────────
const REQUIRED_ENV = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
    console.error(`[Startup] Variables de entorno faltantes: ${missing.join(', ')}`);
    process.exit(1);
}
// ── App Express ───────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT ?? '3001', 10);
// CORS — el frontend Next.js (localhost:3000 en dev) hace proxy a este puerto
const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',');
app.use((0, cors_1.default)({ origin: corsOrigins, credentials: true }));
app.use(express_1.default.json());
// ── Health check (sin auth, para load balancer / Docker) ─────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
});
// ── Rutas ──────────────────────────────────────────────────────────────────────
// Prefijo /api/* — Next.js reescribe /api/* hacia este servidor
app.use('/api/dashboard', dashboard_js_1.dashboardRouter);
app.use('/api/leads', leads_js_1.leadsRouter);
app.use('/api/opportunities', opportunities_js_1.opportunitiesRouter);
app.use('/api/sync', sync_js_1.syncRouter);
app.use('/api/meta', meta_js_1.metaRouter);
app.use('/api/reports', reports_js_1.reportsRouter);
// ── 404 global ────────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada', status: 404 });
});
// ── Error global ──────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[Express Error]', err);
    res.status(500).json({ error: 'Error interno del servidor', status: 500 });
});
// ── Arrancar ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`[API] Servidor escuchando en http://localhost:${PORT}`);
    (0, syncJob_js_1.startSyncJob)();
});
exports.default = app;

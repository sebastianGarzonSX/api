"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackingRouter = void 0;
const express_1 = require("express");
const cors_1 = __importDefault(require("cors"));
const crypto_1 = __importDefault(require("crypto"));
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
exports.trackingRouter = (0, express_1.Router)();
// CORS abierto solo para el endpoint de pageview (llega desde la LP de GHL)
const openCors = (0, cors_1.default)();
exports.trackingRouter.options('/pageview', openCors);
// ── Rate limit en memoria (por IP, ventana de 1 min) ────────────────────────
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
        hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return false;
    }
    entry.count++;
    return entry.count > MAX_PER_WINDOW;
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
        if (now > entry.resetAt)
            hits.delete(ip);
    }
}, WINDOW_MS * 2);
function hashIp(ip) {
    return crypto_1.default.createHash('sha256').update(ip + (process.env.IP_SALT ?? 'lp-track')).digest('hex').slice(0, 16);
}
// ── POST /api/tracking/pageview ── PÚBLICO (sin auth) ────────────────────────
exports.trackingRouter.post('/pageview', openCors, async (req, res) => {
    try {
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            ?? req.socket.remoteAddress
            ?? 'unknown';
        if (isRateLimited(clientIp)) {
            res.status(429).json({ error: 'Too many requests' });
            return;
        }
        const { tag, page_url, referrer } = req.body;
        if (!tag?.trim()) {
            res.status(400).json({ error: 'tag requerido' });
            return;
        }
        const { error } = await supabase_js_1.supabaseAdmin.from('lp_pageviews').insert({
            tag: tag.trim(),
            page_url: (page_url ?? '').slice(0, 2048),
            referrer: referrer ? referrer.slice(0, 2048) : null,
            user_agent: (req.headers['user-agent'] ?? '').slice(0, 512) || null,
            ip_hash: hashIp(clientIp),
        });
        if (error) {
            console.error('[Tracking] Insert error:', error.message);
            res.status(500).json({ error: 'Error interno' });
            return;
        }
        res.status(204).end();
    }
    catch (err) {
        console.error('[Tracking] Unexpected error:', err);
        res.status(500).json({ error: 'Error interno' });
    }
});
// ── GET /api/tracking/lp-views?tag=X ── autenticado ─────────────────────────
exports.trackingRouter.get('/lp-views', auth_js_1.authenticate, async (req, res) => {
    try {
        const tag = req.query['tag'] ?? null;
        if (!tag) {
            res.status(400).json({ error: 'tag requerido', status: 400 });
            return;
        }
        // Total de visitas
        const { count: totalCount, error: totalErr } = await supabase_js_1.supabaseAdmin
            .from('lp_pageviews')
            .select('*', { count: 'exact', head: true })
            .eq('tag', tag);
        if (totalErr) {
            res.status(500).json({ error: totalErr.message, status: 500 });
            return;
        }
        // Visitas únicas (por ip_hash)
        const { data: uniqueData, error: uniqueErr } = await supabase_js_1.supabaseAdmin
            .from('lp_pageviews')
            .select('ip_hash')
            .eq('tag', tag)
            .not('ip_hash', 'is', null);
        const uniqueCount = uniqueErr
            ? null
            : new Set((uniqueData ?? []).map(r => r.ip_hash)).size;
        // Última visita
        const { data: lastRow } = await supabase_js_1.supabaseAdmin
            .from('lp_pageviews')
            .select('created_at')
            .eq('tag', tag)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        res.json({
            tag,
            lp_views: totalCount ?? 0,
            unique_views: uniqueCount,
            updated_at: lastRow?.created_at ?? null,
        });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 });
    }
});
// ── GET /api/tracking/snippet?tag=X ── autenticado ──────────────────────────
exports.trackingRouter.get('/snippet', auth_js_1.authenticate, async (req, res) => {
    const tag = req.query['tag'] ?? null;
    if (!tag) {
        res.status(400).json({ error: 'tag requerido', status: 400 });
        return;
    }
    const baseUrl = process.env.API_PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
    const snippet = `<script>
(function(){
  fetch("${baseUrl}/api/tracking/pageview", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      tag: ${JSON.stringify(tag)},
      page_url: location.href,
      referrer: document.referrer
    })
  }).catch(function(){});
})();
</script>`;
    res.json({ tag, snippet });
});

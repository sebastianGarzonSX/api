"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushRouter = void 0;
const express_1 = require("express");
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
exports.pushRouter = (0, express_1.Router)();
// POST /api/push/subscribe
exports.pushRouter.post('/subscribe', auth_js_1.authenticate, async (req, res) => {
    try {
        const { subscription } = req.body;
        if (!subscription?.endpoint) {
            res.status(400).json({ error: 'subscription requerida' });
            return;
        }
        await supabase_js_1.supabaseAdmin
            .from('push_subscriptions')
            .upsert({
            user_id: req.user.id,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
        }, { onConflict: 'endpoint' });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});
// POST /api/push/test
exports.pushRouter.post('/test', auth_js_1.authenticate, async (req, res) => {
    try {
        const vapidKey = process.env.VAPID_PRIVATE_KEY;
        const vapidEmail = process.env.VAPID_EMAIL;
        const vapidPublic = process.env.VAPID_PUBLIC_KEY;
        if (!vapidKey || !vapidEmail || !vapidPublic) {
            res.status(500).json({ error: 'Push no configurado — define VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL' });
            return;
        }
        const { data: subs } = await supabase_js_1.supabaseAdmin
            .from('push_subscriptions')
            .select('endpoint, p256dh, auth')
            .eq('user_id', req.user.id);
        if (!subs?.length) {
            res.status(404).json({ error: 'No hay suscripciones registradas para este usuario' });
            return;
        }
        // @ts-ignore — web-push is an optional runtime dependency
        const webpush = await import('web-push');
        webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublic, vapidKey);
        const payload = JSON.stringify({
            type: 'SALE_SOUND',
            title: '🧪 Prueba de notificación',
            body: '¡Las notificaciones push funcionan correctamente!',
        });
        const results = await Promise.allSettled(subs.map((sub) => webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)));
        const sent = results.filter(r => r.status === 'fulfilled').length;
        res.json({ success: true, sent, total: subs.length });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});
// GET /api/push/status
exports.pushRouter.get('/status', auth_js_1.authenticate, async (req, res) => {
    try {
        const { count } = await supabase_js_1.supabaseAdmin
            .from('push_subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', req.user.id);
        res.json({ subscriptions: count ?? 0 });
    }
    catch {
        res.json({ subscriptions: 0 });
    }
});

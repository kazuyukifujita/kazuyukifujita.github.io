const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 8765);
const ROOT_DIR = __dirname;
const PLANS_DIR = path.join(ROOT_DIR, 'saved-plans');
const MAX_BODY_BYTES = 15 * 1024 * 1024;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon'
};

const sendJson = (res, status, body) => {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(body));
};

const safePlanId = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');

const readBody = (req) => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
            reject(new Error('Request body is too large'));
            req.destroy();
        }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
});

const planPath = (id) => path.join(PLANS_DIR, `${safePlanId(id)}.json`);

const listPlans = async () => {
    await fs.mkdir(PLANS_DIR, { recursive: true });
    const files = await fs.readdir(PLANS_DIR);
    const plans = await Promise.all(files
        .filter(file => file.endsWith('.json'))
        .map(async file => {
            try {
                const raw = await fs.readFile(path.join(PLANS_DIR, file), 'utf8');
                const plan = JSON.parse(raw);
                return {
                    id: plan.id,
                    name: plan.name,
                    createdAt: plan.createdAt,
                    updatedAt: plan.updatedAt,
                    thumbnail: plan.thumbnail || null,
                    elementCount: Array.isArray(plan.elements) ? plan.elements.length : 0
                };
            } catch {
                return null;
            }
        }));

    return plans
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
};

const handleApi = async (req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/plans') {
        sendJson(res, 200, { plans: await listPlans() });
        return true;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/plans/')) {
        const id = safePlanId(decodeURIComponent(url.pathname.replace('/api/plans/', '')));
        if (!id) {
            sendJson(res, 400, { error: 'Missing plan id' });
            return true;
        }

        try {
            const raw = await fs.readFile(planPath(id), 'utf8');
            sendJson(res, 200, JSON.parse(raw));
        } catch {
            sendJson(res, 404, { error: 'Plan not found' });
        }
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/plans') {
        try {
            const parsed = JSON.parse(await readBody(req));
            if (!Array.isArray(parsed.elements) || parsed.elements.length === 0) {
                sendJson(res, 400, { error: 'No plan elements were provided' });
                return true;
            }

            const now = new Date().toISOString();
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const name = String(parsed.name || '').trim() || new Date().toLocaleString('ja-JP');
            const plan = {
                id,
                name,
                createdAt: now,
                updatedAt: now,
                thumbnail: typeof parsed.thumbnail === 'string' ? parsed.thumbnail : null,
                elements: parsed.elements,
                baseDraft: parsed.baseDraft || null
            };

            await fs.mkdir(PLANS_DIR, { recursive: true });
            await fs.writeFile(planPath(id), JSON.stringify(plan, null, 2));
            sendJson(res, 201, plan);
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Could not save plan' });
        }
        return true;
    }

    return false;
};

const serveStatic = async (req, res, url) => {
    const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.normalize(path.join(ROOT_DIR, requestedPath));

    if (!filePath.startsWith(ROOT_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    try {
        const data = await fs.readFile(filePath);
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream'
        });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
};

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
        if (url.pathname.startsWith('/api/') && await handleApi(req, res, url)) return;
        await serveStatic(req, res, url);
    } catch (error) {
        sendJson(res, 500, { error: error.message || 'Server error' });
    }
});

server.listen(PORT, () => {
    console.log(`Madori server running at http://localhost:${PORT}/`);
});

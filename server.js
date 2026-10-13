require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { init, all, run, get } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_SHEETS_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
const GOOGLE_SHEETS_WEBHOOK_VERSION = 'sheets-drive-v4';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SESSION_COOKIE = 'salon_admin_session';
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_SESSION_KEY = crypto.createHash('sha256')
  .update(`salon-admin-session:${ADMIN_PASSWORD || crypto.randomBytes(32).toString('hex')}`)
  .digest();
const loginAttempts = new Map();
const uploadDir = process.env.VERCEL === '1'
  ? path.join('/tmp', 'salon-uploads')
  : path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg');
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `obra-${suffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato de imagen no permitido'));
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createAdminSession(username) {
  const payload = Buffer.from(JSON.stringify({
    username,
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_SESSION_KEY).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function hasAdminSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((entry) => {
    const separator = entry.indexOf('=');
    return separator === -1 ? ['', ''] : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
  }));
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (!token) return false;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expectedSignature = crypto.createHmac('sha256', ADMIN_SESSION_KEY).update(payload).digest();
  let receivedSignature;
  try {
    receivedSignature = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (receivedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(receivedSignature, expectedSignature)) {
    return false;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.username === ADMIN_USERNAME && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (hasAdminSession(req)) return next();
  res.status(401).json({ message: 'Iniciá sesión para acceder al panel de administración.' });
}

function setAdminCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL_MS / 1000}${secure}`);
}

app.get('/admin/login', (req, res) => {
  if (hasAdminSession(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.post('/api/admin/session', (req, res) => {
  const now = Date.now();
  const ip = req.ip;
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.blockedUntil > now) {
    return res.status(429).json({ message: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' });
  }
  if (attempt?.blockedUntil && attempt.blockedUntil <= now) loginAttempts.delete(ip);
  if (attempt && now - attempt.firstAttempt > 15 * 60 * 1000) loginAttempts.delete(ip);

  const usernameMatches = safeEqual(req.body.username || '', ADMIN_USERNAME);
  const passwordMatches = safeEqual(req.body.password || '', ADMIN_PASSWORD);
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !usernameMatches || !passwordMatches) {
    const current = loginAttempts.get(ip);
    const nextAttempt = current && current.blockedUntil <= now && now - current.firstAttempt <= 15 * 60 * 1000
      ? { ...current, count: current.count + 1 }
      : { count: 1, firstAttempt: now, blockedUntil: 0 };
    if (nextAttempt.count >= 5) nextAttempt.blockedUntil = now + 15 * 60 * 1000;
    loginAttempts.set(ip, nextAttempt);
    return res.status(401).json({ message: 'Usuario o contraseña incorrectos.' });
  }

  loginAttempts.delete(ip);
  setAdminCookie(req, res, createAdminSession(ADMIN_USERNAME));
  res.json({ ok: true });
});

app.delete('/api/admin/session', (req, res) => {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: hasAdminSession(req) });
});

app.get('/api/admin/works', requireAdmin, async (req, res) => {
  try {
    res.json({ works: await getWorks() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'No se pudieron cargar las obras.' });
  }
});

app.use((req, res, next) => {
  if (req.path !== '/admin' && req.path !== '/admin.html') return next();
  if (!hasAdminSession(req)) return res.redirect('/admin/login');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

function getPublicSiteUrl(req) {
  const configuredUrl = process.env.PUBLIC_SITE_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL
    || req.get('host');
  const withProtocol = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `${process.env.VERCEL === '1' ? 'https' : req.protocol}://${configuredUrl}`;
  const parsedUrl = new URL(withProtocol);
  if (process.env.VERCEL === '1') parsedUrl.protocol = 'https:';
  return parsedUrl.origin;
}

app.get('/robots.txt', (req, res) => {
  const siteUrl = getPublicSiteUrl(req);
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${siteUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const siteUrl = getPublicSiteUrl(req);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>`);
});

app.get('/', (req, res) => {
  const siteUrl = getPublicSiteUrl(req);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  res.type('html').send(html.replaceAll('__SITE_URL__', siteUrl));
});

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

async function getWorks() {
  if (process.env.VERCEL === '1') {
    if (!GOOGLE_SHEETS_WEBHOOK_URL) {
      throw new Error('Falta GOOGLE_SHEETS_WEBHOOK_URL: Vercel requiere el almacenamiento persistente de Sheets/Drive.');
    }

    const listUrl = new URL(GOOGLE_SHEETS_WEBHOOK_URL);
    listUrl.searchParams.set('action', 'list');
    const response = await fetch(listUrl, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || result?.ok !== true || result?.version !== GOOGLE_SHEETS_WEBHOOK_VERSION) {
      throw new Error(result?.error || 'No se pudo leer el almacenamiento persistente de Google Sheets.');
    }

    return (result.works || []).map((work) => ({
      ...work,
      id: Number(work.id),
      category: Array.isArray(work.category) ? work.category : [],
      votes: Number(work.votes) || 0,
      image_url: work.image_url || null
    })).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  const rows = await all(
    'SELECT * FROM works ORDER BY created_at DESC'
  );

  return rows.map((row) => ({
    ...row,
    category: row.category ? JSON.parse(row.category) : [],
    image_url: row.image_url || null
  }));
}

async function sendToGoogleSheets(record, action = 'upsert') {
  if (!GOOGLE_SHEETS_WEBHOOK_URL) {
    return { enabled: false, skipped: true };
  }

  try {
    const healthResponse = await fetch(GOOGLE_SHEETS_WEBHOOK_URL);
    const healthText = await healthResponse.text();
    let health;
    try {
      health = JSON.parse(healthText);
    } catch {
      health = null;
    }

    if (!healthResponse.ok || health?.version !== GOOGLE_SHEETS_WEBHOOK_VERSION) {
      return {
        enabled: true,
        ok: false,
        status: healthResponse.status,
        error: `La implementación de Google Sheets está desactualizada. Publicá la versión ${GOOGLE_SHEETS_WEBHOOK_VERSION}; se omitió el envío para evitar inconsistencias.`
      };
    }

    const response = await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'salon-plein-air',
        action,
        record
      })
    });

    const responseText = await response.text();
    let webhookResponse;
    try {
      webhookResponse = JSON.parse(responseText);
    } catch {
      webhookResponse = null;
    }

    const ok = response.ok && webhookResponse?.ok === true;
    return {
      enabled: true,
      ok,
      status: response.status,
      body: responseText,
      data: webhookResponse,
      ...(!ok ? { error: webhookResponse?.error || 'Google Sheets no confirmó el guardado.' } : {})
    };
  } catch (error) {
    console.error('Google Sheets sync failed:', error);
    return {
      enabled: true,
      ok: false,
      error: error.message
    };
  }
}

app.get('/api/works', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const works = (await getWorks())
      .filter((work) => work.status === 'approved')
      .map(({ id, title, author, theme, category, commercial_status, description, image_url, status, votes, created_at, price_amount, price_currency }) => ({
        id, title, author, theme, category, commercial_status, description, image_url, status, votes, created_at, price_amount, price_currency
      }));
    res.json({ works });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'No se pudieron cargar las obras.' });
  }
});

app.get('/api/works/export/csv', requireAdmin, async (req, res) => {
  try {
    const works = await getWorks();
    const fields = ['id', 'title', 'author', 'theme', 'category', 'commercial_status', 'price_amount', 'price_currency', 'whatsapp', 'email', 'description', 'image_url', 'status', 'votes', 'created_at'];
    const normalize = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [fields.join(',')].concat(
      works.map((work) => fields.map((field) => normalize(work[field])).join(','))
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="obras.csv"');
    res.send(rows.join('\n'));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'No se pudo exportar la base.' });
  }
});

app.post('/api/works', upload.single('image'), async (req, res) => {
  try {
    if (process.env.VERCEL === '1' && !GOOGLE_SHEETS_WEBHOOK_URL) {
      return res.status(503).json({ message: 'El almacenamiento persistente no está configurado en Vercel.' });
    }

    const { title, author, theme, commercial_status, whatsapp, email, description } = req.body;
    const priceAmount = req.body.price_amount === undefined || req.body.price_amount === ''
      ? null
      : Number(req.body.price_amount);
    const priceCurrency = req.body.price_currency || '';
    const selectedCategories = req.body.category ?
      (Array.isArray(req.body.category) ? req.body.category : [req.body.category]) : [];

    if (!title || !author || !theme || !commercial_status || !req.file) {
      return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }
    if (!['No está a la venta', 'A la venta'].includes(commercial_status)) {
      return res.status(400).json({ message: 'Elegí si la obra está a la venta o no.' });
    }
    if (commercial_status === 'A la venta'
      && (!Number.isFinite(priceAmount) || priceAmount <= 0 || !['ARS', 'USD', 'EUR'].includes(priceCurrency))) {
      return res.status(400).json({ message: 'Ingresá un precio mayor a cero y elegí ARS, USD o EUR.' });
    }
    const savedPriceAmount = commercial_status === 'A la venta' ? priceAmount : null;
    const savedPriceCurrency = commercial_status === 'A la venta' ? priceCurrency : '';

    const imageRelativePath = `/uploads/${req.file.filename}`;
    const workId = Date.now() * 1000 + crypto.randomInt(0, 1000);
    const createdAt = new Date().toISOString();

    const insertResult = await run(
      `INSERT INTO works (id, title, author, theme, category, commercial_status, whatsapp, email, description, image_url, status, price_amount, price_currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        workId,
        title,
        author,
        theme,
        JSON.stringify(selectedCategories),
        commercial_status,
        whatsapp || '',
        email || '',
        description || '',
        imageRelativePath,
        savedPriceAmount,
        savedPriceCurrency,
        createdAt
      ]
    );

    const savedRecord = {
      id: insertResult?.id || workId,
      title,
      author,
      theme,
      category: selectedCategories,
      commercial_status,
      price_amount: savedPriceAmount,
      price_currency: savedPriceCurrency,
      whatsapp: whatsapp || '',
      email: email || '',
      description: description || '',
      image_url: imageRelativePath,
      status: 'pending',
      votes: 0,
      created_at: createdAt
    };

    const sheetRecord = process.env.VERCEL === '1'
      ? {
          ...savedRecord,
          image_base64: fs.readFileSync(req.file.path).toString('base64'),
          image_mime_type: req.file.mimetype,
          image_file_name: req.file.originalname
        }
      : savedRecord;
    const syncResult = await sendToGoogleSheets(sheetRecord);
    if (process.env.VERCEL === '1' && !syncResult.ok) {
      return res.status(502).json({ message: syncResult.error || 'No se pudo guardar la obra de forma persistente.' });
    }

    if (process.env.VERCEL === '1' && req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (syncResult.enabled && !syncResult.ok) {
      console.warn('Google Sheets sync warning:', syncResult);
    }

    const works = await getWorks();
    res.status(201).json({ message: 'Obra enviada correctamente.', works, googleSheets: syncResult });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al guardar la obra.' });
  }
});

app.post('/api/works/:id/vote', async (req, res) => {
  try {
    const { id } = req.params;
    const work = (await getWorks()).find((item) => String(item.id) === String(id));

    if (!work || work.status !== 'approved') {
      return res.status(404).json({ message: 'Obra no disponible para votar.' });
    }

    const updated = { ...work, votes: (Number(work.votes) || 0) + 1 };
    const syncResult = await sendToGoogleSheets(updated);
    if (process.env.VERCEL === '1' && !syncResult.ok) {
      return res.status(502).json({ message: syncResult.error || 'No se pudo guardar el voto de forma persistente.' });
    }
    if (process.env.VERCEL !== '1') {
      await run('UPDATE works SET votes = ? WHERE id = ?', [updated.votes, id]);
    }
    if (syncResult.enabled && !syncResult.ok) {
      console.warn('Google Sheets vote sync warning:', syncResult);
    }
    res.json({ votes: updated.votes, googleSheets: syncResult });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'No se pudo registrar el voto.' });
  }
});

app.patch('/api/works/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Estado no válido.' });
    }

    const existing = (await getWorks()).find((item) => String(item.id) === String(id));
    if (!existing) {
      return res.status(404).json({ message: 'Obra no encontrada.' });
    }

    const updated = { ...existing, status };
    const syncResult = await sendToGoogleSheets(updated);
    if (process.env.VERCEL === '1' && !syncResult.ok) {
      return res.status(502).json({ message: syncResult.error || 'No se pudo guardar el estado de forma persistente.' });
    }
    if (process.env.VERCEL !== '1') {
      await run('UPDATE works SET status = ? WHERE id = ?', [status, id]);
    }
    if (syncResult.enabled && !syncResult.ok) {
      console.warn('Google Sheets status sync warning:', syncResult);
    }

    const works = await getWorks();
    res.json({ message: 'Estado actualizado.', works, googleSheets: syncResult });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'No fue posible actualizar la obra.' });
  }
});

app.delete('/api/works/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const item = (await getWorks()).find((work) => String(work.id) === String(id));
    if (!item) {
      return res.status(404).json({ message: 'Obra no encontrada.' });
    }

    if (process.env.VERCEL !== '1' && item?.image_url) {
      const filePath = path.join(uploadDir, path.basename(item.image_url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    const syncResult = await sendToGoogleSheets({ id: item.id }, 'delete');
    if (process.env.VERCEL === '1' && !syncResult.ok) {
      return res.status(502).json({ message: syncResult.error || 'No se pudo borrar la obra del almacenamiento persistente.' });
    }
    if (process.env.VERCEL !== '1') {
      await run('DELETE FROM works WHERE id = ?', [id]);
    }
    if (syncResult.enabled && !syncResult.ok) {
      console.warn('Google Sheets delete warning:', syncResult);
    }

    const works = await getWorks();
    res.json({
      message: syncResult.enabled && !syncResult.ok
        ? 'La obra se eliminó del sitio, pero Google Sheets no confirmó el borrado.'
        : 'Obra eliminada.',
      works,
      googleSheets: syncResult
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'No fue posible eliminar la obra.' });
  }
});

app.get('*', (req, res) => {
  const siteUrl = getPublicSiteUrl(req);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  res.type('html').send(html.replaceAll('__SITE_URL__', siteUrl));
});

async function start() {
  await init();
  app.listen(PORT, () => console.log(`Servidor funcionando en http://localhost:${PORT}`));
}

start();

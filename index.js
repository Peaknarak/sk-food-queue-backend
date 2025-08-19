// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme_admin_key';

/* ===== Helpers ===== */
function nextId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
function isBookingOpenNow() {
  if (process.env.BYPASS_BOOKING_WINDOW === '1') return true;
  const nowBangkok = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const hour = nowBangkok.getHours();
  return hour >= 8 && hour < 10;
}
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

/* ===== App / Socket ===== */
const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

// rooms: student:<id>, vendor:<id>, order:<id>
io.on('connection', (socket) => {
  socket.on('identify', (payload) => {
    if (payload?.role === 'student' && payload?.studentId) socket.join(`student:${payload.studentId}`);
    if (payload?.role === 'vendor' && payload?.vendorId)   socket.join(`vendor:${payload.vendorId}`);
  });

  socket.on('chat:join', (orderId) => { if (orderId) socket.join(`order:${orderId}`); });

  socket.on('chat:message', async (msg) => {
    if (!msg?.orderId || !msg?.text) return;
    const saved = await prisma.message.create({
      data: { id: nextId('msg_'), orderId: String(msg.orderId), from: String(msg.from || 'unknown'), text: String(msg.text), ts: new Date() },
      select: { id: true, from: true, text: true, ts: true }
    });
    io.to(`order:${msg.orderId}`).emit('chat:message', { orderId: String(msg.orderId), ...saved });
  });
});

/* ===== Health / Config ===== */
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/config', (req, res) => {
  const nowBangkok = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  res.json({
    ok: true,
    bookingOpen: isBookingOpenNow(),
    testMode: process.env.BYPASS_BOOKING_WINDOW === '1',
    now: nowBangkok.toISOString()
  });
});

/* ===== Chat History ===== */
app.get('/orders/:id/messages', async (req, res) => {
  const id = String(req.params.id);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  const msgs = await prisma.message.findMany({
    where: { orderId: id },
    orderBy: { ts: 'asc' },
    select: { id: true, from: true, text: true, ts: true }
  });
  res.json({ ok: true, messages: msgs });
});

app.post('/orders/:id/messages', async (req, res) => {
  const id = String(req.params.id);
  const { from, text } = req.body || {};
  if (!from || !text) return res.status(400).send('Missing from/text');

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  const saved = await prisma.message.create({
    data: { id: nextId('msg_'), orderId: id, from: String(from), text: String(text), ts: new Date() },
    select: { id: true, from: true, text: true, ts: true }
  });
  io.to(`order:${id}`).emit('chat:message', { orderId: id, ...saved });
  res.json({ ok: true, message: saved });
});

/* ===== Auth (ตามเดิม) ===== */
app.post('/auth/login', async (req, res) => {
  const { type, studentId, vendorId } = req.body || {};
  if (type === 'student' && studentId) {
    let user = await prisma.user.findUnique({ where: { id: String(studentId) } });
    if (!user) user = await prisma.user.create({ data: { id: String(studentId), type: 'student', name: `Student ${studentId}` } });
    return res.json({ ok: true, user });
  }
  if (type === 'vendor' && vendorId) {
    let user = await prisma.user.findUnique({ where: { id: String(vendorId) } });
    if (!user) {
      await prisma.vendor.upsert({ where: { id: String(vendorId) }, update: {}, create: { id: String(vendorId), name: `Vendor ${vendorId}` } });
      user = await prisma.user.create({ data: { id: String(vendorId), type: 'vendor', name: `Vendor ${vendorId}`, vendorId: String(vendorId) } });
    }
    return res.json({ ok: true, user });
  }
  return res.status(400).json({ ok: false, error: 'Invalid login payload' });
});

/* ===== Vendors & Menus (คัดเฉพาะที่อนุมัติแล้วให้ฝั่งนักเรียนเห็น) ===== */
app.get('/vendors', async (req, res) => {
  const vendors = await prisma.vendor.findMany({ where: { approved: true }, orderBy: { name: 'asc' } });
  res.json({ ok: true, vendors });
});
app.get('/menus', async (req, res) => {
  const vendorId = String(req.query.vendorId || '');
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || !vendor.approved) return res.json({ ok: true, items: [] });
  const list = await prisma.menuItem.findMany({ where: { vendorId, approved: true }, orderBy: { createdAt: 'desc' } });
  res.json({ ok: true, items: list });
});

/* ===== Orders ===== */
app.get('/orders', async (req, res) => {
  const { studentId, vendorId } = req.query || {};
  const where = {};
  if (studentId) where.studentId = String(studentId);
  if (vendorId) where.vendorId = String(vendorId);
  const orders = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, include: { items: true } });
  res.json({ ok: true, orders });
});

app.post('/orders', async (req, res) => {
  if (!isBookingOpenNow()) {
    return res.status(403).json({ ok: false, error: 'Booking allowed only 08:00–10:00 (Asia/Bangkok).' });
  }
  const { studentId, vendorId, items } = req.body || {};
  if (!studentId || !vendorId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing studentId, vendorId or items' });
  }
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || !vendor.approved) throw new Error('Vendor not approved');

    const priced = [];
    for (const it of items) {
      const m = await prisma.menuItem.findFirst({ where: { id: it.menuItemId, vendorId, approved: true } });
      if (!m) throw new Error('Menu item not approved/not found');
      const qty = Math.max(1, Number(it.qty || 1));
      priced.push({ menuItemId: m.id, qty, price: m.price, name: m.name });
    }
    const total = priced.reduce((s, it) => s + it.price * it.qty, 0);
    const orderId = nextId('ord_');

    const order = await prisma.order.create({
      data: {
        id: orderId,
        studentId,
        vendorId,
        total,
        status: 'created',
        items: {
          create: priced.map(p => ({ id: nextId('itm_'), menuItemId: p.menuItemId, name: p.name, price: p.price, qty: p.qty }))
        }
      },
      include: { items: true }
    });

    io.to(`vendor:${vendorId}`).emit('order:new', order);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/payments/create-qr', async (req, res) => {
  const { orderId } = req.body || {};
  const order = await prisma.order.findUnique({ where: { id: String(orderId) } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
  const payload = JSON.stringify({ orderId: order.id, amount: order.total, currency: 'THB' });
  const qrDataUrl = await QRCode.toDataURL(payload);
  res.json({ ok: true, qrDataUrl });
});

app.post('/orders/:id/pay', async (req, res) => {
  const id = String(req.params.id);
  let order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  order = await prisma.order.update({ where: { id }, data: { status: 'pending_vendor_confirmation', paidAt: new Date() }, include: { items: true } });
  io.to(`vendor:${order.vendorId}`).emit('order:paid', order);
  io.to(`student:${order.studentId}`).emit('order:update', order);
  res.json({ ok: true, order });
});

app.post('/orders/:id/accept', async (req, res) => {
  const id = String(req.params.id);
  let order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  const qc = await prisma.queueCounter.upsert({ where: { vendorId: order.vendorId }, update: { current: { increment: 1 } }, create: { vendorId: order.vendorId, current: 1 } });
  order = await prisma.order.update({ where: { id }, data: { status: 'accepted', queueNumber: qc.current }, include: { items: true } });

  io.to(`student:${order.studentId}`).emit('order:update', order);
  res.json({ ok: true, order });
});

app.post('/orders/:id/reject', async (req, res) => {
  const id = String(req.params.id);
  let order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  order = await prisma.order.update({ where: { id }, data: { status: 'rejected' }, include: { items: true } });
  io.to(`student:${order.studentId}`).emit('order:update', order);
  res.json({ ok: true, order });
});

/* ===== Vendor self-manage menus ===== */
app.post('/vendor/foods', async (req, res) => {
  const { vendorId, name, price } = req.body || {};
  if (!vendorId || !name || typeof price !== 'number') return res.status(400).json({ ok: false, error: 'Missing vendorId/name/price' });
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || !vendor.approved) return res.status(400).json({ ok: false, error: 'Vendor not approved' });

  const menu = await prisma.menuItem.create({
    data: { id: nextId('mnu_'), vendorId, name: String(name), price: Math.max(0, Math.round(price)), approved: false }
  });
  res.json({ ok: true, item: menu });
});
app.get('/vendor/foods', async (req, res) => {
  const vendorId = String(req.query.vendorId || '');
  const items = await prisma.menuItem.findMany({ where: { vendorId }, orderBy: { createdAt: 'desc' } });
  res.json({ ok: true, items });
});

/* ===== Admin endpoints (need x-admin-key) ===== */
app.get('/admin/vendors/pending', requireAdmin, async (req, res) => {
  const list = await prisma.vendor.findMany({ where: { approved: false }, orderBy: { createdAt: 'desc' } });
  res.json({ ok: true, vendors: list });
});
app.post('/admin/vendors/:id/approve', requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const v = await prisma.vendor.update({ where: { id }, data: { approved: true } });
  res.json({ ok: true, vendor: v });
});

app.get('/admin/foods/pending', requireAdmin, async (req, res) => {
  const list = await prisma.menuItem.findMany({ where: { approved: false }, orderBy: { createdAt: 'desc' } });
  res.json({ ok: true, items: list });
});
app.post('/admin/foods/:id/approve', requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const item = await prisma.menuItem.update({ where: { id }, data: { approved: true } });
  res.json({ ok: true, item });
});
app.delete('/admin/foods/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  await prisma.menuItem.delete({ where: { id } });
  res.json({ ok: true });
});

server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

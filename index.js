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

/* ============ Helpers ============ */
function nextId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
function isBookingOpenNow() {
  if (process.env.BYPASS_BOOKING_WINDOW === '1') return true;
  const nowBangkok = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const hour = nowBangkok.getHours();
  return hour >= 8 && hour < 10;
}

/* ============ App / Socket ============ */
const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

// rooms: student:<id>, vendor:<id>, order:<id>
io.on('connection', (socket) => {
  socket.on('identify', (payload) => {
    if (payload?.role === 'student' && payload?.studentId) {
      socket.join(`student:${payload.studentId}`);
    } else if (payload?.role === 'vendor' && payload?.vendorId) {
      socket.join(`vendor:${payload.vendorId}`);
    }
  });

  socket.on('chat:join', (orderId) => {
    if (orderId) socket.join(`order:${orderId}`);
  });

  socket.on('chat:message', async (msg) => {
    if (!msg?.orderId || !msg?.text) return;

    const saved = await prisma.message.create({
      data: {
        id: nextId('msg_'),
        orderId: String(msg.orderId),
        from: String(msg.from || 'unknown'),
        text: String(msg.text),
        ts: new Date(),
      },
      select: { id: true, from: true, text: true, ts: true },
    });

    io.to(`order:${msg.orderId}`).emit('chat:message', {
      orderId: String(msg.orderId),
      ...saved,
    });
  });
});

/* ============ Basic routes ============ */
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/config', (req, res) => {
  const nowBangkok = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  res.json({
    ok: true,
    bookingOpen: isBookingOpenNow(),
    testMode: process.env.BYPASS_BOOKING_WINDOW === '1',
    now: nowBangkok.toISOString(),
  });
});

/* ============ Auth ============ */
app.post('/auth/login', async (req, res) => {
  const { type, studentId, vendorId, adminKey } = req.body || {};

  // Admin login
  if (type === 'admin') {
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: 'Invalid admin key' });
    }
    let user = await prisma.user.findUnique({ where: { id: 'admin' } });
    if (!user) {
      user = await prisma.user.create({
        data: { id: 'admin', name: 'Administrator', role: 'admin' },
      });
    }
    return res.json({ ok: true, user });
  }

  // Student
  if (type === 'student' && studentId) {
    const id = String(studentId);
    let user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      user = await prisma.user.create({ data: { id, name: `Student ${id}`, role: 'student' } });
    }
    return res.json({ ok: true, user });
  }

  // Vendor
  if (type === 'vendor' && vendorId) {
    const id = String(vendorId);
    let user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      // ถ้าไม่มี Vendor มาก่อน ให้สร้าง Vendor (ยังไม่อนุมัติ) และ user.role = vendor
      await prisma.vendor.upsert({
        where: { id },
        update: {},
        create: { id, name: `Vendor ${id}`, approved: false },
      });
      user = await prisma.user.create({
        data: { id, name: `Vendor ${id}`, role: 'vendor', vendorId: id },
      });
    }
    return res.json({ ok: true, user });
  }

  return res.status(400).json({ ok: false, error: 'Invalid login payload' });
});

/* ============ Admin: Vendor management ============ */
// สร้าง/แก้ไข/ดึง/อนุมัติ/ยกเลิกอนุมัติ/ลบ (ต้องมี x-admin-key = ADMIN_KEY)
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
}

// รายการร้านทั้งหมด (ทั้งอนุมัติ/ไม่อนุมัติ)
app.get('/admin/vendors', requireAdmin, async (req, res) => {
  const vendors = await prisma.vendor.findMany({ orderBy: { id: 'asc' } });
  res.json({ ok: true, vendors });
});

// สร้างหรือแก้ไขร้าน (id, name, approved?)
app.post('/admin/vendors', requireAdmin, async (req, res) => {
  const { id, name, approved } = req.body || {};
  if (!id || !name) return res.status(400).json({ ok: false, error: 'id/name required' });

  const v = await prisma.vendor.upsert({
    where: { id: String(id) },
    update: { name: String(name), approved: approved === true },
    create: { id: String(id), name: String(name), approved: approved === true },
  });
  res.json({ ok: true, vendor: v });
});

// อนุมัติ
app.post('/admin/vendors/:id/approve', requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const v = await prisma.vendor.update({ where: { id }, data: { approved: true } });
  res.json({ ok: true, vendor: v });
});

// ยกเลิกอนุมัติ
app.post('/admin/vendors/:id/reject', requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const v = await prisma.vendor.update({ where: { id }, data: { approved: false } });
  res.json({ ok: true, vendor: v });
});

// ลบร้าน
app.delete('/admin/vendors/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  await prisma.vendor.delete({ where: { id } });
  res.json({ ok: true });
});

/* ============ Public Vendors & Menus (นักเรียนเห็นเฉพาะร้านที่อนุมัติแล้ว) ============ */
app.get('/vendors', async (req, res) => {
  const vendors = await prisma.vendor.findMany({ where: { approved: true }, orderBy: { id: 'asc' } });
  res.json({ ok: true, vendors });
});

app.get('/menus', async (req, res) => {
  const vendorId = String(req.query.vendorId || '');
  const list = await prisma.menuItem.findMany({ where: { vendorId }, orderBy: { id: 'asc' } });
  res.json({ ok: true, items: list });
});

/* ============ Vendor Menus CRUD (สำหรับร้าน) ============ */
// ไม่ใส่ auth จริง เพื่อความง่าย: ต้องส่ง vendorId ให้ตรง user ที่ล็อกอินเอง
app.get('/vendor/menus', async (req, res) => {
  const vendorId = String(req.query.vendorId || '');
  const items = await prisma.menuItem.findMany({ where: { vendorId }, orderBy: { createdAt: 'desc' } });
  res.json({ ok: true, items });
});

app.post('/vendor/menus', async (req, res) => {
  const { vendorId, name, price } = req.body || {};
  if (!vendorId || !name || typeof price !== 'number') {
    return res.status(400).json({ ok: false, error: 'vendorId/name/price required' });
  }
  const v = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!v) return res.status(404).json({ ok: false, error: 'Vendor not found' });
  if (!v.approved) return res.status(403).json({ ok: false, error: 'Vendor is not approved' });

  const item = await prisma.menuItem.create({
    data: { id: nextId('m_'), vendorId, name: String(name), price: Number(price) },
  });
  res.json({ ok: true, item });
});

app.patch('/vendor/menus/:id', async (req, res) => {
  const id = String(req.params.id);
  const { name, price } = req.body || {};
  const updated = await prisma.menuItem.update({
    where: { id },
    data: {
      ...(name ? { name: String(name) } : {}),
      ...(typeof price === 'number' ? { price: Number(price) } : {}),
    },
  });
  res.json({ ok: true, item: updated });
});

app.delete('/vendor/menus/:id', async (req, res) => {
  const id = String(req.params.id);
  await prisma.menuItem.delete({ where: { id } });
  res.json({ ok: true });
});
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});
/* ============ Orders (เดิม) ============ */
app.get('/orders', async (req, res) => {
  const { studentId, vendorId } = req.query || {};
  const where = {};
  if (studentId) where.studentId = String(studentId);
  if (vendorId) where.vendorId = String(vendorId);
  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
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
    // vendor ต้อง approved
    const v = await prisma.vendor.findUnique({ where: { id: String(vendorId) } });
    if (!v || !v.approved) return res.status(400).json({ ok: false, error: 'Vendor not available' });

    const priced = [];
    for (const it of items) {
      const m = await prisma.menuItem.findFirst({ where: { id: it.menuItemId, vendorId: String(vendorId) } });
      if (!m) throw new Error('Menu item not found');
      const qty = Math.max(1, Number(it.qty || 1));
      priced.push({ menuItemId: m.id, qty, price: m.price, name: m.name });
    }
    const total = priced.reduce((s, it) => s + it.price * it.qty, 0);
    const orderId = nextId('ord_');

    const order = await prisma.order.create({
      data: {
        id: orderId,
        studentId: String(studentId),
        vendorId: String(vendorId),
        total,
        status: 'created',
        items: {
          create: priced.map(p => ({
            id: nextId('itm_'),
            menuItemId: p.menuItemId,
            name: p.name,
            price: p.price,
            qty: p.qty,
          })),
        },
      },
      include: { items: true },
    });

    io.to(`vendor:${vendorId}`).emit('order:new', order);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/* ============ Payments (Mock) ============ */
app.post('/payments/create-qr', async (req, res) => {
  const { orderId } = req.body || {};
  const order = await prisma.order.findUnique({ where: { id: String(orderId) } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
  const payload = JSON.stringify({ orderId: order.id, amount: order.total, currency: 'THB' });
  const qrDataUrl = await QRCode.toDataURL(payload);
  res.json({ ok: true, qrDataUrl });
});

/* ============ Order status change ============ */
app.post('/orders/:id/pay', async (req, res) => {
  const id = String(req.params.id);
  let order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  order = await prisma.order.update({
    where: { id },
    data: { status: 'pending_vendor_confirmation', paidAt: new Date() },
    include: { items: true },
  });

  io.to(`vendor:${order.vendorId}`).emit('order:paid', order);
  io.to(`student:${order.studentId}`).emit('order:update', order);
  res.json({ ok: true, order });
});

app.post('/orders/:id/accept', async (req, res) => {
  const id = String(req.params.id);
  let order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  const qc = await prisma.queueCounter.upsert({
    where: { vendorId: order.vendorId },
    update: { current: { increment: 1 } },
    create: { vendorId: order.vendorId, current: 1 },
  });

  order = await prisma.order.update({
    where: { id },
    data: { status: 'accepted', queueNumber: qc.current },
    include: { items: true },
  });

  io.to(`student:${order.studentId}`).emit('order:update', order);
  res.json({ ok: true, order });
});

app.post('/orders/:id/reject', async (req, res) => {
  const id = String(req.params.id);
  let order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

  order = await prisma.order.update({
    where: { id },
    data: { status: 'rejected' },
    include: { items: true },
  });

  io.to(`student:${order.studentId}`).emit('order:update', order);
  res.json({ ok: true, order });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

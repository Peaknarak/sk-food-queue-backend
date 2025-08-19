// server/seed.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding...');

  // สร้างผู้ใช้ตัวอย่าง
  await prisma.user.upsert({
    where: { id: 's12345' },
    update: {},
    create: { id: 's12345', type: 'student', name: 'Student 12345' }
  });
  await prisma.user.upsert({
    where: { id: 'v001' },
    update: {},
    create: { id: 'v001', type: 'vendor', name: 'Vendor v001', vendorId: 'v001' }
  });

  // สร้างร้าน (ยังไม่อนุมัติ 1 ร้าน / อนุมัติ 1 ร้าน)
  await prisma.vendor.upsert({ where: { id: 'v001' }, update: {}, create: { id: 'v001', name: 'ร้านโกปี๊', approved: true } });
  await prisma.vendor.upsert({ where: { id: 'v002' }, update: {}, create: { id: 'v002', name: 'ร้านข้าวมันไก่', approved: false } });

  // เมนูของ v001 (อันหนึ่ง approved, อันหนึ่ง pending)
  await prisma.menuItem.upsert({
    where: { id: 'mnu_demo1' },
    update: {},
    create: { id: 'mnu_demo1', vendorId: 'v001', name: 'ข้าวหมูแดง', price: 45, approved: true }
  });
  await prisma.menuItem.upsert({
    where: { id: 'mnu_demo2' },
    update: {},
    create: { id: 'mnu_demo2', vendorId: 'v001', name: 'บะหมี่เกี๊ยว', price: 50, approved: false }
  });

  console.log('Done.');
}
main().finally(() => prisma.$disconnect());

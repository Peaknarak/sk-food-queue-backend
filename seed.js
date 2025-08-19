// server/seed.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  // สร้าง admin (ถ้ายังไม่มี)
  await prisma.user.upsert({
    where: { id: 'admin' },
    update: {},
    create: { id: 'admin', name: 'Administrator', role: 'admin' },
  });

  // ตัวอย่าง Vendor อนุมัติแล้ว
  await prisma.vendor.upsert({
    where: { id: 'V001' },
    update: { approved: true },
    create: { id: 'V001', name: 'Thai Kitchen', approved: true },
  });

  // เมนูตัวอย่าง
  await prisma.menuItem.upsert({
    where: { id: 'm_demo_padthai' },
    update: {},
    create: { id: 'm_demo_padthai', vendorId: 'V001', name: 'ผัดไท', price: 45 },
  });
  await prisma.menuItem.upsert({
    where: { id: 'm_demo_krapao' },
    update: {},
    create: { id: 'm_demo_krapao', vendorId: 'V001', name: 'กะเพราไก่', price: 40 },
  });

  console.log('Seed complete');
}
main().finally(()=> prisma.$disconnect());

// server/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function id(prefix) { return prefix + Math.random().toString(36).slice(2,8); }

async function main(){
  // Users
  await prisma.user.upsert({
    where: { id: 'S12345' },
    update: {},
    create: { id: 'S12345', type: 'student', name: 'Student 12345' }
  });
  await prisma.user.upsert({
    where: { id: 'V001' },
    update: {},
    create: { id: 'V001', type: 'vendor', name: 'Vendor 001', vendorId: 'V001' }
  });

  // Vendors
  await prisma.vendor.upsert({
    where: { id: 'V001' },
    update: { name: 'Cafeteria A' },
    create: { id: 'V001', name: 'Cafeteria A' }
  });
  await prisma.vendor.upsert({
    where: { id: 'V002' },
    update: { name: 'Noodle Station' },
    create: { id: 'V002', name: 'Noodle Station' }
  });

  // Menu items
  const menus = [
    { id: 'M001', vendorId: 'V001', name: 'Fried Rice', price: 40 },
    { id: 'M002', vendorId: 'V001', name: 'Basil Chicken', price: 45 },
    { id: 'M101', vendorId: 'V002', name: 'Beef Noodle', price: 55 },
    { id: 'M102', vendorId: 'V002', name: 'Tom Yum Noodle', price: 50 },
  ];
  for (const m of menus){
    await prisma.menuItem.upsert({ where: { id: m.id }, update: m, create: m });
  }

  // Queue counters
  await prisma.queueCounter.upsert({
    where: { vendorId: 'V001' },
    update: {},
    create: { vendorId: 'V001', current: 0 }
  });
  await prisma.queueCounter.upsert({
    where: { vendorId: 'V002' },
    update: {},
    create: { vendorId: 'V002', current: 0 }
  });

  console.log('Seed complete');
}

main().finally(()=>prisma.$disconnect());

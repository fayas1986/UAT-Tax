import prisma from '../server/src/lib/prisma.js';

async function run() {
  const branches = await prisma.branch.findMany({
    where: { company_id: 1, is_deleted: false },
    orderBy: { id: 'asc' }
  });
  console.log('All non-deleted branches for company 1:');
  for (const b of branches) {
    const invCount = await prisma.invoice.count({ where: { branch_id: b.id } });
    console.log(`ID: ${b.id}, Code: ${b.code}, Name: "${b.name}", Invoices: ${invCount}`);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

import prisma from '../server/src/lib/prisma.js';

async function align() {
  console.log('[Align] Starting branch alignment for Alwadi Trading...');

  // 1. Move invoices from 263-269 to 1-7
  const branchMap: Record<number, number> = {
    263: 1, // HQ -> BR-001
    264: 2, // Jeddah -> BR-002
    265: 3, // Dammam -> BR-003
    266: 4, // Khobar -> BR-004
    267: 6, // Mecca -> BR-006
    268: 5, // Medina -> BR-005
    269: 7  // Tabuk -> BR-007
  };

  for (const [fromId, toId] of Object.entries(branchMap)) {
    const updated = await prisma.invoice.updateMany({
      where: { branch_id: parseInt(fromId) },
      data: { branch_id: toId }
    });
    console.log(`[Align] Moved ${updated.count} invoices from branch ${fromId} to branch ${toId}`);
  }

  // 2. Soft-delete the duplicate branches 263-269 so they don't clutter the UI
  const deletedDuplicates = await prisma.branch.updateMany({
    where: { id: { in: [263, 264, 265, 266, 267, 268, 269] } },
    data: { is_deleted: true }
  });
  console.log(`[Align] Marked ${deletedDuplicates.count} duplicate branches as deleted`);

  // 3. Ensure branches 1 to 7 are active and not deleted
  await prisma.branch.updateMany({
    where: { id: { in: [1, 2, 3, 4, 5, 6, 7] } },
    data: { is_active: true, is_deleted: false }
  });

  // 4. Verify invoice count per branch
  const branches = await prisma.branch.findMany({
    where: { company_id: 1, is_deleted: false },
    orderBy: { id: 'asc' }
  });

  console.log('[Align] Current Active Branches and Invoices:');
  for (const b of branches) {
    const count = await prisma.invoice.count({ where: { branch_id: b.id } });
    console.log(`  Branch ${b.id} (${b.code} - ${b.name}): ${count} invoices`);
  }
}

align().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

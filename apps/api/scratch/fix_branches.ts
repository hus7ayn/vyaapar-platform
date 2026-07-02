import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const branches = await prisma.branch.findMany();
  for (const branch of branches) {
    const warehouse = await prisma.warehouse.findFirst({
      where: { code: `WH-${branch.code}`, businessId: branch.businessId }
    });
    if (warehouse && !warehouse.branchId) {
      await prisma.warehouse.update({
        where: { id: warehouse.id },
        data: { branchId: branch.id }
      });
      console.log(`Linked Warehouse ${warehouse.code} to Branch ${branch.code}`);
    }
  }
}

main()
  .then(async () => await prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

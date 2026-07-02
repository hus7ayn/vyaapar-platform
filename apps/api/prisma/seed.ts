import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ROLE_PERMISSIONS } from '@nexus/shared';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Demo@123456', 12);
  const superAdminHash = await bcrypt.hash('SuperAdmin@123456', 12);
  const adminPermissions = ROLE_PERMISSIONS.ADMIN;
  const superPermissions = ROLE_PERMISSIONS.SUPER_ADMIN;
  const billerPermissions = ROLE_PERMISSIONS.BILLER;

  const platformBusiness = await prisma.business.upsert({
    where: { slug: 'nexus-platform' },
    update: {},
    create: {
      name: 'Vyaapar Platform',
      slug: 'nexus-platform',
      email: 'platform@nexus.demo',
      currency: 'INR',
    },
  });

  await prisma.user.upsert({
    where: {
      businessId_email: { businessId: platformBusiness.id, email: 'superadmin@nexus.demo' },
    },
    update: { permissions: superPermissions },
    create: {
      businessId: platformBusiness.id,
      email: 'superadmin@nexus.demo',
      passwordHash: superAdminHash,
      firstName: 'Platform',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      permissions: superPermissions,
    },
  });

  const business = await prisma.business.upsert({
    where: { slug: 'grand-plaza-demo' },
    update: { name: 'Grand Plaza Retail', gstNumber: '27AABCU9603R1ZM', state: 'Maharashtra' },
    create: {
      name: 'Grand Plaza Retail',
      slug: 'grand-plaza-demo',
      email: 'admin@grandplaza.demo',
      phone: '+91 98765 43210',
      address: '123 MG Road, Mumbai',
      gstNumber: '27AABCU9603R1ZM',
      state: 'Maharashtra',
      currency: 'INR',
    },
  });

  const branch = await prisma.branch.upsert({
    where: { businessId_code: { businessId: business.id, code: 'MAIN' } },
    update: { type: 'SHOP', isDefault: true },
    create: {
      businessId: business.id,
      name: 'Main Store',
      code: 'MAIN',
      address: business.address ?? undefined,
      type: 'SHOP',
      isDefault: true,
    },
  });

  const branch2 = await prisma.branch.upsert({
    where: { businessId_code: { businessId: business.id, code: 'BR02' } },
    update: { type: 'SHOP' },
    create: {
      businessId: business.id,
      name: 'City Mall Outlet',
      code: 'BR02',
      address: '45 Link Road, Mumbai',
      type: 'SHOP',
      isDefault: false,
    },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { businessId_code: { businessId: business.id, code: 'WH-MAIN' } },
    update: { branchId: branch.id },
    create: {
      businessId: business.id,
      branchId: branch.id,
      name: 'Main Store Warehouse',
      code: 'WH-MAIN',
    },
  });

  await prisma.warehouse.upsert({
    where: { businessId_code: { businessId: business.id, code: 'WH-BR02' } },
    update: { branchId: branch2.id },
    create: {
      businessId: business.id,
      branchId: branch2.id,
      name: 'City Mall Store',
      code: 'WH-BR02',
    },
  });

  const admin = await prisma.user.upsert({
    where: { businessId_email: { businessId: business.id, email: 'admin@grandplaza.demo' } },
    update: { permissions: adminPermissions, branchId: branch.id },
    create: {
      businessId: business.id,
      branchId: branch.id,
      email: 'admin@grandplaza.demo',
      passwordHash,
      firstName: 'Raj',
      lastName: 'Sharma',
      role: 'ADMIN',
      permissions: adminPermissions,
    },
  });

  await prisma.user.upsert({
    where: { businessId_email: { businessId: business.id, email: 'cashier@grandplaza.demo' } },
    update: { permissions: billerPermissions, branchId: branch.id },
    create: {
      businessId: business.id,
      branchId: branch.id,
      email: 'cashier@grandplaza.demo',
      passwordHash,
      firstName: 'Priya',
      lastName: 'Patel',
      role: 'BILLER',
      permissions: billerPermissions,
    },
  });

  // ─── Cash & Bank ───────────────────────────────────────────────────────────

  const cashAccount = await prisma.bankAccount.upsert({
    where: { id: 'seed-cash-account' },
    update: { branchId: branch.id },
    create: {
      id: 'seed-cash-account',
      businessId: business.id,
      branchId: branch.id,
      name: 'Cash In Hand',
      accountType: 'CASH',
      openingBalance: 50000,
      balance: 50000,
    },
  });

  await prisma.bankAccount.upsert({
    where: { id: 'seed-bank-account' },
    update: { branchId: branch.id },
    create: {
      id: 'seed-bank-account',
      businessId: business.id,
      branchId: branch.id,
      name: 'HDFC Current Account',
      accountType: 'BANK',
      bankName: 'HDFC Bank',
      accountNumber: '50100XXXXXX',
      ifscCode: 'HDFC0001234',
      upiId: 'grandplaza@hdfcbank',
      openingBalance: 125000,
      balance: 125000,
      printOnInvoice: true,
    },
  });

  // ─── Parties ───────────────────────────────────────────────────────────────

  const partySeeds = [
    { id: 'seed-party-ramesh', name: 'Ramesh Kumar', phone: '+91 91234 56789', gstin: '27AABCR5678G1Z2', gstType: 'REGISTERED', state: 'Maharashtra', partyType: 'CUSTOMER' },
    { id: 'seed-party-walkin', name: 'Walk-in Customer', phone: '+91 90000 00001', partyType: 'CUSTOMER' },
    { id: 'seed-party-sunita', name: 'Sunita Traders', phone: '+91 98989 12121', gstin: '24AAACS1234H1Z9', gstType: 'REGISTERED', state: 'Gujarat', partyType: 'BOTH' },
    { id: 'seed-party-mwt', name: 'Mumbai Wholesale Traders', phone: '+91 99887 76655', gstin: '27AABCT1234F1Z5', gstType: 'REGISTERED', state: 'Maharashtra', partyType: 'SUPPLIER' },
    { id: 'seed-party-ffd', name: 'Fresh Foods Distributors', phone: '+91 98765 11111', partyType: 'SUPPLIER' },
  ];
  for (const p of partySeeds) {
    await prisma.party.upsert({
      where: { id: p.id },
      update: {},
      create: { businessId: business.id, branchId: branch.id, ...p },
    });
  }

  // ─── Items ─────────────────────────────────────────────────────────────────

  const categories = await Promise.all(
    ['Beverages', 'Snacks', 'Restaurant', 'Room Service', 'Amenities'].map((name, i) =>
      prisma.category.upsert({
        where: { businessId_branchId_slug: { businessId: business.id, branchId: branch.id, slug: name.toLowerCase().replace(/\s+/g, '-') } },
        update: {},
        create: { businessId: business.id, branchId: branch.id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), sortOrder: i },
      }),
    ),
  );

  const itemSeeds = [
    { name: 'Masala Chai', sku: 'BEV-001', barcode: '8901001001001', price: 40, cat: 0, hsn: '09023010', unit: 'PCS' },
    { name: 'Cold Coffee', sku: 'BEV-002', barcode: '8901001001002', price: 80, cat: 0, hsn: '09012100', unit: 'PCS' },
    { name: 'Mineral Water 1L', sku: 'BEV-003', barcode: '8901001001003', price: 30, cat: 0, hsn: '22011010', unit: 'BTL' },
    { name: 'Veg Sandwich', sku: 'SNK-001', barcode: '8901001002001', price: 120, cat: 1, hsn: '19059090', unit: 'PCS' },
    { name: 'Paneer Tikka', sku: 'RST-001', barcode: '8901001003001', price: 280, cat: 2, hsn: '21069099', unit: 'PCS' },
    { name: 'Dal Makhani', sku: 'RST-002', barcode: '8901001003002', price: 220, cat: 2, hsn: '21069099', unit: 'PCS' },
    { name: 'Room Service Breakfast', sku: 'RSV-001', barcode: '8901001004001', price: 450, cat: 3, hsn: '21069099', unit: 'PCS' },
    { name: 'Laundry Shirt', sku: 'RSV-002', barcode: '8901001004002', price: 80, cat: 3, hsn: '96039000', unit: 'PCS' },
    { name: 'Toothbrush Kit', sku: 'AMN-001', barcode: '8901001005001', price: 50, cat: 4, hsn: '96032100', unit: 'PAC' },
    { name: 'Shampoo Sachet', sku: 'AMN-002', barcode: '8901001005002', price: 25, cat: 4, hsn: '33051090', unit: 'PAC' },
  ];

  for (const p of itemSeeds) {
    const purchase = Math.round(p.price * 0.6);
    const item = await prisma.item.upsert({
      where: { businessId_branchId_sku: { businessId: business.id, branchId: branch.id, sku: p.sku } },
      update: { hsnCode: p.hsn },
      create: {
        businessId: business.id,
        branchId: branch.id,
        categoryId: categories[p.cat].id,
        itemType: 'PRODUCT',
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        hsnCode: p.hsn,
        salePrice: p.price,
        purchasePrice: purchase,
        costPrice: purchase,
        wholesalePrice: Math.round(p.price * 0.85),
        wholesaleMinQty: 10,
        taxRate: 5,
        baseUnit: p.unit,
        openingStock: 100,
        currentStock: 100,
        minStock: 10,
      },
    });

    const existing = await prisma.stockLevel.findFirst({
      where: { itemId: item.id, warehouseId: warehouse.id },
    });
    if (!existing) {
      await prisma.stockLevel.create({
        data: {
          itemId: item.id,
          warehouseId: warehouse.id,
          branchId: branch.id,
          quantity: 100,
          minStock: 10,
        },
      });
    }
  }

  // Service item example
  await prisma.item.upsert({
    where: { businessId_branchId_sku: { businessId: business.id, branchId: branch.id, sku: 'SRV-001' } },
    update: {},
    create: {
      businessId: business.id,
      branchId: branch.id,
      itemType: 'SERVICE',
      name: 'Home Delivery',
      sku: 'SRV-001',
      hsnCode: '996813',
      salePrice: 50,
      taxRate: 18,
      baseUnit: 'NOS',
      trackStock: false,
    },
  });

  // ─── Default expense categories & firm settings ────────────────────────────

  for (const c of [
    { name: 'Rent', isGst: false },
    { name: 'Salary', isGst: false },
    { name: 'Electricity', isGst: false },
    { name: 'Transport', isGst: true },
    { name: 'Miscellaneous', isGst: false },
  ]) {
    await prisma.expenseCategory.upsert({
      where: { businessId_branchId_name: { businessId: business.id, branchId: branch.id, name: c.name } },
      update: {},
      create: { businessId: business.id, branchId: branch.id, ...c },
    });
  }

  await prisma.firmSettings.upsert({
    where: { businessId: business.id },
    update: {},
    create: {
      businessId: business.id,
      txnPrefixes: {
        SALE_INVOICE: 'INV', CREDIT_NOTE: 'CN', SALE_ORDER: 'SO', DELIVERY_CHALLAN: 'DC',
        ESTIMATE: 'EST', PAYMENT_IN: 'PI', PURCHASE_BILL: 'PB', DEBIT_NOTE: 'DN',
        PURCHASE_ORDER: 'PO', PAYMENT_OUT: 'PMO', EXPENSE: 'EXP', P2P_TRANSFER: 'P2P',
      },
      termsAndConditions: 'Thank you for doing business with us.',
      additionalChargesConfig: [
        { name: 'Shipping', enabled: true },
        { name: 'Packaging', enabled: false },
      ],
    },
  });

  // ─── Hotel PMS (kept module) ───────────────────────────────────────────────

  const roomCats = await Promise.all([
    prisma.roomCategory.upsert({
      where: { id: 'seed-deluxe' },
      update: {},
      create: {
        id: 'seed-deluxe',
        businessId: business.id,
        branchId: branch.id,
        name: 'Deluxe',
        basePrice: 3500,
        maxGuests: 2,
        amenities: ['WiFi', 'AC', 'TV'],
      },
    }),
    prisma.roomCategory.upsert({
      where: { id: 'seed-suite' },
      update: {},
      create: {
        id: 'seed-suite',
        businessId: business.id,
        branchId: branch.id,
        name: 'Suite',
        basePrice: 6500,
        maxGuests: 4,
        amenities: ['WiFi', 'AC', 'TV', 'Mini Bar', 'Jacuzzi'],
      },
    }),
  ]);

  for (let i = 101; i <= 110; i++) {
    const cat = i <= 105 ? roomCats[0] : roomCats[1];
    await prisma.room.upsert({
      where: { branchId_roomNumber: { branchId: branch.id, roomNumber: String(i) } },
      update: {},
      create: {
        businessId: business.id,
        branchId: branch.id,
        categoryId: cat.id,
        roomNumber: String(i),
        floor: Math.floor(i / 100),
        status: i <= 103 ? 'OCCUPIED' : i === 104 ? 'CLEANING' : 'AVAILABLE',
      },
    });
  }

  await prisma.employee.upsert({
    where: { businessId_branchId_employeeId: { businessId: business.id, branchId: branch.id, employeeId: 'EMP-001' } },
    update: {},
    create: {
      businessId: business.id,
      branchId: branch.id,
      employeeId: 'EMP-001',
      firstName: 'Amit',
      lastName: 'Kumar',
      department: 'Front Desk',
      designation: 'Receptionist',
      baseSalary: 25000,
      joinDate: new Date('2024-01-15'),
    },
  });

  await prisma.employee.upsert({
    where: { businessId_branchId_employeeId: { businessId: business.id, branchId: branch2.id, employeeId: 'EMP-002' } },
    update: {},
    create: {
      businessId: business.id,
      branchId: branch2.id,
      employeeId: 'EMP-002',
      firstName: 'Priya',
      lastName: 'Sharma',
      department: 'Sales',
      designation: 'Cashier',
      baseSalary: 22000,
      joinDate: new Date('2024-03-01'),
    },
  });

  console.log('Seed complete!');
  console.log('Super Admin: superadmin@nexus.demo / SuperAdmin@123456');
  console.log('Admin: admin@grandplaza.demo / Demo@123456');
  console.log('Cashier: cashier@grandplaza.demo / Demo@123456');
  console.log('Branch ID:', branch.id);
  console.log('Admin user ID:', admin.id);
  console.log('Cash account ID:', cashAccount.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

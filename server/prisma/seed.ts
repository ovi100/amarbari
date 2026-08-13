import bcrypt from 'bcryptjs';
import { IdentityType, IssueCategory, PaymentStatus, PrismaClient, Role, TicketStatus } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+8801700000000';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
const TENANT_PASSWORD = process.env.SEED_TENANT_PASSWORD ?? 'Tenant@12345';

const money = (n: number) => Math.round(n * 100) / 100;

async function main() {
  console.log('Seeding AmarBari…');

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const tenantHash = await bcrypt.hash(TENANT_PASSWORD, 12);

  const admin = await prisma.user.upsert({
    where: { phone: ADMIN_PHONE },
    update: { passwordHash: adminHash, role: Role.ADMIN, isApproved: true, isPhoneVerified: true },
    create: {
      fullName: 'Rahman Property Admin',
      phone: ADMIN_PHONE,
      passwordHash: adminHash,
      role: Role.ADMIN,
      isApproved: true,
      isPhoneVerified: true,
      dob: new Date('1978-04-12'),
      familyMembers: 4,
      identityType: IdentityType.NID,
      identityNumber: '1978041200011',
      village: 'Uttara Sector 7',
      postOffice: 'Uttara Model Town',
      district: 'Dhaka',
      policeStation: 'Uttara West',
      division: 'Dhaka',
    },
  });

  const flatSpecs = [
    { flatNumber: 'A-101', floor: 1, baseRent: 18000 },
    { flatNumber: 'A-102', floor: 1, baseRent: 17500 },
    { flatNumber: 'A-201', floor: 2, baseRent: 21000 },
    { flatNumber: 'A-202', floor: 2, baseRent: 20500 },
    { flatNumber: 'B-301', floor: 3, baseRent: 24000 },
    { flatNumber: 'B-302', floor: 3, baseRent: 23500 },
  ];

  const flats = [];
  for (const spec of flatSpecs) {
    flats.push(
      await prisma.flat.upsert({
        where: { flatNumber: spec.flatNumber },
        update: { baseRent: spec.baseRent },
        create: {
          ...spec,
          building: spec.flatNumber.startsWith('A') ? 'Main Building' : 'Annex Building',
        },
      })
    );
  }

  // Two shops so the commercial side of the portfolio is not empty on a fresh
  // install. Assignment is left to the admin, as it is for flats.
  const shopSpecs = [
    { shopNumber: 'S-01', shopName: 'Rahim General Store', address: '12 Mirpur Road, Dhaka', baseRent: 32000 },
    { shopNumber: 'S-02', shopName: 'Nila Tailors', address: '14 Mirpur Road, Dhaka', baseRent: 26000 },
  ];

  const shops = [];
  for (const spec of shopSpecs) {
    shops.push(
      await prisma.shop.upsert({
        where: { shopNumber: spec.shopNumber },
        update: {},
        create: spec,
      })
    );
  }

  // Electricity meters: one on each occupied flat, one on a shop, and one left
  // in the pool so the assign flow has something to work with on a fresh
  // install. Rates are left null, so each follows its category default.
  const meterSpecs = [
    { meterNumber: 'MTR-1001', meterName: 'A-101 domestic', flat: 'A-101', previous: 4200, current: 4310 },
    { meterNumber: 'MTR-1002', meterName: 'A-201 domestic', flat: 'A-201', previous: 3100, current: 3195 },
    { meterNumber: 'MTR-1003', meterName: 'B-301 domestic', flat: 'B-301', previous: 5600, current: 5742 },
    { meterNumber: 'MTR-2001', meterName: 'S-01 commercial', shop: 'S-01', previous: 8800, current: 9050 },
    { meterNumber: 'MTR-9000', meterName: 'Spare (unallocated)', previous: 0, current: 0 },
  ] as { meterNumber: string; meterName: string; flat?: string; shop?: string; previous: number; current: number }[];

  for (const spec of meterSpecs) {
    const flat = spec.flat ? flats.find((f) => f.flatNumber === spec.flat) : undefined;
    const shop = spec.shop ? shops.find((s) => s.shopNumber === spec.shop) : undefined;
    await prisma.meter.upsert({
      where: { meterNumber: spec.meterNumber },
      update: {},
      create: {
        meterNumber: spec.meterNumber,
        meterName: spec.meterName,
        previousReading: spec.previous,
        currentReading: spec.current,
        ...(flat ? { flatId: flat.id } : {}),
        ...(shop ? { shopId: shop.id } : {}),
      },
    });
  }

  const tenantSpecs = [
    {
      fullName: 'Ayesha Siddika',
      phone: '+8801711111111',
      identityNumber: '1990021800111',
      identityType: IdentityType.NID,
      dob: new Date('1990-02-18'),
      familyMembers: 3,
      village: 'Mirpur DOHS Road 5',
      postOffice: 'Mirpur',
      district: 'Dhaka',
      policeStation: 'Pallabi',
      division: 'Dhaka',
      isApproved: true,
      flatNumber: 'A-101',
      advanceDeposit: 36000,
      monthsBack: 14,
    },
    {
      fullName: 'Tanvir Hasan',
      phone: '+8801722222222',
      identityNumber: 'BM0099231',
      identityType: IdentityType.PASSPORT,
      dob: new Date('1986-11-03'),
      familyMembers: 5,
      village: 'Bashundhara Block C',
      postOffice: 'Bashundhara R/A',
      district: 'Dhaka',
      policeStation: 'Vatara',
      division: 'Dhaka',
      isApproved: true,
      flatNumber: 'A-201',
      // QA matrix 7.2: 500-advance-against-600-bill scenario, scaled to BDT.
      advanceDeposit: 15000,
      monthsBack: 8,
    },
    {
      fullName: 'Nusrat Jahan',
      phone: '+8801733333333',
      identityNumber: '20010725778812901',
      identityType: IdentityType.BIRTH_CERTIFICATE,
      dob: new Date('2001-07-25'),
      familyMembers: 2,
      village: 'Agrabad C/A',
      postOffice: 'Agrabad',
      district: 'Chattogram',
      policeStation: 'Double Mooring',
      division: 'Chattogram',
      isApproved: true,
      flatNumber: 'B-301',
      advanceDeposit: 48000,
      monthsBack: 3,
    },
    {
      // Pending-approval tenant so the admin approval queue is not empty.
      fullName: 'Imran Kabir',
      phone: '+8801744444444',
      identityNumber: '1995010900334',
      identityType: IdentityType.NID,
      dob: new Date('1995-01-09'),
      familyMembers: 1,
      village: 'Zindabazar',
      postOffice: 'Sylhet Sadar',
      district: 'Sylhet',
      policeStation: 'Kotwali',
      division: 'Sylhet',
      isApproved: false,
      flatNumber: null,
      advanceDeposit: 0,
      monthsBack: 0,
    },
  ];

  const now = new Date();

  for (const spec of tenantSpecs) {
    const user = await prisma.user.upsert({
      where: { phone: spec.phone },
      update: { isApproved: spec.isApproved },
      create: {
        fullName: spec.fullName,
        phone: spec.phone,
        passwordHash: tenantHash,
        role: Role.USER,
        isPhoneVerified: true,
        isApproved: spec.isApproved,
        dob: spec.dob,
        familyMembers: spec.familyMembers,
        identityType: spec.identityType,
        identityNumber: spec.identityNumber,
        village: spec.village,
        postOffice: spec.postOffice,
        district: spec.district,
        policeStation: spec.policeStation,
        division: spec.division,
      },
    });

    if (!spec.flatNumber) continue;
    const flat = flats.find((f) => f.flatNumber === spec.flatNumber)!;

    const startDate = new Date(now.getFullYear(), now.getMonth() - spec.monthsBack, 5);
    const existingTenancy = await prisma.tenancy.findUnique({ where: { userId: user.id } });
    if (!existingTenancy) {
      await prisma.tenancy.create({
        data: {
          userId: user.id,
          flatId: flat.id,
          startDate,
          advanceDeposit: spec.advanceDeposit,
        },
      });
      await prisma.flat.update({ where: { id: flat.id }, data: { isOccupied: true } });
    }

    // Historical invoices — most settled, the newest left outstanding.
    for (let back = spec.monthsBack; back >= 0; back--) {
      const cursor = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const month = cursor.getMonth() + 1;
      const year = cursor.getFullYear();

      const already = await prisma.invoice.findUnique({
        where: { flatId_month_year: { flatId: flat.id, month, year } },
      });
      if (already) continue;

      const electricityBill = money(1400 + Math.random() * 1800);
      const waterBill = money(500 + Math.random() * 400);
      const internetBill = 1200;
      const utilityBill = money(800 + Math.random() * 500);
      const totalAmount = money(
        flat.baseRent + electricityBill + waterBill + internetBill + utilityBill
      );

      const settled = back > 0;
      await prisma.invoice.create({
        data: {
          flatId: flat.id,
          month,
          year,
          flatRent: flat.baseRent,
          electricityBill,
          waterBill,
          internetBill,
          utilityBill,
          previousDue: 0,
          totalAmount,
          paidAmount: settled ? totalAmount : 0,
          paymentStatus: settled ? PaymentStatus.PAID : PaymentStatus.DUE,
          paidAt: settled ? new Date(year, month - 1, 8) : null,
          dueDate: new Date(year, month - 1, 10),
        },
      });
    }
  }

  // Operating expenses across the trailing 12 months.
  const expenseCategories = [
    { category: 'Electricity', base: 9000 },
    { category: 'Water Maintenance', base: 3200 },
    { category: 'Internet Trunk', base: 6000 },
    { category: 'Lift & Generator Servicing', base: 4500 },
    { category: 'Cleaning & Security', base: 12000 },
  ];

  const expenseCount = await prisma.buildingExpense.count();
  if (expenseCount === 0) {
    for (let back = 11; back >= 0; back--) {
      const cursor = new Date(now.getFullYear(), now.getMonth() - back, 15);
      for (const spec of expenseCategories) {
        await prisma.buildingExpense.create({
          data: {
            category: spec.category,
            amount: money(spec.base * (0.85 + Math.random() * 0.35)),
            description: `${spec.category} — ${cursor.toISOString().slice(0, 7)}`,
            expenseDate: cursor,
          },
        });
      }
    }
  }

  // Maintenance tickets in a few states.
  const ticketCount = await prisma.maintenanceTicket.count();
  if (ticketCount === 0) {
    const ayesha = await prisma.user.findUnique({
      where: { phone: '+8801711111111' },
      include: { tenancy: true },
    });
    const tanvir = await prisma.user.findUnique({
      where: { phone: '+8801722222222' },
      include: { tenancy: true },
    });

    const ticketSeeds = [
      {
        user: ayesha,
        category: IssueCategory.WATER_LEAKAGE,
        description: 'Water leaking from the bathroom ceiling since last night, floor stays wet.',
        status: TicketStatus.IN_PROGRESS,
      },
      {
        user: ayesha,
        category: IssueCategory.WINDOW_BROKEN,
        description: 'Bedroom window latch is broken and the pane rattles in the wind.',
        status: TicketStatus.RESOLVED,
      },
      {
        user: tanvir,
        category: IssueCategory.ELECTRICITY_PROBLEM,
        description: 'Kitchen circuit trips whenever the oven and kettle run together.',
        status: TicketStatus.PENDING,
      },
      {
        user: tanvir,
        category: IssueCategory.FAUCET_BROKEN,
        description: 'Kitchen sink faucet drips continuously even when fully closed.',
        status: TicketStatus.PENDING,
      },
    ];

    for (const seed of ticketSeeds) {
      if (!seed.user?.tenancy) continue;
      await prisma.maintenanceTicket.create({
        data: {
          userId: seed.user.id,
          flatId: seed.user.tenancy.flatId,
          category: seed.category,
          description: seed.description,
          status: seed.status,
        },
      });
    }
  }

  // A short chat thread so the admin inbox is not empty on first login.
  const messageCount = await prisma.chatMessage.count();
  if (messageCount === 0) {
    const ayesha = await prisma.user.findUnique({ where: { phone: '+8801711111111' } });
    if (ayesha) {
      await prisma.chatMessage.createMany({
        data: [
          {
            senderId: ayesha.id,
            receiverId: admin.id,
            message: 'Assalamu alaikum, when will the plumber come for the ceiling leak?',
          },
          {
            senderId: admin.id,
            receiverId: ayesha.id,
            message: 'Walaikum assalam. The plumber is scheduled for tomorrow between 10am and 12pm.',
          },
        ],
      });
    }
  }

  console.log('\nSeed complete.\n');
  console.log(`  Admin   ${ADMIN_PHONE} / ${ADMIN_PASSWORD}`);
  console.log(`  Tenant  +8801711111111 / ${TENANT_PASSWORD}  (Ayesha, flat A-101)`);
  console.log(`  Tenant  +8801722222222 / ${TENANT_PASSWORD}  (Tanvir, flat A-201)`);
  console.log(`  Tenant  +8801733333333 / ${TENANT_PASSWORD}  (Nusrat, flat B-301)`);
  console.log(`  Pending +8801744444444 / ${TENANT_PASSWORD}  (Imran, awaiting approval)\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

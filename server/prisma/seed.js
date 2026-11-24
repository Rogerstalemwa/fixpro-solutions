import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROLES = [
  'CUSTOMER', 'COMPANY_TECHNICIAN', 'INDEPENDENT_TECHNICIAN', 'OPERATIONS_ADMIN', 'TECHNICAL_SUPERVISOR',
  'FINANCE_ADMIN', 'WORKSHOP_MANAGER', 'LOGISTICS_PERSONNEL', 'CORPORATE_USER', 'SUPER_ADMIN',
];

// Role permissions are seeded now so the permission tables are populated; route guards currently check roles.
const PERMISSIONS = {
  'booking.create': ['CUSTOMER', 'CORPORATE_USER'],
  'booking.read.own': ['CUSTOMER', 'CORPORATE_USER'],
  'booking.read.all': ['OPERATIONS_ADMIN', 'TECHNICAL_SUPERVISOR', 'FINANCE_ADMIN'],
  'job.assign': ['OPERATIONS_ADMIN'],
  'job.update': ['COMPANY_TECHNICIAN', 'INDEPENDENT_TECHNICIAN', 'TECHNICAL_SUPERVISOR'],
  'quotation.create': ['COMPANY_TECHNICIAN', 'INDEPENDENT_TECHNICIAN', 'TECHNICAL_SUPERVISOR'],
  'quotation.approve': ['CUSTOMER', 'CORPORATE_USER'],
  'invoice.manage': ['FINANCE_ADMIN'],
  'refund.approve': ['FINANCE_ADMIN'],
  'catalogue.manage': ['OPERATIONS_ADMIN'],
  'user.manage': ['OPERATIONS_ADMIN'],
  'workshop.manage': ['WORKSHOP_MANAGER'],
  'logistics.manage': ['LOGISTICS_PERSONNEL'],
  'audit.read': ['OPERATIONS_ADMIN', 'FINANCE_ADMIN'],
};

// Categories follow the FixPro service plan. Diagnostic fees sit inside the planned UGX ranges.
// Each entry: [name, diagnosticFee, description]
const CATALOGUE = {
  'Computers and laptops': [
    ['Laptop or desktop troubleshooting', 30000, 'Slow, freezing, overheating or not starting. We find the fault and explain the fix.'],
    ['Screen, keyboard or charging-port repair', 30000, 'Cracked screens, dead keys and loose or broken charging ports.'],
    ['Operating system installation', 30000, 'Clean Windows installation, drivers and your essential software.'],
    ['Data recovery and backup', 40000, 'Recover files from failing drives and set up a backup you can trust.'],
    ['Cleaning and servicing', 25000, 'Dust removal, fresh thermal paste and a full health check.'],
  ],
  'Televisions and home entertainment': [
    ['TV power or display fault diagnosis', 40000, 'No power, no picture, lines or dark screens on LED, LCD and smart TVs.'],
    ['Smart TV troubleshooting', 35000, 'Apps, Wi-Fi, remote and software faults on smart TVs.'],
    ['Sound system and home theatre repair', 35000, 'Crackling, no sound or channel faults on soundbars and speakers.'],
    ['TV installation and mounting', 30000, 'Wall mounting, cable tidying and a full setup.'],
  ],
  'Mobile phones and tablets': [
    ['Screen or battery replacement', 20000, 'Cracked displays and batteries that drain fast or swell.'],
    ['Charging-port repair', 20000, 'Phone not charging, or only at a certain angle.'],
    ['Software troubleshooting', 20000, 'Boot loops, updates gone wrong, storage and app problems.'],
    ['Speaker or microphone repair', 20000, 'Calls that cannot hear you, or sound that is muffled or gone.'],
  ],
  'Household electronic appliances': [
    ['Microwave repair', 25000, 'Not heating, sparking, or a turntable and keypad that stopped working.'],
    ['Washing machine troubleshooting', 35000, 'Not spinning, not draining, leaking or error codes.'],
    ['Refrigerator and freezer diagnostics', 35000, 'Not cooling, frost build-up or strange noises.'],
    ['Small appliance servicing', 20000, 'Blenders, kettles, irons and other everyday appliances.'],
  ],
  'Security and surveillance': [
    ['CCTV installation and maintenance', 40000, 'Cameras fitted, aimed and tested, or an existing system serviced.'],
    ['Camera or DVR/NVR troubleshooting', 35000, 'No image, no recording or remote viewing that stopped working.'],
    ['Video doorbell installation', 30000, 'Mounting, wiring and app setup.'],
  ],
  'Networking and connectivity': [
    ['Router installation and configuration', 25000, 'Set up, secured and tuned for your home or office.'],
    ['Wi-Fi troubleshooting', 25000, 'Dead spots, slow speeds and dropped connections.'],
    ['Home or office network setup', 40000, 'Cabling, access points and devices working together.'],
  ],
  'Power and accessories': [
    ['UPS troubleshooting and servicing', 30000, 'Beeping, short backup time or a UPS that will not switch on.'],
    ['Inverter troubleshooting', 35000, 'No output, overload alarms and battery faults.'],
    ['Charger and adapter repair', 20000, 'Frayed cables, loose plugs and adapters that stopped delivering power.'],
  ],
};

async function main() {
  const roles = {};
  for (const name of ROLES) roles[name] = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });

  for (const [code, roleNames] of Object.entries(PERMISSIONS)) {
    const permission = await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
    for (const roleName of roleNames) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roles[roleName].id, permissionId: permission.id } },
        update: {},
        create: { roleId: roles[roleName].id, permissionId: permission.id },
      });
    }
  }

  for (const [categoryName, services] of Object.entries(CATALOGUE)) {
    const category = await prisma.serviceCategory.upsert({ where: { name: categoryName }, update: {}, create: { name: categoryName } });
    for (const [name, diagnosticFee, description] of services) {
      await prisma.service.upsert({
        where: { categoryId_name: { categoryId: category.id, name } },
        update: { description, diagnosticFee },
        create: { categoryId: category.id, name, description, diagnosticFee, pricingMethod: 'DIAGNOSTIC_THEN_QUOTE' },
      });
    }
  }

  const phone = process.env.ADMIN_PHONE;
  const password = process.env.ADMIN_PASSWORD;
  if (phone && password) {
    const admin = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        fullName: process.env.ADMIN_FULL_NAME || 'FixPro Administrator',
        phone,
        email: process.env.ADMIN_EMAIL || null,
        passwordHash: await bcrypt.hash(password, 12),
        status: 'ACTIVE',
      },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: roles.SUPER_ADMIN.id } },
      update: {},
      create: { userId: admin.id, roleId: roles.SUPER_ADMIN.id },
    });
    console.log(`Super admin ready: ${phone}`);
  }
  // Demo technician for local testing only. Never created in production.
  if (process.env.NODE_ENV !== 'production') {
    const techPhone = '+256700000001';
    const tech = await prisma.user.upsert({
      where: { phone: techPhone },
      update: {},
      create: { fullName: 'Demo Technician', phone: techPhone, passwordHash: await bcrypt.hash('Technician123', 12), status: 'ACTIVE' },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: tech.id, roleId: roles.COMPANY_TECHNICIAN.id } },
      update: {},
      create: { userId: tech.id, roleId: roles.COMPANY_TECHNICIAN.id },
    });
    const technician = await prisma.technician.upsert({
      where: { userId: tech.id },
      update: {},
      create: { userId: tech.id, technicianType: 'COMPANY', verificationStatus: 'VERIFIED', available: true },
    });
    if (!(await prisma.technicianCoverageArea.count({ where: { technicianId: technician.id } }))) {
      await prisma.technicianCoverageArea.createMany({
        data: ['Kampala', 'Wakiso', 'Mukono'].map((district) => ({ technicianId: technician.id, district })),
      });
    }
    const services = await prisma.service.findMany({ select: { id: true } });
    await prisma.technicianSpecialisation.createMany({
      data: services.map((s) => ({ technicianId: technician.id, serviceId: s.id })),
      skipDuplicates: true,
    });
    console.log(`Demo technician ready: ${techPhone} / Technician123`);
  }
  console.log('Seed complete.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

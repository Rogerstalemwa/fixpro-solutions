import { prisma } from './prisma.js';
import { isServedDistrict } from '../config.js';
import { ApiError } from './http.js';

export const FULFILMENT = {
  DOORSTEP: ['Doorstep repair', 'A technician comes to your home or office.'],
  WORKSHOP: ['Workshop repair', 'You bring the device to our workshop.'],
  COLLECTION_DELIVERY: ['Collection and delivery', 'We collect the device, repair it in the workshop and bring it back.'],
};

// Which fulfilment methods can be offered for this service and place (requirements 4.6).
// Unavailable methods carry a plain explanation and the methods that can be used instead.
export async function fulfilmentOptions(serviceId, district) {
  const service = await prisma.service.findFirst({ where: { id: serviceId, active: true }, select: { name: true, allowedFulfilment: true } });
  if (!service) throw new ApiError(404, 'Service not found');
  const served = district ? isServedDistrict(district) : true;
  const [technicians, workshops] = await Promise.all([
    district && served
      ? prisma.technician.count({ where: { verificationStatus: 'VERIFIED', user: { status: 'ACTIVE' }, coverageAreas: { some: { active: true, district: { equals: district, mode: 'insensitive' } } }, specialisations: { some: { serviceId } } } })
      : 0,
    prisma.workshop.count({ where: { status: 'ACTIVE' } }),
  ]);
  const unserved = `We do not serve ${district} yet.`;
  const state = {
    DOORSTEP: !district ? null : !served ? unserved : technicians === 0 ? `No technician currently covers ${district} for this service.` : null,
    WORKSHOP: workshops === 0 ? 'No workshop is open yet.' : null,
    COLLECTION_DELIVERY: !served ? unserved : workshops === 0 ? 'No workshop is open yet.' : null,
  };
  const options = Object.entries(FULFILMENT).map(([method, [label, description]]) => {
    const allowed = service.allowedFulfilment.includes(method);
    const reason = !allowed ? `${service.name} is not offered as ${label.toLowerCase()}.` : state[method];
    return { method, label, description, available: !reason, reason: reason || null };
  });
  const open = options.filter((o) => o.available).map((o) => o.method);
  return options.map((o) => ({ ...o, alternatives: o.available ? [] : open }));
}

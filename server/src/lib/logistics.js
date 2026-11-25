import { newRef } from './billing.js';

export const addressText = (a) => [a.landmark, a.street, a.area, a.town, a.district].filter(Boolean).join(', ');
export const workshopText = (w) => [w.name, w.address, w.district].filter(Boolean).join(', ');
export const deviceText = (d) => [d.brand, d.model, d.category].filter(Boolean).join(' ');

// Custody record: every transfer of the device is kept (requirements 8.3). Never updated or deleted.
export const recordMovement = (tx, m) =>
  tx.equipmentMovement.create({
    data: {
      jobId: m.jobId, movementReference: newRef('MOV'), movementType: m.type,
      fromLocation: m.from, toLocation: m.to,
      releasingPersonId: m.releasingId, releasingName: m.releasingName,
      receivingPersonId: m.receivingId, receivingName: m.receivingName,
      conditionBefore: m.conditionBefore, conditionAfter: m.conditionAfter, accessories: m.accessories,
      acknowledgedBy: m.acknowledgedBy, acknowledgedAt: m.acknowledgedBy ? new Date() : null,
    },
  });

// job must include booking { address, device, contactName, contactPhone, preferredDate, preferredTime, customer { user } }.
export function createOrder(tx, { job, workshop, orderType, transportCharge = 0, instructions, condition, accessories }) {
  const { booking } = job;
  const customerPlace = addressText(booking.address);
  const workshopPlace = workshopText(workshop);
  const preferred = [booking.preferredDate ? new Date(booking.preferredDate).toISOString().slice(0, 10) : '', booking.preferredTime || ''].join(' ').trim();
  return tx.collectionDeliveryOrder.create({
    data: {
      jobId: job.id, orderType, reference: newRef(orderType === 'COLLECTION' ? 'COL' : 'DEL'),
      pickupAddress: orderType === 'COLLECTION' ? customerPlace : workshopPlace,
      destinationAddress: orderType === 'COLLECTION' ? workshopPlace : customerPlace,
      contactName: booking.contactName ?? booking.customer.user.fullName,
      contactPhone: booking.contactPhone ?? booking.customer.user.phone,
      preferredTime: orderType === 'COLLECTION' ? preferred || null : null,
      equipmentDescription: deviceText(booking.device),
      instructions, transportCharge,
      // For a delivery these hold the condition and accessories recorded at release.
      conditionRecorded: condition, accessories,
    },
  });
}

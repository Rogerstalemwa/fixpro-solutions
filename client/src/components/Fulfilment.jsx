import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatDateTime, statusLabel, ugx } from '../lib/format.js';

const MOVE = {
  COLLECTED_FROM_CUSTOMER: 'Collected from you', WORKSHOP_RECEIPT: 'Received at the workshop', DISPATCHED_FOR_DELIVERY: 'Left the workshop for delivery',
  DELIVERED_TO_CUSTOMER: 'Delivered to you', CUSTOMER_COLLECTION: 'Collected by you', RETURNED_TO_WORKSHOP: 'Returned to the workshop',
};

// Where the device is, who has it and how it is getting back: the customer's view of workshop repair, collection and delivery.
export default function Fulfilment({ bookingId, Panel }) {
  const [d, setD] = useState(undefined);
  useEffect(() => { api(`/bookings/${bookingId}/fulfilment`).then((r) => setD(r.data)).catch(() => setD(null)); }, [bookingId]);
  if (!d) return null;
  const orders = d.orders;
  return (
    <Panel title={d.method === 'WORKSHOP' ? 'Workshop repair' : 'Workshop, collection and delivery'}>
      {d.workshop && (
        <div className="text-sm">
          <p className="font-semibold">{d.workshop.name}</p>
          <p className="text-mist">{[d.workshop.address, d.workshop.district].filter(Boolean).join(', ')}</p>
          {d.workshop.operatingHours && <p className="text-mist">Open {d.workshop.operatingHours}</p>}
          {d.workshop.contactPhone && <p className="text-mist">Phone <a className="underline" href={`tel:${d.workshop.contactPhone}`}>{d.workshop.contactPhone}</a></p>}
          {d.method === 'WORKSHOP' && !d.received && <p className="mt-2">Bring your device here and quote your booking reference.</p>}
        </div>
      )}
      {orders.length > 0 && (
        <ul className="mt-4 space-y-3">
          {orders.map((o) => (
            <li key={o.reference} className="rounded-2xl border border-white/10 p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold">{o.orderType === 'COLLECTION' ? 'Collection' : 'Delivery'} · {statusLabel(o.status)}</p>
                <p className="text-mist">{o.reference}</p>
              </div>
              <p className="mt-1 text-mist">{o.pickupAddress} to {o.destinationAddress}</p>
              {(o.scheduledAt || o.preferredTime) && <p className="text-mist">{o.scheduledAt ? `Planned ${formatDateTime(o.scheduledAt)}` : `You asked for ${o.preferredTime}`}</p>}
              {o.person && <p>Handled by {o.person.fullName}, <a className="underline" href={`tel:${o.person.phone}`}>{o.person.phone}</a></p>}
              {o.transportCharge > 0 && <p className="text-mist">Transport charge {ugx(o.transportCharge)}</p>}
              {o.attempts.map((a, i) => <p key={i} className="mt-1 text-mist">Problem: {a.reason.replaceAll('_', ' ').toLowerCase()}. {a.explanation}</p>)}
            </li>
          ))}
        </ul>
      )}
      {d.received && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">Condition when received</p>
          <p className="text-mist">{d.received.receivedCondition}{d.received.existingDamage ? `. Existing damage: ${d.received.existingDamage}` : ''}. Accessories: {d.received.accessoriesReceived}.</p>
        </div>
      )}
      {d.custody.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold">Where your device has been</p>
          <ol className="mt-3 space-y-3 border-l border-white/15 pl-4">
            {d.custody.map((m, i) => (
              <li key={i} className="text-sm">
                <p className="font-medium">{MOVE[m.movementType] || statusLabel(m.movementType)}</p>
                <p className="text-mist">{m.fromLocation} to {m.toLocation} · {formatDateTime(m.createdAt)}</p>
                <p className="text-mist">{m.releasingName} handed over to {m.receivingName}{m.acknowledgedBy ? `, acknowledged by ${m.acknowledgedBy}` : ''}</p>
                {(m.conditionBefore || m.accessories) && <p className="text-mist">{[m.conditionBefore && `Condition: ${m.conditionBefore}`, m.accessories && `Accessories: ${m.accessories}`].filter(Boolean).join('. ')}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import MiniForm from '../components/MiniForm.jsx';
import { Reveal } from '../lib/motion.jsx';
import { formatDateTime, statusLabel, ugx } from '../lib/format.js';

const REASONS = [
  ['CUSTOMER_UNAVAILABLE', 'Customer unavailable'], ['INCORRECT_ADDRESS', 'Incorrect address'], ['TRANSPORT_DELAY', 'Transport delay'],
  ['CUSTOMER_RESCHEDULED', 'Customer asked to reschedule'], ['DELIVERY_FAILED', 'Delivery failed'], ['RETURNED_TO_WORKSHOP', 'Returned to the workshop'],
];

function OrderCard({ o, onDone }) {
  const [panel, setPanel] = useState(null); // 'confirm' | 'fail'
  const [error, setError] = useState('');
  const delivery = o.orderType === 'DELIVERY';
  const ref = o.job.booking.reference;

  return (
    <Reveal as="li" className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-bold tracking-tight">{delivery ? 'Delivery' : 'Collection'} · {ref}</p>
          <p className="mt-1 text-sm text-mist">{o.equipmentDescription}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">{statusLabel(o.status)}</span>
      </div>
      <dl className="mt-4 space-y-1 text-sm">
        <div><dt className="inline text-mist">From: </dt><dd className="inline">{o.pickupAddress}</dd></div>
        <div><dt className="inline text-mist">To: </dt><dd className="inline">{o.destinationAddress}</dd></div>
        <div><dt className="inline text-mist">Contact: </dt><dd className="inline">{o.contactName}, <a className="underline" href={`tel:${o.contactPhone}`}>{o.contactPhone}</a></dd></div>
        {(o.scheduledAt || o.preferredTime) && <div><dt className="inline text-mist">When: </dt><dd className="inline">{o.scheduledAt ? formatDateTime(o.scheduledAt) : o.preferredTime}</dd></div>}
        {o.instructions && <div><dt className="inline text-mist">Instructions: </dt><dd className="inline">{o.instructions}</dd></div>}
        {Number(o.transportCharge) > 0 && <div><dt className="inline text-mist">Transport charge: </dt><dd className="inline">{ugx(o.transportCharge)}</dd></div>}
        {delivery && o.conditionRecorded && <div><dt className="inline text-mist">Condition at dispatch: </dt><dd className="inline">{o.conditionRecorded}. Accessories: {o.accessories}</dd></div>}
      </dl>
      {o.attempts?.[0] && <p className="mt-3 text-sm text-mist">Earlier problem: {o.attempts[0].reason.replaceAll('_', ' ').toLowerCase()}. {o.attempts[0].explanation}</p>}

      <div className="mt-5 flex flex-wrap gap-3">
        {o.status === 'ASSIGNED' && (
          <>
            <button className="btn-primary" onClick={() => api(`/logistics/orders/${o.id}/start`, { method: 'POST', body: {} }).then(onDone).catch((e) => setError(e.message))}>{delivery ? 'Start delivery' : 'I am on the way'}</button>
            <button className="btn-ghost" onClick={() => setPanel(panel === 'fail' ? null : 'fail')}>Report a problem</button>
          </>
        )}
        {o.status === 'EN_ROUTE' && (
          <>
            <button className="btn-primary" onClick={() => setPanel(panel === 'confirm' ? null : 'confirm')}>{delivery ? 'Confirm delivery' : 'Confirm collection'}</button>
            <button className="btn-ghost" onClick={() => setPanel(panel === 'fail' ? null : 'fail')}>Report a problem</button>
          </>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}

      {panel === 'confirm' && (
        <div className="mt-4">
          <MiniForm
            multipart submitLabel={delivery ? 'Confirm delivery' : 'Confirm collection'}
            fields={[
              { name: 'jobReference', label: 'Job reference', type: 'text', hint: `Ask the customer for it. It starts with ${ref.slice(0, 8)}…` },
              { name: 'condition', label: delivery ? 'Condition on delivery' : 'Condition of the device', type: 'textarea' },
              { name: 'accessories', label: 'Accessories', type: 'text', hint: 'Write None if there are none' },
              { name: 'photos', label: 'Photographs', type: 'file', max: 4 },
              { name: 'acknowledgedBy', label: 'Name of the person who signed', type: 'text' },
              { name: 'acknowledged', label: 'Customer acknowledgement', type: 'checkbox', checkLabel: 'The customer has acknowledged and agreed' },
            ]}
            onSubmit={(body) => api(`/logistics/orders/${o.id}/confirm`, { method: 'POST', body }).then(onDone)}
          />
        </div>
      )}
      {panel === 'fail' && (
        <div className="mt-4">
          <MiniForm
            submitLabel="Record problem"
            fields={[
              { name: 'reason', label: 'What happened', type: 'select', options: REASONS },
              { name: 'explanation', label: 'Explanation', type: 'textarea' },
              { name: 'followUp', label: 'Follow-up action', type: 'select', options: [['RESCHEDULE', 'Reschedule'], ...(delivery ? [['RETURN_TO_WORKSHOP', 'Return the device to the workshop']] : []), ['OPS_REVIEW', 'Ask Operations to decide']] },
              { name: 'rescheduleFor', label: 'New date and time', type: 'datetime', show: (v) => v.followUp === 'RESCHEDULE' },
            ]}
            onSubmit={(body) => api(`/logistics/orders/${o.id}/fail`, { method: 'POST', body }).then(() => { setPanel(null); onDone(); })}
          />
        </div>
      )}
    </Reveal>
  );
}

export default function Logistics() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { api('/logistics/orders').then((r) => { setOrders(r.data); setError(''); }).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 45000); return () => clearInterval(t); }, [load]);
  return (
    <section className="mx-auto max-w-4xl px-5 pb-10 pt-16 sm:px-8 sm:pt-24">
      <h1 className="giant-md">Collections and deliveries</h1>
      {error && <p className="mt-6 text-danger" role="alert">{error}</p>}
      {orders && !orders.length && <p className="mt-10 text-mist">Nothing is assigned to you right now. New trips appear here.</p>}
      <ul className="mt-10 space-y-4">{orders?.map((o) => <OrderCard key={o.id} o={o} onDone={load} />)}</ul>
    </section>
  );
}

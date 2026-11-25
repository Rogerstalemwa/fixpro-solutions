import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Policy pages (requirements 4.1, item 15). Plain-language documents based on how FixPro works.
const DOCS = {
  terms: {
    title: 'Terms of service',
    sections: [
      ['Who we are', 'FixPro Solutions arranges electronics repair in Kampala, Wakiso and Mukono. Repairs are done by FixPro technicians and by independent technicians we have verified.'],
      ['Booking and quotation', 'You book a service and describe the fault. A technician inspects the device and sends a written quotation. No chargeable repair starts until you approve the quotation. If more faults are found, the technician must send a revised quotation and you must approve it again.'],
      ['Diagnostic fee', 'Each service has a diagnostic fee, shown when you choose the service and again in your quotation. It is charged for the inspection even if you decline the repair.'],
      ['Payment', 'Pay the invoice shown on your dashboard. Payments are recorded against your invoice. You receive a notification when a payment is received.'],
      ['Your device and data', 'Please back up your data before a repair. Technicians may need to restart or reset a device to test it. We record the condition and accessories of your device when it changes hands.'],
      ['Cancelling', 'You can cancel a request before the technician starts work. The diagnostic fee applies once an inspection has taken place.'],
      ['Complaints', 'If something goes wrong, contact us. We record every complaint, assign it to a person, and tell you the outcome.'],
      ['Changes and law', 'We may update these terms, and the latest version is always on this page. They are governed by the laws of Uganda.'],
    ],
  },
  privacy: {
    title: 'Privacy policy',
    sections: [
      ['What we collect', 'For customers: name, phone number, email, addresses, devices you register, photos you upload, and your booking and payment history. For technicians: the same contact details, plus National ID number, ID photo, date of birth, qualifications, referees and next of kin, so we can verify who they are.'],
      ['Why we collect it', 'To book and carry out repairs, to contact you, to take payment, to keep customers and technicians safe, and to meet legal and accounting duties.'],
      ['Who sees it', 'A technician sees your exact address and phone number only after they accept your job. Customers see a technician\'s name, photo, phone number and verification status after the technician accepts. National ID numbers and ID photos are seen only by authorised FixPro staff, and each time one is opened it is recorded.'],
      ['How we protect it', 'National ID numbers are stored encrypted. Private photos and documents are not public and are opened only by people allowed to see them. Our staff actions are recorded in an audit log.'],
      ['Your rights', 'Under the Data Protection and Privacy Act, 2019 of Uganda you can ask to see, correct or delete your personal data, and to object to its use. Contact us using the details on this website.'],
      ['Keeping data', 'We keep records for as long as needed to provide the service, handle warranties and complaints, and meet legal and accounting requirements.'],
    ],
  },
  warranty: {
    title: 'Warranty policy',
    sections: [
      ['Warranty depends on the repair', 'We do not give every repair the same warranty. The length of cover depends on the service and repair type. The warranty that applies to your repair is shown on your quotation, and on your dashboard once the repair is complete.'],
      ['What is covered', 'The repaired fault and any parts we replaced, for the period shown on your warranty.'],
      ['What is not covered', 'Physical damage, liquid damage, power surges, tampering or repair by others, wear and tear, and a different fault from the one we repaired. The exclusions for your repair are shown with your warranty.'],
      ['Making a claim', 'Contact us with your booking reference and a description of the problem. We check that your warranty is valid, may ask for photos, inspect the device, and tell you whether the claim is approved and what we will do.'],
    ],
  },
  refunds: {
    title: 'Refund policy',
    sections: [
      ['When refunds apply', 'If we charged you in error, a repair was not carried out, or we agree that a charge should be returned, you can be refunded in full or in part.'],
      ['How a refund is approved', 'Every refund needs a reason, is linked to the payment it relates to, and is approved by an authorised FixPro administrator. We record the amount, the approver and the transaction reference.'],
      ['How you are paid back', 'Refunds are returned using the payment method you paid with where possible. We tell you the amount and expected timing when the refund is approved.'],
      ['Diagnostic fee', 'The diagnostic fee covers the inspection and is not normally refunded once an inspection has been carried out.'],
    ],
  },
};

export default function Legal() {
  const { doc } = useParams();
  const page = DOCS[doc];
  const [contact, setContact] = useState(null);
  useEffect(() => { api('/public/config').then(({ data }) => setContact(data.contact)).catch(() => {}); }, []);
  if (!page) return <section className="mx-auto max-w-3xl px-5 py-20"><h1 className="giant-md">Not found</h1><Link to="/" className="btn-primary mt-8">Go home</Link></section>;
  return (
    <section className="mx-auto max-w-3xl px-5 pb-10 pt-14 sm:px-8">
      <h1 className="giant-md !text-[clamp(2.4rem,6vw,4.5rem)]">{page.title}</h1>
      <div className="mt-12 space-y-9">
        {page.sections.map(([heading, text]) => (
          <div key={heading}><h2 className="font-display text-xl font-bold">{heading}</h2><p className="mt-2 leading-relaxed text-mist">{text}</p></div>
        ))}
      </div>
      {(contact?.phone || contact?.email) && <p className="mt-12 text-sm text-mist">Questions? {[contact.phone, contact.email].filter(Boolean).join(' · ')}</p>}
      <nav className="mt-12 flex flex-wrap gap-3 border-t border-white/10 pt-8 text-sm" aria-label="Policies">
        {Object.entries(DOCS).map(([key, d]) => <Link key={key} to={`/legal/${key}`} className={key === doc ? 'font-semibold text-accent' : 'text-mist hover:text-white'}>{d.title}</Link>)}
      </nav>
    </section>
  );
}

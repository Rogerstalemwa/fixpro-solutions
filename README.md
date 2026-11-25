# FixPro Solutions

On-demand electronics repair platform for Uganda. Customers book online and a verified technician comes to their door (or the device goes to a workshop). This is the clean project foundation (milestones 1 to 3: booking, dispatch, technician onboarding, inspection and quotations, payments, and a full customer dashboard).

**Stack:** React + Vite + Tailwind CSS · Node.js + Express · PostgreSQL + Prisma · REST API v1

```
fixpro-solutions/
├── docker-compose.yml     PostgreSQL 16 for local development
├── server/                Express API, Prisma schema, seed script
│   ├── prisma/schema.prisma   Full schema from the Database Schema and API Specification
│   └── src/modules/           auth · catalogue · customers · bookings · admin
└── client/                React + Vite + Tailwind web app
```

## Run it locally

You need Node.js 20+ and Docker (or any PostgreSQL 14+ server).

```bash
# 1. Database
docker compose up -d

# 2. API
cd server
cp .env.example .env          # then set real JWT secrets and your own NIN_ENCRYPTION_KEY
npm install
npx prisma migrate dev --name init   # on an existing database use a new name, e.g. technician_kyc_quotes_payments
npm run db:seed               # roles, permissions, service catalogue, first super admin
npm run dev                   # http://localhost:5001/api/v1

# 3. Web app (new terminal)
cd client
npm install
npm run dev                   # http://localhost:5173
```

Sign in as the seeded super admin with `ADMIN_PHONE` and `ADMIN_PASSWORD` from `server/.env`. Change them before any real use.

## What works in this milestone

| Area | Endpoints / pages |
|---|---|
| Authentication | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Service catalogue | `GET /service-categories`, `/services`, `/services/:id`, `/service-areas`, `POST /service-availability/check` |
| Customer | `GET/PATCH /customers/me`, devices and addresses (list, add, update, archive) |
| Bookings | `POST /bookings`, `GET /bookings`, `GET/PATCH /bookings/:id`, `POST /bookings/:id/cancel`, `/history`, `/tracking` |
| Admin | `GET /admin/dashboard`, `/admin/users`, `PATCH /admin/users/:id/status`, `/admin/bookings`, `/admin/jobs`, catalogue create and update |
| Dispatch | `GET /admin/dispatch/queue`, `/admin/dispatch/candidates/:jobId`, `POST /admin/jobs/:id/assign`, `/admin/jobs/:id/reassign` |
| Technicians | `GET/PATCH /technicians/me`, `/technicians/me/availability`, `/technicians/me/jobs`, `POST /technician/jobs/:id/accept` and `/decline`, admin `GET/POST /admin/technicians`, `PATCH /admin/technicians/:id/verify` |
| Job progress | `POST /jobs/:id/status` with enforced workflow rules |
| Web app | Animated home and services pages, sign up and sign in, customer dashboard, booking form, operations dashboard with dispatch queue, technician job screen |

Behaviour that follows the specification:

- Customers can only read and change their own records (BR-001). Out-of-scope records return 404.
- A booking, its first job, status history, notification and audit record are written in one database transaction.
- Bookings are accepted only for covered districts (`SERVICE_DISTRICTS`, default Kampala, Wakiso, Mukono).
- Responses use the standard `{ success, message, data }` shape, with pagination and per-field validation errors (Zod).
- Passwords are hashed with bcrypt. Sessions use a 15-minute access token and a 7-day httpOnly refresh cookie.
- Money columns are `DECIMAL(18,2)` in UGX; timestamps are `TIMESTAMPTZ`.

## Port

The API runs on **5001** (set `PORT` in `server/.env`). The web app proxies `/api` and `/uploads` to it, see `client/vite.config.js`.

## Technician registration and verification

- Applicants register at `/register/technician`. Required: full name, phone, **National ID Number (NIN)**, date of birth (18+), profile photo, photo of the National ID, home address, next of kin (name and phone), experience, areas covered and services offered.
- The NIN is stored **encrypted** (AES-256-GCM, key in `NIN_ENCRYPTION_KEY`) with a keyed hash to block duplicates and the last 4 digits for display. It is never returned by any list endpoint.
- ID photos are stored in `server/uploads/private`, are never served statically, and are opened only by Operations through an authenticated, audited endpoint. Profile photos go to `server/uploads/photos` and are public.
- Operations reviews applications on the **Operations** page: view the ID photo, reveal the full NIN (audited), then verify or reject. A technician cannot be verified without a NIN, photo and ID document, and cannot go available until verified.
- Back up `server/uploads/` and keep `NIN_ENCRYPTION_KEY` safe. Losing the key makes stored NINs unrecoverable.

## Light and dark mode

The sun or moon button in the navigation switches between light and dark. The first visit follows the device setting, and the choice is remembered. All colours come from theme variables in `client/src/index.css`, so a new page works in both modes without extra code.

## Signed-in name, menu and notification badges

Signed-in users see a human icon and their first name in the navigation. The menu shows their name, phone and role, a link to their dashboard, and Sign out. The dashboard link (My bookings, My jobs or Operations) shows a badge with the number of unread updates, and for technicians the number of job offers waiting. Opening the dashboard marks the updates as seen.

## Reviewing technician applications

Operations opens **Technicians** on the Operations page, filters by Pending, Verified, Rejected or Suspended, searches by name or phone, and opens **View details**. The detail page shows contact and account, identity (masked NIN, date of birth, ID photo), home and next of kin, experience, services and areas, work record, a verification checklist and the history. Verify, Reject and Suspend are on that page. Revealing the NIN or opening the ID photo is audited.

## Customer dashboard

Customers see summary cards (requests, pending, active, completed, total spent, still to pay), tabs for Pending, Accepted and active, Completed and Cancelled, and a card per request with a progress tracker, the assigned technician's photo, name and phone (shown after they accept), the appointment time, and the quote or invoice. Each request opens a detail page with the technician's full profile (photo, phone, verified badge, jobs completed, areas and skills), schedule, inspection findings, quotation (approve, ask for changes, or decline), service report, invoice, payments and a timeline.

## Repair lifecycle (what is built)

Booking, dispatch, technician accepts, appointment confirmed (date and time window), on the way, inspection report, quotation (diagnostic fee added automatically, totals calculated on the server), customer approves, repair, service report, ready for handover (invoice created), payment recorded by Operations or Finance, job completed. Declining a quotation closes the job and invoices only the diagnostic fee.

Payments are recorded by staff (cash, mobile money reference or bank transfer). Mobile-money gateway integration with callback verification is the next finance step.

## Try the full flow

1. Sign up as a customer, then **Book a repair** (the services page opens a price panel once you choose a service).
2. Sign in as the super admin, open **Operations**, and use **Assign technician** in the dispatch queue.
3. Sign in as the demo technician (`+256700000001` / `Technician123`, created by the seed in development only) and **Accept job**, confirm the appointment, go on the way, submit the inspection and send a quotation.
4. As the customer, open the request from the dashboard and approve the quotation. As the technician, start the repair, submit the service report and mark it ready for handover.
5. As the admin, record the payment under **Payments to record**. The job completes and the customer's dashboard shows the money spent.

Dispatch only offers a job to technicians who are verified, available, cover the booking's district and are trained for the service. A customer's exact address and phone number are shown to the technician only after they accept.

## Workshop repair, collection and delivery (requirements sections 8 and 9)

For customers who chose **Workshop repair** or **Collection and delivery**:

1. Operations **approves the booking** under *Bookings to review* (this screen was missing and is now in Operations). With `AUTO_APPROVE_BOOKINGS=false`, which is the default, nothing reaches dispatch until a booking is approved.
2. In the dispatch queue, Operations clicks **Send to workshop** and picks a workshop. For collection and delivery, a collection order is created with an optional transport charge.
3. Operations assigns a **collection person** (Operations screen, *Collection and delivery*). The person starts the trip and confirms the collection with the job reference, condition, accessories, photos and the customer's acknowledgement. A failed visit is recorded with a reason and a follow-up (reschedule, return, or ask Operations).
4. The **workshop manager** (`/workshop`) records reception (condition, damage, accessories, photos), assigns a company technician, logs repair activity and part requests, and requests quality inspection. A failed inspection returns the device to repair. Only Operations can waive a quality check.
5. The technician diagnoses and quotes as usual. After approval they start the workshop repair and submit the service report.
6. After the quality check passes, the invoice is issued. The manager **releases** the device: handed to the customer (walk-in), or a delivery order is created. Release needs full payment unless Operations waives it with a reason.
7. The delivery person confirms delivery with the customer's acknowledgement, and the job completes.

Every transfer is kept as a custody record (who, from where, to where, condition, accessories, who acknowledged). Customers see the workshop, the people involved, the orders and the custody history on their booking page.

Demo accounts (development only, created by `npm run db:seed`):

| Role | Phone | Password |
|---|---|---|
| Workshop manager | `+256700000002` | `Manager123` |
| Delivery rider | `+256700000003` | `Logistics123` |

After pulling this version, run `npx prisma migrate dev --name workshop_logistics` and `npm run db:seed`.

## Decisions to review

- **Customer accounts are active on sign-up.** There is no phone or email verification yet. Add OTP before launch.
- **Password reset returns 501** until an SMS or email provider is connected.
- **Roles are enforced in the routes.** The permission tables are seeded, but fine-grained permission checks come with the modules that need them.
- **Booking references** look like `FPS-2026-4K7Q2M`.

## Next modules (workshop and logistics are done)

12 Online payments (mobile money) → 15 Inventory (spare parts requests already notify Operations) → 16 Warranties → 17 Corporate → 18 Reporting. The schema already contains the tables for all of them.

Before payments go live, add payment-callback verification and idempotency (specification section 6.2), and restrict database grants on `audit_logs`.

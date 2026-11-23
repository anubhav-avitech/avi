# Avitech Inventory System

Server-rendered internal inventory and asset management system built with Node.js, Express, EJS and MySQL.

## Access model

The system has two application roles. Inventory access is company-wide; there
is no department tracking or department-based scoping.

### Administrator
- Manage users and review the Activity & History page for inventory, administrative, and system events.
- View inventory, edit and retire items, and return assigned equipment.
- Create, edit and permanently delete user accounts. Assignment, transaction and audit history is retained when a user is deleted.

### Inventory User
- Can view, add, edit and retire inventory, issue stock to employees, record consumable consumption, and return assigned equipment according to assigned permissions.
- New accounts are always created as Inventory Users; only an existing administrator account can retain the Administrator role.

Employee recipients are separate non-login records, not application accounts. There is no Employee, Inventory Manager or Department Head application role.

## Security model

Authentication and authorization remain enforced on protected routes. User roles and
permissions continue to control access; removing departments does not remove login,
administrator checks, or security middleware.

The application also uses:
- MySQL parameterized queries.
- MySQL transactions for assignment, consumption, returns, adjustments, and disposal.
- HTTP-only, SameSite session cookies.
- CSRF protection.
- Helmet security headers.
- Login rate limiting.
- Password hashing with bcrypt.
- Retire/deactivate semantics instead of destructive deletion where history matters.
- Audit logs and inventory transaction history.

## Inventory model

`ASSET` is intended for returnable equipment such as test tubes, thermometers,
monitors and other reusable items. Full or partial returns increase available
central stock and reduce the employee's outstanding balance.

`CONSUMABLE` is intended for quantity-based stock such as chemicals, gloves,
masks and stationery. Assignment deducts central stock. Recording consumption
reduces only the employee's current balance; it never deducts central stock a
second time. Units include Piece, Bottle, Box, Pair, Pack, Kg, Gram, Liter, ml,
Kit and Set.

Products can have multiple batch/stock records and a configurable minimum stock
threshold. Stock totals are displayed separately by unit.

### Chemical receiving and issuing register fields

The lab workflow follows a vendor receiving register and a stock issue register. For chemical stock, the application now captures the receiving details that were previously written manually in the register:

- Sr. no. / internal record ID (generated automatically; no manual stock-code entry)
- Date of receiving
- Vendor name
- Bill no.
- Make / grade
- Batch no.
- Quantity received from vendor
- Received by
- Mfg.

The issue tracking keeps the operational information from the issue register:

- Chemical code
- Expiry date on issuing
- Quantity issued
- Issued by
- Issued to
- Batch no.
- Issued date
- Expiry date after receiving
- Balance left after issuing

### Laboratory chemicals

- Record chemicals as **Liquid** or **Powder** and track each batch and container size as its own stock line.
- Liquid containers use ml or L; powder containers use g or kg. Stock and issue quantities are whole bottles/containers, with the equivalent volume or weight shown alongside.
- Batch number, expiry date, manufacturer and storage location are recorded. When adding another stock line, select a saved batch to reuse its name, batch number, manufacturer and expiry date without retyping them.
- Add the received quantity in one entry or add more to the same batch/container line later. A different container size uses another line with the same saved batch.
- After any stock from a chemical line is issued, its batch, expiry and package-size details are locked to preserve traceability.
- Issuing containers automatically deducts them from the balance. Each issue records who issued it, who received it, when, its batch/expiry/package details and the balance afterwards.
- Chemicals are consumables: consumption can be recorded against each employee issue, but chemical returns are not permitted.
- Expiry dates and batches are visible in inventory and issue records for traceability.
- Inventory provides one printable batch receiving confirmation per batch number, branded for AVITECH NUTRITION PVT. LTD. and listing all chemical stock lines with that batch number. It includes company and vendor acknowledgment signature fields; use the browser's print dialog to print or save it as a PDF.

## Setup

1. Install Node.js 20+ and MySQL 8+.
2. Configure `.env` with MySQL credentials and a strong `SESSION_SECRET`.
3. For a fresh database, run:
   ```bash
   mysql -u root -p < database/schema.sql
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Create/reset the administrator:
   ```bash
   node database/seed-admin.js
   ```
6. Start:
   ```bash
   npm run dev
   ```
7. Open `http://localhost:3000/login`.

Default development administrator values are taken from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, falling back to `admin@company.local` / `ChangeMe123!` if they are not set. Change them before real use.

## Important database note

`database/schema.sql` is a fresh-schema script and drops the application tables before recreating them. Back up existing data before running it against a database that contains information you need to keep.

For an existing installation using the previous department-based schema, back up the database and run the one-time migration:

```bash
mysql -u root -p < database/migrate-inventory-overview.sql
```

This migration preserves existing inventory, users, employees, assignments, and
transactions; creates product records from the existing inventory names, types,
and units; links past assignment/return transactions to their assignments; adds
consumption and stock movement ledger actions; and removes department columns
and department scoping. Newly added product minimum-stock thresholds default to
zero and can be configured from each product's inventory edit form.

For an existing installation, add the Activity & History filtering indexes
without changing existing records:

```bash
mysql -u root -p < database/migrate-activity-history-indexes.sql
```

For an existing installation already using the inventory overview schema, back
up the database and then run the master-data migration:

```bash
mysql -u root -p < database/migrate-chemical-vendor-masters.sql
```

This creates the administrator-managed chemical and vendor masters, backfills
existing inventory references, and sets legacy vendor contact/address values
to `Not provided` where those details were not previously stored.

For an existing installation, add Glassware and Equipment & Instruments
masters and their inventory relationships with the non-destructive migration:

```bash
mysql -u root -p < database/migrate-glassware-equipment-masters.sql
```

The migration can be rerun safely. Glassware and Equipment masters store names
only, like Chemical Master. Enter units, stock thresholds, and glassware or
equipment specifications when adding the inventory record. Existing master
specifications are copied to linked inventory records, and duplicate master
names are consolidated while preserving their inventory links. Quantities and
transaction history are unchanged. Fresh databases receive these tables and
inventory fields from `schema.sql`.

Do not run `database/schema.sql` on an existing database whose data must be
preserved; it drops and recreates the application tables.

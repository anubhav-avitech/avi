# Avitech Inventory System

Server-rendered internal inventory and asset management system built with Node.js, Express, EJS and MySQL.

## Access model

There are exactly two application scopes:

### Administrator
- Company-wide access.
- Manage all laboratory inventory.
- Edit and retire inventory; adding items is reserved for Department Users.
- Manage inventory across departments, but cannot issue items.
- View assignment history and process returns; chemical returns require an explanatory note.
- View inventory history and audit logs.
- Create, edit and permanently delete users. Deleting an account removes its login and personal details; assignment, transaction and audit history remains, with user references cleared.
- Retain administrator access without the ability to create or alter departments.
- The system has one fixed Laboratory department: Lab.
- No department restriction.

### Department User
- Belongs to exactly one department.
- Can view, add, edit and retire inventory only in that department.
- Can issue inventory only within that department.
- Can return non-chemical inventory in that department; chemical issues are treated as consumed and cannot be returned by Department Users.
- Can add non-login employee records using only employee ID and name, then assign department inventory to them.
- Can view inventory history only for that department.
- Cannot access another department's inventory, users, departments or audit logs.
- Cannot change their own department or otherwise expand their access.
- New accounts are always created as Department Users; only an existing administrator account can retain the Administrator role.

Employee recipients are separate non-login records, not application accounts. There is no Employee, Inventory Manager or Department Head application role.

## Security model

Authorization is enforced on the server and inside inventory business logic. Hiding a navigation item is not considered security. A Department User requesting another department's inventory ID directly receives HTTP 403.

The application also uses:
- MySQL parameterized queries.
- MySQL transactions for assignment and return operations.
- HTTP-only, SameSite session cookies.
- CSRF protection.
- Helmet security headers.
- Login rate limiting.
- Password hashing with bcrypt.
- Retire/deactivate semantics instead of destructive deletion where history matters.
- Audit logs and inventory transaction history.

## Inventory model

`ASSET` is intended for individually tracked equipment such as laptops, monitors, printers and testing equipment.

`CONSUMABLE` is intended for quantity-based stock such as chemicals, gloves, masks and stationery. Units include Piece, Bottle, Box, Pair, Pack, Kg, Gram, Liter, ml, Kit and Set.

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
- After any stock from a chemical line is issued, its batch, expiry and package-size details are locked to preserve issue/return traceability.
- Issuing containers automatically deducts them from the balance. Each issue records who issued it, who received it, when, its batch/expiry/package details and the balance afterwards.
- Department Users cannot return chemicals. Administrators can record exceptional chemical returns, with a required reason; the return updates stock and is recorded in history.
- Expiry dates and batches are visible in inventory and issue records for traceability.
- Inventory provides one printable batch receiving confirmation per batch number and department, branded for AVITECH NUTRITION PVT. LTD. and listing all chemical stock lines with that batch number. It includes company and vendor acknowledgment signature fields; use the browser's print dialog to print or save it as a PDF.

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

For an existing installation, back up the database and apply the role-permission update with:

```bash
mysql -u root -p < database/migrate-two-scope.sql
```

To add chemical type and container-size tracking and enable administrator return access, run:

```bash
mysql -u root -p < database/migrate-lab-chemicals.sql
```

To allow permanent user deletion while keeping and unlinking old assignment and transaction records, run:

```bash
mysql -u root -p < database/migrate-user-hard-delete.sql
```

To add non-login department employees as assignment recipients, run this one-time migration on an existing installation:

```bash
mysql -u root -p < database/migrate-department-employees.sql
```

To allow Department Users to edit inventory within their own department, apply:

```bash
mysql -u root -p < database/migrate-department-inventory-update.sql
```

Department Users must sign out and back in after the migration for the new permission to appear in their session.

To configure an existing installation for a single fixed Lab department, back up the database and run:

```bash
mysql -u root -p < database/migrate-single-lab-department.sql
```

The migration stops without deleting anything if a non-Lab department still has users, employees, or inventory. It removes department-management permissions after the migration.

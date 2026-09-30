# Avitech Inventory System

Server-rendered internal inventory and asset management system built with Node.js, Express, EJS and MySQL.

## Access model

There are exactly two application scopes:

### Administrator
- Company-wide access.
- Manage every department's inventory.
- Edit and retire inventory; adding items is reserved for Department Users.
- Manage inventory across departments, but cannot assign or return items.
- View inventory history and audit logs.
- Create, edit and deactivate users.
- Manage departments.
- No department restriction.

### Department User
- Belongs to exactly one department.
- Can view, add and retire inventory only in that department.
- Can assign and return items only within that department.
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

For laboratory chemicals, batch number, manufacturer, expiry date and storage location can be recorded. Example: assigning 3 bottles reduces available stock by 3; returning 3 bottles restores the stock and records the transaction.

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

To add non-login department employees as assignment recipients, run this one-time migration on an existing installation:

```bash
mysql -u root -p < database/migrate-department-employees.sql
```

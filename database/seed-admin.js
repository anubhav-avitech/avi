require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

(async () => {
  try {
    const email = String(process.env.ADMIN_EMAIL || 'admin@company.local').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

    const [[role]] = await db.query(
      "SELECT id FROM roles WHERE name='Administrator' AND scope='ALL' AND status='ACTIVE' LIMIT 1"
    );
    if (!role) throw new Error('Run database/schema.sql first.');

    const [rows] = await db.query('SELECT id FROM users WHERE email=? LIMIT 1', [email]);
    const hash = await bcrypt.hash(password, 12);

    if (rows.length) {
      await db.query(`
        UPDATE users
        SET password_hash=?,role_id=?,department_id=NULL,status='ACTIVE'
        WHERE id=?
      `, [hash, role.id, rows[0].id]);
      console.log('Admin password reset for', email);
    } else {
      await db.query(`
        INSERT INTO users(employee_code,name,email,password_hash,department_id,role_id,status)
        VALUES(?,?,?,?,NULL,?,'ACTIVE')
      `, ['ADMIN-001', 'System Administrator', email, hash, role.id]);
      console.log('Admin created:', email);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();

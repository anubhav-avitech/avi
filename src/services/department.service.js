const db = require('../config/db');
const { audit } = require('./audit.service');

async function list() {
	const [rows] = await db.query('SELECT id,name,status FROM departments ORDER BY name');
	return rows;
}

async function create(data, actor) {
	const name = String(data.name || '').trim();
	const [result] = await db.query(
		'INSERT INTO departments(name,status) VALUES(?,?)',
		[name, 'ACTIVE']
	);
	await audit(actor.id, 'DEPARTMENT_CREATED', 'departments', result.insertId, { name }, actor.ip);
}

async function update(id, data, actor) {
	const name = String(data.name || '').trim();
	const status = data.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
	await db.query('UPDATE departments SET name=?,status=? WHERE id=?', [name, status, id]);
	await audit(actor.id, 'DEPARTMENT_UPDATED', 'departments', id, { name, status }, actor.ip);
}

async function remove(id, actor) {
	const connection = await db.getConnection();

	try {
		await connection.beginTransaction();
		const [rows] = await connection.query(
			'SELECT id FROM departments WHERE id=? FOR UPDATE',
			[id]
		);
		if (!rows.length) throw new Error('DEPARTMENT_NOT_FOUND');

		const [[usage]] = await connection.query(`
			SELECT
				(SELECT COUNT(*) FROM users WHERE department_id=?) AS users,
				(SELECT COUNT(*) FROM employees WHERE department_id=?) AS employees,
				(SELECT COUNT(*) FROM inventory_items WHERE department_id=?) AS inventory
		`, [id, id, id]);
		if (Number(usage.users) || Number(usage.employees) || Number(usage.inventory)) throw new Error('DEPARTMENT_IN_USE');

		await connection.query('DELETE FROM departments WHERE id=?', [id]);
		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}

	await audit(actor.id, 'DEPARTMENT_DELETED', 'departments', id, null, actor.ip);
}

module.exports = { list, create, update, remove };

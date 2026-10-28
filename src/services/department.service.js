const db = require('../config/db');

async function list() {
	const [rows] = await db.query(
		"SELECT id,name,status FROM departments WHERE name='Lab' AND status='ACTIVE' ORDER BY name"
	);
	return rows;
}

module.exports = { list };

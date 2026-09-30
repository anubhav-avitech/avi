const db=require('../config/db');
async function audit(actorId,action,entityType,entityId,details,ip){await db.query('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details,ip_address) VALUES (?,?,?,?,?,?)',[actorId,action,entityType,entityId||null,details?JSON.stringify(details):null,ip||null]);}
module.exports={audit};

import { db } from '../api/_lib/common.js';

async function main() {
  console.log('=== STARTING SAMUEL POWER RECORDS AUDIT ===');

  // 1. Find Samuel's user ID
  const usersSnap = await db.collection('users').get();
  console.log(`Total users in DB: ${usersSnap.size}`);
  
  let samuelUids: string[] = [];
  usersSnap.forEach(doc => {
    const data = doc.data();
    console.log(`User Doc ID: ${doc.id}, Email: ${data.email}, Name: ${data.displayName || data.name}`);
    if (data.email === 'samuelfsc89@gmail.com' || (data.displayName && data.displayName.toLowerCase().includes('samuel'))) {
      samuelUids.push(doc.id);
    }
  });

  console.log('Samuel UIDs found:', samuelUids);

  // 2. Fetch all power_records
  const recordsSnap = await db.collection('power_records').get();
  console.log(`Total power_records in DB: ${recordsSnap.size}`);

  const samuelRecords: any[] = [];
  recordsSnap.forEach(doc => {
    const data = doc.data();
    if (samuelUids.includes(data.userId) || (data.userName && data.userName.toLowerCase().includes('samuel'))) {
      samuelRecords.push({ id: doc.id, ...data });
    }
  });

  console.log(`Samuel power_records count: ${samuelRecords.length}`);
  samuelRecords.forEach(r => {
    console.log(`Record [${r.id}]: userId=${r.userId}, exercise=${r.exercise}, weight=${r.weight}kg, videoStatus=${r.videoStatus}, videoUrl=${r.videoUrl}, createdAt=${r.createdAt}`);
  });

  // 3. Fetch all power_audit_logs
  const auditLogsSnap = await db.collection('power_audit_logs').get();
  console.log(`Total power_audit_logs in DB: ${auditLogsSnap.size}`);

  const samuelAuditLogs: any[] = [];
  auditLogsSnap.forEach(doc => {
    const data = doc.data();
    if (samuelUids.includes(data.userId) || (data.userName && data.userName.toLowerCase().includes('samuel'))) {
      samuelAuditLogs.push({ id: doc.id, ...data });
    }
  });

  console.log(`Samuel power_audit_logs count: ${samuelAuditLogs.length}`);
  samuelAuditLogs.forEach(l => {
    console.log(`Audit Log [${l.id}]: userId=${l.userId}, exercise=${l.exercise}, declaredWeight=${l.declaredWeight}kg, result=${l.result}, confidence=${l.confidence}, videoUrl=${l.videoUrl}, timestamp=${l.timestamp}`);
  });

  // 4. Determine which records need to be updated from 'approved' to 'rejected'
  let toUpdateCount = 0;
  for (const record of samuelRecords) {
    if (record.videoStatus === 'approved') {
      // Check if there is a corresponding log in power_audit_logs with result 'VALIDADO' and confidence >= 95
      const hasValidLog = samuelAuditLogs.some(log => {
        const isMatchUser = log.userId === record.userId;
        const isValidated = log.result === 'VALIDADO';
        const hasHighConfidence = Number(log.confidence) >= 95;
        // Optionally match exercise & weight or videoUrl
        const isMatchExercise = !log.exercise || log.exercise === record.exercise;
        const isMatchVideo = !record.videoUrl || !log.videoUrl || log.videoUrl === record.videoUrl;
        
        return isMatchUser && isValidated && hasHighConfidence && isMatchExercise && isMatchVideo;
      });

      if (!hasValidLog) {
        console.log(`--> RECORD TO REJECT: ID [${record.id}], exercise=${record.exercise}, weight=${record.weight}kg, current videoStatus=${record.videoStatus}`);
        toUpdateCount++;
        // Update document
        await db.collection('power_records').doc(record.id).update({
          videoStatus: 'rejected',
          rejectionReason: 'Corrigido via script de auditoria: Sem log de validação IA >=95% registrado.'
        });
        console.log(`   [UPDATED] Record ${record.id} set to 'rejected'.`);
      } else {
        console.log(`--> RECORD KEPT APPROVED: ID [${record.id}], exercise=${record.exercise}, weight=${record.weight}kg (Valid audit log found).`);
      }
    } else {
      console.log(`--> RECORD ALREADY NOT APPROVED: ID [${record.id}], videoStatus=${record.videoStatus}`);
    }
  }

  console.log(`=== FINISHED AUDIT: ${toUpdateCount} records changed from 'approved' to 'rejected' ===`);
  process.exit(0);
}

main().catch(err => {
  console.error('Audit Script Error:', err);
  process.exit(1);
});

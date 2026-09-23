import { neon } from '@neondatabase/serverless';
import type { VercelRequest, VercelResponse } from '@vercel/node';

function toBooleanPresence(val: any): boolean | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s === 'present' || s === 'true' || s === '1' || s === 'detected') return true;
    if (s === 'absent' || s === 'false' || s === '0' || s === 'empty') return false;
  }
  if (typeof val === 'number') return val > 0;
  return undefined;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const rawDbUrl = process.env.DATABASE_URL || '';
    const dbUrl = rawDbUrl.replace(/^["']|["']$/g, '').trim();

    if (!dbUrl) {
      return response.status(500).json({
        error: 'DATABASE_URL environment variable is missing on Vercel. Please add DATABASE_URL to your Vercel Project Settings > Environment Variables and redeploy.'
      });
    }

    const sql = neon(dbUrl);

    let rawBody = request.body;
    if (typeof rawBody === 'string') {
      try {
        rawBody = JSON.parse(rawBody);
      } catch (e) {
        console.warn('Could not parse request.body as JSON string');
      }
    }
    rawBody = (rawBody && typeof rawBody === 'object') ? rawBody : {};

    const action = rawBody.action || rawBody.event || rawBody.type;
    let payload = rawBody.payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (e) {}
    }
    if (!payload || typeof payload !== 'object') {
      payload = rawBody;
    }

    const currentTelemetryQuery = await sql`SELECT * FROM telemetry_history ORDER BY id DESC LIMIT 1`;
    const current = currentTelemetryQuery[0] || {
      device_id: 'ESP32-001',
      temperature: 24.0,
      humidity: 45.0,
      weight: 50.0,
      medicine_present: false,
      battery: 100,
      door_open: false,
    };

    const deviceId = payload?.deviceId || payload?.device_id || current.device_id || 'ESP32-001';
    const act = String(action || '').trim().toUpperCase();

    if (act === 'REPORT_TELEMETRY' || act === 'UPDATE_TELEMETRY') {
      const temperature = payload?.temperature !== undefined ? Number(payload.temperature) : current.temperature;
      const humidity = payload?.humidity !== undefined ? Number(payload.humidity) : current.humidity;
      
      let parsed = toBooleanPresence(payload?.medicinePresent);
      if (parsed === undefined) parsed = toBooleanPresence(payload?.medicine_present);
      if (parsed === undefined) parsed = toBooleanPresence(payload?.medicine);
      if (parsed === undefined) parsed = toBooleanPresence(payload?.medicineStatus);
      if (parsed === undefined) parsed = toBooleanPresence(payload?.status);
      if (parsed === undefined) parsed = toBooleanPresence(payload?.event);
      if (parsed === undefined && payload?.weight !== undefined) {
        parsed = Number(payload.weight) > 0;
      }

      const medicine_present = parsed !== undefined 
        ? parsed 
        : (current.medicine_present !== undefined ? Boolean(current.medicine_present) : false);

      let weight = payload?.weight !== undefined 
        ? Number(payload.weight) 
        : (medicine_present ? (Number(current.weight) > 0 ? Number(current.weight) : 50.0) : 0.0);
      
      const battery = payload?.battery !== undefined ? Number(payload.battery) : current.battery;
      const door_open = payload?.doorOpen !== undefined 
        ? Boolean(payload.doorOpen) 
        : (payload?.door_open !== undefined ? Boolean(payload.door_open) : current.door_open);

      await sql`
        INSERT INTO telemetry_history (device_id, temperature, humidity, weight, medicine_present, battery, door_open) 
        VALUES (${deviceId}, ${temperature}, ${humidity}, ${weight}, ${medicine_present}, ${battery}, ${door_open})
      `;

      // Auto-record to medicine_events if presence changed during periodic telemetry
      if (parsed !== undefined && parsed !== Boolean(current.medicine_present)) {
        await sql`
          INSERT INTO medicine_events (device_id, compartment_id, event)
          VALUES (${deviceId}, 'A1', ${parsed ? 'PRESENT' : 'ABSENT'})
        `;
      }

      await sql`
        INSERT INTO system_events (event_type, source, description, severity, related_component) 
        VALUES ('TELEMETRY_SYNC', ${deviceId}, 'Periodic telemetry synced from hardware.', 'INFO', 'ESP32 CORE')
      `;
    }
    else if (act === 'MEDICINE_PRESENT' || act === 'PRESENT') {
      const compId = payload?.compartmentId || 'A1';

      await sql`
        INSERT INTO medicine_events (device_id, compartment_id, event) 
        VALUES (${deviceId}, ${compId}, 'PRESENT')
      `;

      const expected = await sql`SELECT expected_weight FROM medications WHERE compartment_id = ${compId} LIMIT 1`;
      const w = expected.length > 0 ? Number(expected[0].expected_weight) : 50.0;

      await sql`
        INSERT INTO telemetry_history (device_id, temperature, humidity, weight, medicine_present, battery, door_open) 
        VALUES (${deviceId}, ${current.temperature}, ${current.humidity}, ${w}, true, ${current.battery}, ${current.door_open})
      `;

      await sql`
        INSERT INTO system_events (event_type, source, description, severity, related_component) 
        VALUES ('MEDICINE_PRESENT', 'IR Sensor', 'Medicine container detected in compartment ' || ${compId}, 'INFO', ${'Compartment ' + compId})
      `;
    }
    else if (act === 'MEDICINE_ABSENT' || act === 'ABSENT') {
      const compId = payload?.compartmentId || 'A1';

      await sql`
        INSERT INTO medicine_events (device_id, compartment_id, event) 
        VALUES (${deviceId}, ${compId}, 'ABSENT')
      `;

      await sql`
        INSERT INTO telemetry_history (device_id, temperature, humidity, weight, medicine_present, battery, door_open) 
        VALUES (${deviceId}, ${current.temperature}, ${current.humidity}, 0.0, false, ${current.battery}, ${current.door_open})
      `;

      const med = await sql`SELECT id FROM medications WHERE compartment_id = ${compId} LIMIT 1`;
      if (med.length > 0) {
        await sql`
          INSERT INTO dose_history (medication_id, compartment_id, scheduled_time, actual_time, status, weight_before, weight_after)
          VALUES (${med[0].id}, ${compId}, 'Scheduled', 'Now', 'TAKEN', ${current.weight}, 0.0)
        `;
      }

      await sql`
        INSERT INTO system_events (event_type, source, description, severity, related_component) 
        VALUES ('MEDICINE_ABSENT', 'IR Sensor', 'Medicine container removed from compartment ' || ${compId}, 'INFO', ${'Compartment ' + compId})
      `;
    }
    else if (act === 'OPEN_DOOR') {
      await sql`
        INSERT INTO telemetry_history (device_id, temperature, humidity, weight, medicine_present, battery, door_open) 
        VALUES (${deviceId}, ${current.temperature}, ${current.humidity}, ${current.weight}, ${current.medicine_present ?? true}, ${current.battery}, true)
      `;
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('DOOR_OPENED', 'Reed Switch', 'Medicine box compartment door opened.', 'INFO', 'DOOR / REED SWITCH')`;
    } 
    else if (act === 'CLOSE_DOOR') {
      await sql`
        INSERT INTO telemetry_history (device_id, temperature, humidity, weight, medicine_present, battery, door_open) 
        VALUES (${deviceId}, ${current.temperature}, ${current.humidity}, ${current.weight}, ${current.medicine_present ?? true}, ${current.battery}, false)
      `;
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('DOOR_CLOSED', 'Reed Switch', 'Medicine box door closed and secured.', 'INFO', 'DOOR / REED SWITCH')`;
    }
    else if (act === 'REMOVE_MEDICINE') {
      const compId = payload?.compartmentId || 'A1';

      await sql`
        INSERT INTO medicine_events (device_id, compartment_id, event) 
        VALUES (${deviceId}, ${compId}, 'ABSENT')
      `;

      await sql`
        INSERT INTO telemetry_history (device_id, temperature, humidity, weight, medicine_present, battery, door_open) 
        VALUES (${deviceId}, ${current.temperature}, ${current.humidity}, 0.0, false, ${current.battery}, ${current.door_open})
      `;
      
      const med = await sql`SELECT id FROM medications WHERE compartment_id = ${compId} LIMIT 1`;
      if (med.length > 0) {
        await sql`
          INSERT INTO dose_history (medication_id, compartment_id, scheduled_time, actual_time, status, weight_before, weight_after)
          VALUES (${med[0].id}, ${compId}, 'Scheduled', 'Now', 'TAKEN', ${current.weight}, 0.0)
        `;
      }
      
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('MEDICINE_REMOVED', 'Load Cell', 'Medicine container removed. Valid dose detected.', 'INFO', 'Compartment ${compId}')`;
    }
    else if (act === 'RESTORE_MEDICINE') {
      const compId = payload?.compartmentId || 'A1';

      await sql`
        INSERT INTO medicine_events (device_id, compartment_id, event) 
        VALUES (${deviceId}, ${compId}, 'PRESENT')
      `;

      const expected = await sql`SELECT expected_weight FROM medications WHERE compartment_id = ${compId} LIMIT 1`;
      const w = expected.length > 0 ? Number(expected[0].expected_weight) : 50.0;
      
      await sql`
        INSERT INTO telemetry_history (device_id, temperature, humidity, weight, medicine_present, battery, door_open) 
        VALUES (${deviceId}, ${current.temperature}, ${current.humidity}, ${w}, true, ${current.battery}, ${current.door_open})
      `;
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('MEDICINE_RESTORED', 'Load Cell', 'Medicine container restored.', 'INFO', 'Compartment ${compId}')`;
    }
    else if (act === 'ADJUST_TEMP') {
      const newTemp = Number(current.temperature) + (payload?.value || 0);
      await sql`
        INSERT INTO telemetry_history (device_id, temperature, humidity, weight, medicine_present, battery, door_open) 
        VALUES (${deviceId}, ${newTemp}, ${current.humidity}, ${current.weight}, ${current.medicine_present ?? true}, ${current.battery}, ${current.door_open})
      `;
    }

    return response.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error executing action:', error);
    return response.status(500).json({ error: error.message });
  }
}

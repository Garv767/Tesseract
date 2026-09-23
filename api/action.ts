import { neon } from '@neondatabase/serverless';
import type { VercelRequest, VercelResponse } from '@vercel/node';

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
    const { action, payload } = request.body;

    const currentTelemetryQuery = await sql`SELECT * FROM telemetry_history ORDER BY id DESC LIMIT 1`;
    const current = currentTelemetryQuery[0] || {
      temperature: 24.0,
      humidity: 45.0,
      weight: 50.0,
      battery: 100,
      door_open: false,
    };

    if (action === 'REPORT_TELEMETRY' || action === 'UPDATE_TELEMETRY') {
      const temperature = payload?.temperature !== undefined ? Number(payload.temperature) : current.temperature;
      let weight = payload?.weight !== undefined ? Number(payload.weight) : current.weight;
      if (payload?.medicine !== undefined || payload?.medicinePresent !== undefined) {
        const isMed = payload?.medicine !== undefined ? Boolean(payload.medicine) : Boolean(payload.medicinePresent);
        weight = isMed ? 50.0 : 0.0;
      }
      const battery = payload?.battery !== undefined ? Number(payload.battery) : current.battery;
      const door_open = payload?.doorOpen !== undefined 
        ? Boolean(payload.doorOpen) 
        : (payload?.door_open !== undefined ? Boolean(payload.door_open) : current.door_open);

      await sql`INSERT INTO telemetry_history (temperature, humidity, weight, battery, door_open) VALUES (${temperature}, ${humidity}, ${weight}, ${battery}, ${door_open})`;
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('TELEMETRY_SYNC', 'ESP32 Device', 'Periodic telemetry synced from hardware.', 'INFO', 'ESP32 CORE')`;
    }
    else if (action === 'OPEN_DOOR') {
      await sql`INSERT INTO telemetry_history (temperature, humidity, weight, battery, door_open) VALUES (${current.temperature}, ${current.humidity}, ${current.weight}, ${current.battery}, true)`;
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('DOOR_OPENED', 'Reed Switch', 'Medicine box compartment door opened.', 'INFO', 'DOOR / REED SWITCH')`;
    } 
    else if (action === 'CLOSE_DOOR') {
      await sql`INSERT INTO telemetry_history (temperature, humidity, weight, battery, door_open) VALUES (${current.temperature}, ${current.humidity}, ${current.weight}, ${current.battery}, false)`;
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('DOOR_CLOSED', 'Reed Switch', 'Medicine box door closed and secured.', 'INFO', 'DOOR / REED SWITCH')`;
    }
    else if (action === 'REMOVE_MEDICINE') {
      await sql`INSERT INTO telemetry_history (temperature, humidity, weight, battery, door_open) VALUES (${current.temperature}, ${current.humidity}, 0.0, ${current.battery}, ${current.door_open})`;
      
      const compId = payload?.compartmentId || 'A1';
      const med = await sql`SELECT id FROM medications WHERE compartment_id = ${compId} LIMIT 1`;
      
      if (med.length > 0) {
        await sql`
          INSERT INTO dose_history (medication_id, compartment_id, scheduled_time, actual_time, status, weight_before, weight_after)
          VALUES (${med[0].id}, ${compId}, 'Scheduled', 'Now', 'TAKEN', ${current.weight}, 0.0)
        `;
      }
      
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('MEDICINE_REMOVED', 'Load Cell', 'Medicine container removed. Valid dose detected.', 'INFO', 'Compartment ${compId}')`;
    }
    else if (action === 'RESTORE_MEDICINE') {
      const compId = payload?.compartmentId || 'A1';
      const expected = await sql`SELECT expected_weight FROM medications WHERE compartment_id = ${compId} LIMIT 1`;
      const w = expected.length > 0 ? expected[0].expected_weight : 50.0;
      
      await sql`INSERT INTO telemetry_history (temperature, humidity, weight, battery, door_open) VALUES (${current.temperature}, ${current.humidity}, ${w}, ${current.battery}, ${current.door_open})`;
      await sql`INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES ('MEDICINE_RESTORED', 'Load Cell', 'Medicine container restored.', 'INFO', 'Compartment ${compId}')`;
    }
    else if (action === 'ADJUST_TEMP') {
      const newTemp = Number(current.temperature) + (payload?.value || 0);
      await sql`INSERT INTO telemetry_history (temperature, humidity, weight, battery, door_open) VALUES (${newTemp}, ${current.humidity}, ${current.weight}, ${current.battery}, ${current.door_open})`;
    }

    return response.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error executing action:', error);
    return response.status(500).json({ error: error.message });
  }
}

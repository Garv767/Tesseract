import { neon } from '@neondatabase/serverless';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // Fetch latest telemetry
    const telemetryQuery = await sql\`SELECT * FROM telemetry_history ORDER BY id DESC LIMIT 1\`;
    const telemetry = telemetryQuery[0] || {
      temperature: 24.0, humidity: 48.0, weight: 52.4, battery: 87, door_open: false
    };

    // Fetch compartments
    const medications = await sql\`SELECT * FROM medications\`;
    const compartments: Record<string, any> = {};
    medications.forEach((med: any) => {
      compartments[med.compartment_id] = {
        medicineName: med.name,
        present: telemetry.weight > 0, // Simplified presence check for MVP
        weight: med.expected_weight
      };
    });

    // Fetch dose history
    const history = await sql\`SELECT * FROM dose_history ORDER BY id DESC LIMIT 20\`;

    // Fetch system events
    const events = await sql\`SELECT * FROM system_events ORDER BY id DESC LIMIT 20\`;

    return response.status(200).json({
      deviceId: 'MED-ESP32-001',
      temperature: Number(telemetry.temperature),
      humidity: Number(telemetry.humidity),
      weight: Number(telemetry.weight),
      battery: telemetry.battery,
      doorOpen: telemetry.door_open,
      wifiConnected: true,
      rtcSynchronized: true,
      sensorsOnline: true,
      medicinePresent: telemetry.weight > 0,
      currentSimulationTime: new Date().toISOString(),
      compartments,
      medicationSchedule: medications,
      doseHistory: history,
      events
    });
  } catch (error: any) {
    console.error('Error fetching state:', error);
    return response.status(500).json({ error: error.message });
  }
}

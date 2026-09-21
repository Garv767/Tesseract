const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS medications (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        compartment_id VARCHAR(10) NOT NULL UNIQUE,
        dosage VARCHAR(50),
        scheduled_time VARCHAR(20),
        grace_period_minutes INTEGER DEFAULT 15,
        expected_weight DECIMAL(5,2),
        instructions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  await sql`
    CREATE TABLE IF NOT EXISTS dose_history (
        id SERIAL PRIMARY KEY,
        medication_id VARCHAR(50) REFERENCES medications(id),
        compartment_id VARCHAR(10),
        scheduled_time VARCHAR(20),
        actual_time VARCHAR(20),
        status VARCHAR(20) NOT NULL,
        delay_minutes INTEGER DEFAULT 0,
        weight_before DECIMAL(5,2),
        weight_after DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS system_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        source VARCHAR(50),
        description TEXT,
        severity VARCHAR(20),
        related_component VARCHAR(50),
        gpio_or_protocol VARCHAR(50),
        firmware_function VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS telemetry_history (
        id SERIAL PRIMARY KEY,
        temperature DECIMAL(5,2),
        humidity DECIMAL(5,2),
        weight DECIMAL(5,2),
        battery INTEGER,
        door_open BOOLEAN,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const counts = await sql`SELECT COUNT(*) as count FROM medications`;
  if (counts[0].count === '0') {
    console.log('Inserting initial mock data...');
    await sql`
      INSERT INTO medications (id, name, compartment_id, dosage, scheduled_time, expected_weight, instructions) VALUES 
      ('med-1', 'Medicine A (Blood Pressure)', 'A1', '10mg Tablet', '08:00 AM', 52.4, 'Take 1 tablet daily with water.'),
      ('med-2', 'Medicine B (Cholesterol)', 'A2', '20mg Capsule', '02:00 PM', 44.1, 'Take after meals.'),
      ('med-3', 'Medicine C (Diabetes)', 'A3', '500mg Tablet', '08:00 PM', 61.8, 'Take 1 tablet before bedtime.'),
      ('med-4', 'Medicine D (Vitamin D3)', 'A4', '1000 IU', '08:00 AM', 38.0, 'Daily supplement.')
    `;
    await sql`
      INSERT INTO system_events (event_type, source, description, severity, related_component) VALUES
      ('SYSTEM_STARTUP', 'ESP32', 'Database initialized and connected to Neon via Vercel.', 'INFO', 'ESP32')
    `;
    await sql`
      INSERT INTO telemetry_history (temperature, humidity, weight, battery, door_open) VALUES
      (24.0, 48.0, 52.4, 87, false)
    `;
  }
  
  console.log('Database initialized successfully.');
}

initDb().catch(console.error);

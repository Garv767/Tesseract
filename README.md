# Tesseract — Smart Medicine Dispenser

Tesseract is a Raspberry Pi–controlled 3-chamber automated medicine dispenser backed by **Neon PostgreSQL**. It authenticates patients via fingerprint, unlocks scheduled compartments using servo motors, detects hand pickup via an ultrasonic sensor, and measures pre/post medicine weights using three HX711 load cells to log consumption.

> **Branch Note**
> - `main` — Current Raspberry Pi hardware controller (`medicine/` + `hx711py/`) connected to Neon Postgres.
> - `main-old` — Preserved legacy ESP32 + React/Vite + Vercel Serverless dashboard branch (paired with the `main-old` Neon DB branch).
> - `dev/clean-ui` — Legacy ESP32 CleanDashboard UI branch.

---

## Project Structure

```text
.
├── medicine/
│   ├── db.py                     # Shared Neon Postgres client (stdlib .env + psycopg/psycopg2 + HTTPS /sql fallback)
│   ├── project_test.py           # Main 3-chamber dispenser controller with HX711 pre/post weight tracking
│   ├── trial.py                  # Alternate servo-pin & time-window variant of project_test.py
│   ├── project_final.py          # Earlier 3-chamber controller without HX711 load cells
│   ├── local_data.json           # Sample offline patient/plan structure
│   ├── fingerprint_enroll.py     # Enroll patient fingerprints into the sensor
│   ├── fingerprint_test.py       # Test fingerprint recognition (/dev/serial0)
│   ├── load_test.py              # Standalone HX711 load-cell calibration/testing
│   ├── servo_test.py             # Standalone servo sweep test
│   ├── ultrasonic_test.py        # Standalone HC-SR04 ultrasonic sensor test
│   ├── .env.example              # Raspberry Pi environment template
│   └── v0/raspbrry_pi/           # Early v0 Flask API & Supabase prototype
├── hx711py/                      # HX711 Python library (tatobari/hx711py)
├── .env.example                  # Root environment template
└── .gitignore                    # Excludes .env, serviceAccountKey.json, *.7z, *.log, caches
```

---

## Hardware Setup (Raspberry Pi BCM GPIO)

Pin assignments used in `medicine/project_test.py`:

| Component | Interface / Pins (BCM) | Notes |
| --- | --- | --- |
| **Fingerprint Sensor** | UART `/dev/ttyS0` (`57600` baud) | `fingerprint_test.py` uses `/dev/serial0` |
| **Ultrasonic Sensor** | `TRIG = GPIO 23`, `ECHO = GPIO 24` | Hand thresholds: `[20.0, 40.0, 60.0]` cm |
| **Chamber 1 Servo** | `GPIO 18` | `OPEN = 0°`, `CLOSE = 90°` |
| **Chamber 2 Servo** | `GPIO 12` | Swapped to `GPIO 13` in `trial.py` |
| **Chamber 3 Servo** | `GPIO 13` | Swapped to `GPIO 12` in `trial.py` |
| **Chamber 1 Load Cell (HX711)** | `DT = GPIO 5`, `SCK = GPIO 6` | Calibration factor `-7050.0` |
| **Chamber 2 Load Cell (HX711)** | `DT = GPIO 19`, `SCK = GPIO 26` | Calibration factor `-7050.0` |
| **Chamber 3 Load Cell (HX711)** | `DT = GPIO 20`, `SCK = GPIO 21` | Calibration factor `-7050.0` |

---

## Environment Configuration

Create `medicine/.env` (or root `.env`) from `.env.example`:

```bash
cp medicine/.env.example medicine/.env
```

Variables in `.env.example`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | **Active** Neon PostgreSQL connection string for `main` (used by `medicine/db.py`). |
| `DATABASE_URL_MAIN_OLD` | Reference connection string for the `main-old` Neon DB branch. |
| `SUPABASE_URL_OLD` | Legacy Supabase project URL kept for reference only (unused by `main` scripts). |
| `SUPABASE_KEY_OLD` | Legacy Supabase key kept for reference only (unused by `main` scripts). |
| `DEVICE_ID` | Identifier for this Raspberry Pi unit (e.g. `raspberry_pi_01`). |
| `POLL_INTERVAL` | Polling interval configuration (seconds). |

`medicine/db.py` loads `medicine/.env` first and repo-root `.env` second using only Python's standard library (`os.environ.setdefault`), so `python-dotenv` is not required.

---

## Raspberry Pi 2 Setup & Running

1. **System & Python dependencies**
   - **`medicine/db.py` works out-of-the-box with zero external DB packages** by falling back to Neon's HTTPS `/sql` endpoint via `urllib.request`.
   - *(Optional)* If you prefer direct TCP PostgreSQL (`psycopg2`), install the precompiled Raspberry Pi OS package instead of compiling `pip` wheels on Pi 2:
     ```bash
     sudo apt update
     sudo apt install -y python3-psycopg2
     ```
   - Install hardware libraries (if not already present on the Pi):
     ```bash
     pip install pyfingerprint
     ```
   - Make sure `hx711py` is importable (either install from `hx711py/` or run with `PYTHONPATH=.` / copy `hx711.py` into `medicine/`).

2. **Enroll fingerprints**
   ```bash
   python3 medicine/fingerprint_enroll.py
   ```
   Map the printed template position (`fingerprint_id`) to a patient row in the Neon `users` table.

3. **Run the dispenser**
   ```bash
   python3 medicine/project_test.py
   ```

---

## Neon PostgreSQL Schema (`main`)

Run once in Neon SQL Editor (or via `psql`) on the production/`main` Neon branch:

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  fingerprint_id INTEGER UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'PATIENT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medication_plans (
  id SERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chamber_id INTEGER NOT NULL CHECK (chamber_id BETWEEN 1 AND 3),
  morning_timing VARCHAR(20) DEFAULT '',
  afternoon_timing VARCHAR(20) DEFAULT '',
  evening_timing VARCHAR(20) DEFAULT '',
  UNIQUE (patient_id, chamber_id)
);

CREATE TABLE IF NOT EXISTS dispenser_status (
  id INTEGER PRIMARY KEY,
  status VARCHAR(50) NOT NULL DEFAULT 'idle',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO dispenser_status (id, status)
VALUES (1, 'idle')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dispenser_events (
  id SERIAL PRIMARY KEY,
  fingerprint_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medicine_logs (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  distance NUMERIC(6,2),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weight_logs (
  id SERIAL PRIMARY KEY,
  patient_id UUID REFERENCES users(id) ON DELETE SET NULL,
  chamber_id INTEGER NOT NULL,
  weight_grams NUMERIC(8,2) NOT NULL,
  snapshot_type VARCHAR(10) NOT NULL CHECK (snapshot_type IN ('pre', 'post')),
  timing_period VARCHAR(20) NOT NULL,
  timing_slot VARCHAR(20) NOT NULL,
  fingerprint_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consumption_logs (
  id SERIAL PRIMARY KEY,
  patient_id UUID REFERENCES users(id) ON DELETE SET NULL,
  chamber_id INTEGER NOT NULL,
  pre_weight_grams NUMERIC(8,2) NOT NULL,
  post_weight_grams NUMERIC(8,2) NOT NULL,
  consumed_grams NUMERIC(8,2) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('taken', 'refilled', 'no_change')),
  timing_period VARCHAR(20) NOT NULL,
  timing_slot VARCHAR(20) NOT NULL,
  fingerprint_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Security Notes

- Never commit `.env`, `serviceAccountKey.json`, or `*.7z` archives (all are ignored by `.gitignore`).
- Rotate Neon/Supabase keys immediately if any credential is ever exposed outside your private `.env`.

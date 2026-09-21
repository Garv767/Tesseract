# Tesseract Medical Tracker

Tesseract is a full-stack, serverless IoT dashboard for tracking medical telemetry, door access, and medication adherence. It is designed to work in tandem with an ESP32 hardware device equipped with load cells and environmental sensors.

## Features
- **Real-Time Dashboard**: Monitor live temperature, humidity, medicine compartment weight, and door state.
- **Serverless Architecture**: Built entirely on Vercel Serverless Functions (`/api`), eliminating the need for a persistent backend server.
- **Persistent Database**: Integrates seamlessly with Neon Serverless Postgres for logging `telemetry_history`, `dose_history`, and `system_events`.
- **IoT Hardware Integration**: Securely exposes REST endpoints for ESP32 HTTP POST requests.
- **Modern UI**: Dark-themed, responsive dashboard built with React and Vite.

## Hardware Setup
The physical device uses an ESP32 microcontroller with:
- **DHT22**: Temperature and Humidity sensor.
- **HX711 + Load Cell**: Weight sensor inside the medicine compartment.
- **Reed Switch**: Door open/close magnetic sensor.

The firmware for the ESP32 is included in the `firmware/` directory. Simply flash it to your board using the Arduino IDE!

## Backend Architecture
The backend is completely serverless and runs on Vercel.
- `GET /api/state`: Polled by the React frontend to refresh the dashboard data.
- `POST /api/action`: Called by the ESP32 to trigger actions (e.g., `OPEN_DOOR`, `REMOVE_MEDICINE`) which mutate the Neon database state.

## Getting Started

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Environment Setup:**
   Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
   Add your `DATABASE_URL` (Neon Postgres Connection String) to the `.env` file.
3. **Initialize Database:**
   Initialize your Neon Postgres tables by running the setup script:
   ```bash
   node database/db-init.cjs
   ```
4. **Run Locally:**
   Use the Vercel CLI for local development so that the `/api` functions are correctly hosted:
   ```bash
   npm install -g vercel
   vercel dev
   ```

## Deployment
This project is configured for one-click deployment on **Vercel**. 
1. Push your code to GitHub.
2. Link the repository in Vercel.
3. Add your `DATABASE_URL` to the **Environment Variables** tab in your Vercel Project settings.
4. Deploy!

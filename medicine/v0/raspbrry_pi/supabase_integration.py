import os
from datetime import datetime
from typing import Optional, Dict, Any
import time
import json
from supabase import create_client, Client
import pyfingerprint
from hx711 import HX711
from gpiozero import DistanceSensor, Servo
import Adafruit_DHT

# Supabase initialization
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Hardware configuration
FINGERPRINT_PORT = "/dev/ttyUSB0"
DHT_SENSOR = Adafruit_DHT.DHT22
DHT_PIN = 4

# Distance sensor (ultrasonic)
echo = 17
trigger = 27
sensor = DistanceSensor(echo=echo, trigger=trigger)

# Load cell for medicine weight
hx711 = HX711(dout_pin=21, pd_sck_pin=20)
hx711.reset()
hx711.tare()

# Servo motor for dispensing
servo = Servo(18)

# Patient ID (should be set during device initialization)
PATIENT_ID = os.getenv("PATIENT_ID")
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN", "rpi-" + PATIENT_ID)


class RaspberryPiIntegration:
    def __init__(self):
        self.supabase = supabase
        self.patient_id = PATIENT_ID
        self.device_token = DEVICE_TOKEN
        self.last_heartbeat = None
        self.initialized = False
        
    def register_device(self):
        """Register Raspberry Pi device with Supabase"""
        try:
            response = self.supabase.table("raspberry_pi_devices").insert({
                "patient_id": self.patient_id,
                "device_name": f"Medicine Dispenser - {self.patient_id}",
                "device_token": self.device_token,
                "last_heartbeat": datetime.now().isoformat(),
                "is_online": True,
                "firmware_version": "1.0.0"
            }).execute()
            print(f"[v0] Device registered: {response.data}")
            self.initialized = True
            return True
        except Exception as e:
            print(f"[v0] Error registering device: {e}")
            return False
    
    def send_heartbeat(self):
        """Send heartbeat to Supabase to indicate device is online"""
        try:
            self.supabase.table("raspberry_pi_devices").update({
                "last_heartbeat": datetime.now().isoformat(),
                "is_online": True
            }).eq("device_token", self.device_token).execute()
            self.last_heartbeat = datetime.now()
        except Exception as e:
            print(f"[v0] Heartbeat error: {e}")
    
    def read_fingerprint(self):
        """Read fingerprint and identify patient"""
        try:
            f = pyfingerprint.PyFingerprint(FINGERPRINT_PORT, 57600, 0xFFFFFFFF, 0x00000000)
            
            if not f.verifyPassword():
                print("[v0] Fingerprint sensor password verification failed")
                return None
            
            print("[v0] Waiting for fingerprint...")
            while not f.readImage():
                pass
            
            f.convertImage(2)
            if f.searchTemplate() < 0:
                print("[v0] Fingerprint not found")
                return None
            
            fingerprint_id = str(f.fingerID)
            print(f"[v0] Fingerprint recognized: {fingerprint_id}")
            return fingerprint_id
        except Exception as e:
            print(f"[v0] Fingerprint error: {e}")
            return None
    
    def check_hand_proximity(self) -> bool:
        """Check if hand is near dispenser using ultrasonic sensor"""
        try:
            distance = sensor.distance * 100  # Convert to cm
            print(f"[v0] Hand distance: {distance:.1f}cm")
            return distance < 15  # 15cm threshold
        except Exception as e:
            print(f"[v0] Proximity sensor error: {e}")
            return False
    
    def read_vitals(self) -> Dict[str, Any]:
        """Read temperature and humidity from DHT22 sensor"""
        try:
            humidity, temperature = Adafruit_DHT.read_retry(DHT_SENSOR, DHT_PIN)
            
            vitals = {}
            if humidity is not None:
                vitals["temperature"] = round(temperature, 2)
            if humidity is not None:
                vitals["humidity"] = round(humidity, 2)
            
            print(f"[v0] Vitals read: {vitals}")
            return vitals
        except Exception as e:
            print(f"[v0] Vitals sensor error: {e}")
            return {}
    
    def check_medicine_taken(self) -> bool:
        """Check if medicine has been taken using load cell"""
        try:
            weight = hx711.get_weight(5)
            print(f"[v0] Detected weight: {weight:.2f}g")
            return weight > 10  # If weight > 10g, medicine is likely taken
        except Exception as e:
            print(f"[v0] Load cell error: {e}")
            return False
    
    def dispense_medicine(self):
        """Control servo motor to dispense medicine"""
        try:
            servo.min()  # Open dispenser
            time.sleep(2)
            servo.max()  # Close dispenser
            print("[v0] Medicine dispensed")
        except Exception as e:
            print(f"[v0] Dispense error: {e}")
    
    def record_medicine_taken(self, medicine_id: str, fingerprint_id: Optional[str] = None):
        """Record that medicine was taken in real-time to Supabase"""
        try:
            response = self.supabase.table("medicine_records").update({
                "taken_time": datetime.now().isoformat(),
                "status": "taken",
                "fingerprint_id": fingerprint_id,
                "weight_detected": True
            }).eq("id", medicine_id).execute()
            
            print(f"[v0] Medicine taken recorded: {response.data}")
            return True
        except Exception as e:
            print(f"[v0] Error recording medicine: {e}")
            return False
    
    def upload_vitals(self, vitals: Dict[str, Any]):
        """Upload vitals to Supabase in real-time"""
        try:
            vitals_data = {
                "patient_id": self.patient_id,
                "heart_rate": vitals.get("heart_rate"),
                "temperature": vitals.get("temperature"),
                "blood_pressure_systolic": vitals.get("bp_sys"),
                "blood_pressure_diastolic": vitals.get("bp_dia"),
                "oxygen_level": vitals.get("oxygen"),
                "weight": vitals.get("weight"),
                "recorded_at": datetime.now().isoformat()
            }
            
            response = self.supabase.table("vitals").insert(vitals_data).execute()
            print(f"[v0] Vitals uploaded: {response.data}")
            return True
        except Exception as e:
            print(f"[v0] Error uploading vitals: {e}")
            return False
    
    def get_scheduled_medicines(self) -> list:
        """Get scheduled medicines for today"""
        try:
            from datetime import date
            today = date.today()
            
            response = self.supabase.table("medicine_records").select("*").eq(
                "patient_id", self.patient_id
            ).eq(
                "status", "pending"
            ).gte(
                "scheduled_time", f"{today}T00:00:00"
            ).lte(
                "scheduled_time", f"{today}T23:59:59"
            ).execute()
            
            print(f"[v0] Found {len(response.data)} scheduled medicines")
            return response.data
        except Exception as e:
            print(f"[v0] Error fetching scheduled medicines: {e}")
            return []
    
    def process_medicine_dispensing(self):
        """Main loop for processing medicine dispensing"""
        medicines = self.get_scheduled_medicines()
        
        for medicine in medicines:
            print(f"\n[v0] Processing medicine: {medicine['id']}")
            
            # Wait for hand detection
            while not self.check_hand_proximity():
                print("[v0] Waiting for hand...")
                time.sleep(1)
            
            print("[v0] Hand detected, reading fingerprint...")
            fingerprint_id = self.read_fingerprint()
            
            # Dispense medicine
            self.dispense_medicine()
            
            # Wait for medicine to be taken
            time.sleep(2)
            if self.check_medicine_taken():
                print("[v0] Medicine taken confirmed")
                self.record_medicine_taken(medicine['id'], fingerprint_id)
            
            # Send heartbeat
            self.send_heartbeat()
    
    def subscribe_to_medicine_updates(self):
        """Subscribe to real-time medicine updates from Supabase"""
        try:
            def callback(payload):
                print(f"[v0] Medicine update received: {payload}")
                if payload['eventType'] == 'INSERT':
                    medicine = payload['new']
                    print(f"[v0] New medicine scheduled: {medicine}")
            
            self.supabase.realtime.on(
                "postgres_changes",
                {
                    "event": "INSERT",
                    "schema": "public",
                    "table": "medicine_records",
                    "filter": f"patient_id=eq.{self.patient_id}"
                },
                callback
            ).subscribe()
            
            print("[v0] Subscribed to medicine updates")
        except Exception as e:
            print(f"[v0] Subscription error: {e}")


# Main execution
if __name__ == "__main__":
    integration = RaspberryPiIntegration()
    
    # Register device
    if integration.register_device():
        print("[v0] Device registered successfully")
    
    # Main loop
    try:
        while True:
            integration.send_heartbeat()
            integration.process_medicine_dispensing()
            time.sleep(60)  # Check every minute
    except KeyboardInterrupt:
        print("[v0] Shutting down...")

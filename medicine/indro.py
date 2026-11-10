from pyfingerprint.pyfingerprint import PyFingerprint
import RPi.GPIO as GPIO
import time
import threading
import json
import os
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ====================== OPTIONAL SUPABASE CONFIG ======================
# The system now works fully offline. If Supabase credentials are present
# and reachable, it will also sync logs/status/lookups to the cloud.
# If not, everything falls back to local files automatically.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

supabase = None
DB_ONLINE = False

def try_connect_supabase():
    """Attempt to connect to Supabase. Never raises — just leaves DB_ONLINE False on failure."""
    global supabase, DB_ONLINE
    if not SUPABASE_URL or not SUPABASE_KEY:
        supabase = None
        DB_ONLINE = False
        print("📴 SUPABASE_URL / SUPABASE_KEY not set — running in OFFLINE mode (local files only)")
        return
    try:
        from supabase import create_client, Client
        client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        # Lightweight connectivity check
        client.table("dispenser_status").select("id").limit(1).execute()
        supabase = client
        DB_ONLINE = True
        print("☁️  Supabase connected — running in online+local mode")
    except Exception as e:
        supabase = None
        DB_ONLINE = False
        print(f"📴 Supabase unavailable ({e}) — running in OFFLINE mode (local files only)")

try_connect_supabase()

# ====================== LOCAL DATA STORE ======================
# Used as the source of truth when offline, and as a fallback whenever
# a Supabase call fails mid-run. Edit local_data.json to match your
# patients / medication plans for offline use.
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DATA_FILE = os.path.join(LOCAL_DIR, "local_data.json")
LOCAL_LOG_FILE = os.path.join(LOCAL_DIR, "local_events.log")

DEFAULT_LOCAL_DATA = {
    "patients": {
        # fingerprint_id (as string) -> patient info
        "0": {"id": "local-patient-1", "name": "Patient One"}
    },
    "medication_plans": {
        # patient_id -> list of chamber rows (1-based chamber_id)
        "local-patient-1": [
            {"chamber_id": 1, "morning_timing": "Before", "afternoon_timing": "", "evening_timing": ""},
            {"chamber_id": 2, "morning_timing": "After",  "afternoon_timing": "Before", "evening_timing": ""},
            {"chamber_id": 3, "morning_timing": "", "afternoon_timing": "After", "evening_timing": "Before"}
        ]
    }
}

def load_local_data():
    if not os.path.exists(LOCAL_DATA_FILE):
        with open(LOCAL_DATA_FILE, "w") as f:
            json.dump(DEFAULT_LOCAL_DATA, f, indent=2)
        print(f"📄 Created default {LOCAL_DATA_FILE} — edit it with real patient/medication data")
        return DEFAULT_LOCAL_DATA
    try:
        with open(LOCAL_DATA_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️  Could not read {LOCAL_DATA_FILE} ({e}) — using built-in defaults")
        return DEFAULT_LOCAL_DATA

local_data = load_local_data()

def local_log(line):
    try:
        with open(LOCAL_LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception as e:
        print(f"⚠️  Could not write local log: {e}")

# ====================== GPIO PINS ======================
TRIG = 23
ECHO = 24

SERVO_PIN_1 = 18   # Chamber 1
SERVO_PIN_2 = 12   # Chamber 2
SERVO_PIN_3 = 13   # Chamber 3

# ====================== SERVO ANGLES ======================
OPEN_ANGLE  = 0
CLOSE_ANGLE = 90

# ====================== TIME WINDOWS ======================
# (start_h, start_m, end_h, end_m, timing_col, timing_val)
TIME_WINDOWS = [
    (8,  30,  9,  0,  "morning_timing",   "Before"),   # 08:30 - 09:00
    (10,  0, 12, 30,  "morning_timing",   "After"),    # 10:00 - 10:30
    (12, 30, 14,  0,  "afternoon_timing", "Before"),   # 12:30 - 13:00
    (14,  0, 16, 30,  "afternoon_timing", "After"),    # 14:00 - 14:30
    (19,  0, 19, 30,  "evening_timing",   "Before"),   # 19:00 - 19:30
    (20, 30, 21,  0,  "evening_timing",   "After"),    # 20:30 - 21:00
]

# ====================== GPIO SETUP ======================
GPIO.setmode(GPIO.BCM)
GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

for pin in [SERVO_PIN_1, SERVO_PIN_2, SERVO_PIN_3]:
    GPIO.setup(pin, GPIO.OUT)

servo1 = GPIO.PWM(SERVO_PIN_1, 50)
servo2 = GPIO.PWM(SERVO_PIN_2, 50)
servo3 = GPIO.PWM(SERVO_PIN_3, 50)

servos = [servo1, servo2, servo3]
servo_angles = [CLOSE_ANGLE, CLOSE_ANGLE, CLOSE_ANGLE]

for s in servos:
    s.start(0)

# ====================== GLOBAL PATIENT STATE ======================
current_patient_id     = None
current_patient_name   = None
current_fingerprint_id = None

# ====================== SUPABASE HELPERS (all safe / non-blocking) ======================
def _supabase_insert(payload):
    if not DB_ONLINE:
        return
    try:
        supabase.table("medicine_logs").insert(payload).execute()
    except Exception as e:
        print(f"⚠️  Supabase log error: {e}")

def _supabase_update(payload):
    if not DB_ONLINE:
        return
    try:
        supabase.table("dispenser_status").update(payload).eq("id", 1).execute()
    except Exception as e:
        print(f"⚠️  Supabase status error: {e}")

def log_event(event_type, message, distance=None, chamber=None):
    timestamp = datetime.utcnow().isoformat()
    payload = {
        "event_type": event_type,
        "message": message,
        "distance": distance,
        "timestamp": timestamp
    }
    # Always log locally so nothing is lost when offline
    local_log(f"{timestamp} | {event_type} | {message} | distance={distance} | chamber={chamber}")
    if DB_ONLINE:
        threading.Thread(target=_supabase_insert, args=(payload,), daemon=True).start()
    prefix = f"[Chamber {chamber}] " if chamber is not None else ""
    print(f"📝 {prefix}{message}")

def update_status(status):
    timestamp = datetime.utcnow().isoformat()
    payload = {
        "status": status,
        "last_updated": timestamp
    }
    local_log(f"{timestamp} | STATUS | {status}")
    if DB_ONLINE:
        threading.Thread(target=_supabase_update, args=(payload,), daemon=True).start()
    print(f"📊 Status: {status}")

def push_fingerprint_event(fp_id):
    if not DB_ONLINE:
        return

    def _push():
        try:
            supabase.table("dispenser_events").insert({
                "fingerprint_id": fp_id
            }).execute()
        except Exception as e:
            print(f"⚠️  Fingerprint event error: {e}")
    threading.Thread(target=_push, daemon=True).start()

def get_patient_from_fingerprint(fp_id):
    """
    Tries Supabase first (if online); falls back to local_data.json
    if Supabase is unavailable or the lookup fails for any reason.
    """
    global current_patient_id, current_patient_name, current_fingerprint_id

    if DB_ONLINE:
        try:
            res = supabase.table("users") \
                .select("id, name") \
                .eq("fingerprint_id", fp_id) \
                .eq("role", "PATIENT") \
                .single() \
                .execute()

            data: dict = res.data  # type: ignore[assignment]
            current_patient_id     = data["id"]
            current_patient_name   = data["name"]
            current_fingerprint_id = fp_id

            log_event("patient_identified",
                      f"Patient identified: {current_patient_name}")
            return
        except Exception as e:
            print(f"⚠️  Supabase patient lookup failed ({e}) — falling back to local data")

    # --- Local fallback ---
    patient = local_data.get("patients", {}).get(str(fp_id))
    if patient:
        current_patient_id     = patient["id"]
        current_patient_name   = patient["name"]
        current_fingerprint_id = fp_id
        log_event("patient_identified",
                  f"Patient identified (local): {current_patient_name}")
    else:
        current_patient_id = current_patient_name = current_fingerprint_id = None
        log_event("error", f"Patient mapping failed for fingerprint {fp_id} (no local match)")

# ====================== TIME WINDOW DETECTION ======================
def get_current_window():
    """
    Returns (timing_col, timing_val, period_label) for the active time window.
    Returns None if outside all windows.
    """
    now = datetime.now()
    current_minutes = now.hour * 60 + now.minute

    for (sh, sm, eh, em, col, val) in TIME_WINDOWS:
        start = sh * 60 + sm
        end   = eh * 60 + em
        if start <= current_minutes < end:
            period_label = col.replace("_timing", "").capitalize()
            return (col, val, period_label)

    return None

# ====================== MEDICATION PLAN LOOKUP ======================
def get_chambers_to_open(patient_id, timing_col, timing_val):
    """
    Queries medication_plans for the patient (Supabase if online, else
    local_data.json). Returns a list of 0-based chamber indices whose
    timing_col == timing_val. Returns [] if none match or on error.
    """
    if patient_id is None:
        return []

    rows = None

    if DB_ONLINE:
        try:
            print(f"🔍 Querying medication_plans: patient_id={patient_id}, col={timing_col}, val={timing_val}")
            res = supabase.table("medication_plans") \
                .select("chamber_id, morning_timing, afternoon_timing, evening_timing") \
                .eq("patient_id", patient_id) \
                .execute()
            rows = res.data  # type: ignore[assignment]
            print(f"🔍 Rows returned: {rows}")
        except Exception as e:
            print(f"⚠️  Supabase medication_plans fetch error ({e}) — falling back to local data")
            rows = None

    if rows is None:
        rows = local_data.get("medication_plans", {}).get(str(patient_id), [])
        print(f"🔍 Using local medication plan rows: {rows}")

    chambers = []
    try:
        for row in rows:
            cell_value = row.get(timing_col, "")
            print(f"🔍 Chamber {row.get('chamber_id')} -> {timing_col}='{cell_value}' (need '{timing_val}')")
            if cell_value == timing_val:
                cid = int(row["chamber_id"])
                chambers.append(cid - 1)
    except Exception as e:
        log_event("error", f"medication_plans parse error: {e}")
        return []

    return chambers

# ====================== SERVO HELPERS ======================
def move_servo(servo_obj, chamber_index, target_angle, step=2, delay=0.02):
    current = servo_angles[chamber_index]

    if current < target_angle:
        angle_range = range(current, target_angle + 1, step)
    else:
        angle_range = range(current, target_angle - 1, -step)

    for angle in angle_range:
        duty = 2 + (angle / 18)
        servo_obj.ChangeDutyCycle(duty)
        time.sleep(delay)

    servo_obj.ChangeDutyCycle(2 + (target_angle / 18))
    time.sleep(0.05)
    servo_obj.ChangeDutyCycle(0)
    servo_angles[chamber_index] = target_angle

def open_chamber(chamber_index):
    move_servo(servos[chamber_index], chamber_index, OPEN_ANGLE)
    log_event("chamber_open", f"Chamber {chamber_index + 1} opened",
              chamber=chamber_index + 1)

def close_chamber(chamber_index):
    move_servo(servos[chamber_index], chamber_index, CLOSE_ANGLE)
    log_event("chamber_close", f"Chamber {chamber_index + 1} closed",
              chamber=chamber_index + 1)

def open_chambers(indices):
    """Open specified chambers (0-based) simultaneously."""
    threads = [threading.Thread(target=open_chamber, args=(i,)) for i in indices]
    for t in threads: t.start()
    for t in threads: t.join()

def close_chambers(indices):
    """Close specified chambers (0-based) simultaneously."""
    threads = [threading.Thread(target=close_chamber, args=(i,)) for i in indices]
    for t in threads: t.start()
    for t in threads: t.join()

# ====================== ULTRASONIC ======================
def get_distance():
    GPIO.output(TRIG, False)
    time.sleep(0.05)

    GPIO.output(TRIG, True)
    time.sleep(0.00001)from pyfingerprint.pyfingerprint import PyFingerprint
import RPi.GPIO as GPIO
import time
import threading
import json
import os
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ====================== OPTIONAL SUPABASE CONFIG ======================
# The system now works fully offline. If Supabase credentials are present
# and reachable, it will also sync logs/status/lookups to the cloud.
# If not, everything falls back to local files automatically.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

supabase = None
DB_ONLINE = False

def try_connect_supabase():
    """Attempt to connect to Supabase. Never raises — just leaves DB_ONLINE False on failure."""
    global supabase, DB_ONLINE
    if not SUPABASE_URL or not SUPABASE_KEY:
        supabase = None
        DB_ONLINE = False
        print("📴 SUPABASE_URL / SUPABASE_KEY not set — running in OFFLINE mode (local files only)")
        return
    try:
        from supabase import create_client, Client
        client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        # Lightweight connectivity check
        client.table("dispenser_status").select("id").limit(1).execute()
        supabase = client
        DB_ONLINE = True
        print("☁️  Supabase connected — running in online+local mode")
    except Exception as e:
        supabase = None
        DB_ONLINE = False
        print(f"📴 Supabase unavailable ({e}) — running in OFFLINE mode (local files only)")

try_connect_supabase()

# ====================== LOCAL DATA STORE ======================
# Used as the source of truth when offline, and as a fallback whenever
# a Supabase call fails mid-run. Edit local_data.json to match your
# patients / medication plans for offline use.
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DATA_FILE = os.path.join(LOCAL_DIR, "local_data.json")
LOCAL_LOG_FILE = os.path.join(LOCAL_DIR, "local_events.log")

DEFAULT_LOCAL_DATA = {
    "patients": {
        # fingerprint_id (as string) -> patient info
        "0": {"id": "local-patient-1", "name": "Patient One"}
    },
    "medication_plans": {
        # patient_id -> list of chamber rows (1-based chamber_id)
        "local-patient-1": [
            {"chamber_id": 1, "morning_timing": "Before", "afternoon_timing": "", "evening_timing": ""},
            {"chamber_id": 2, "morning_timing": "After",  "afternoon_timing": "Before", "evening_timing": ""},
            {"chamber_id": 3, "morning_timing": "", "afternoon_timing": "After", "evening_timing": "Before"}
        ]
    }
}

def load_local_data():
    if not os.path.exists(LOCAL_DATA_FILE):
        with open(LOCAL_DATA_FILE, "w") as f:
            json.dump(DEFAULT_LOCAL_DATA, f, indent=2)
        print(f"📄 Created default {LOCAL_DATA_FILE} — edit it with real patient/medication data")
        return DEFAULT_LOCAL_DATA
    try:
        with open(LOCAL_DATA_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️  Could not read {LOCAL_DATA_FILE} ({e}) — using built-in defaults")
        return DEFAULT_LOCAL_DATA

local_data = load_local_data()

def local_log(line):
    try:
        with open(LOCAL_LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception as e:
        print(f"⚠️  Could not write local log: {e}")

# ====================== GPIO PINS ======================
TRIG = 23
ECHO = 24

SERVO_PIN_1 = 18   # Chamber 1
SERVO_PIN_2 = 12   # Chamber 2
SERVO_PIN_3 = 13   # Chamber 3

# ====================== SERVO ANGLES ======================
OPEN_ANGLE  = 0
CLOSE_ANGLE = 90

# ====================== TIME WINDOWS ======================
# (start_h, start_m, end_h, end_m, timing_col, timing_val)
TIME_WINDOWS = [
    (8,  30,  9,  0,  "morning_timing",   "Before"),   # 08:30 - 09:00
    (10,  0, 12, 30,  "morning_timing",   "After"),    # 10:00 - 10:30
    (12, 30, 14,  0,  "afternoon_timing", "Before"),   # 12:30 - 13:00
    (14,  0, 16, 30,  "afternoon_timing", "After"),    # 14:00 - 14:30
    (19,  0, 19, 30,  "evening_timing",   "Before"),   # 19:00 - 19:30
    (20, 30, 21,  0,  "evening_timing",   "After"),    # 20:30 - 21:00
]

# ====================== GPIO SETUP ======================
GPIO.setmode(GPIO.BCM)
GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

for pin in [SERVO_PIN_1, SERVO_PIN_2, SERVO_PIN_3]:
    GPIO.setup(pin, GPIO.OUT)

servo1 = GPIO.PWM(SERVO_PIN_1, 50)
servo2 = GPIO.PWM(SERVO_PIN_2, 50)
servo3 = GPIO.PWM(SERVO_PIN_3, 50)

servos = [servo1, servo2, servo3]
servo_angles = [CLOSE_ANGLE, CLOSE_ANGLE, CLOSE_ANGLE]

for s in servos:
    s.start(0)

# ====================== GLOBAL PATIENT STATE ======================
current_patient_id     = None
current_patient_name   = None
current_fingerprint_id = None

# ====================== SUPABASE HELPERS (all safe / non-blocking) ======================
def _supabase_insert(payload):
    if not DB_ONLINE:
        return
    try:
        supabase.table("medicine_logs").insert(payload).execute()
    except Exception as e:
        print(f"⚠️  Supabase log error: {e}")

def _supabase_update(payload):
    if not DB_ONLINE:
        return
    try:
        supabase.table("dispenser_status").update(payload).eq("id", 1).execute()
    except Exception as e:
        print(f"⚠️  Supabase status error: {e}")

def log_event(event_type, message, distance=None, chamber=None):
    timestamp = datetime.utcnow().isoformat()
    payload = {
        "event_type": event_type,
        "message": message,
        "distance": distance,
        "timestamp": timestamp
    }
    # Always log locally so nothing is lost when offline
    local_log(f"{timestamp} | {event_type} | {message} | distance={distance} | chamber={chamber}")
    if DB_ONLINE:
        threading.Thread(target=_supabase_insert, args=(payload,), daemon=True).start()
    prefix = f"[Chamber {chamber}] " if chamber is not None else ""
    print(f"📝 {prefix}{message}")

def update_status(status):
    timestamp = datetime.utcnow().isoformat()
    payload = {
        "status": status,
        "last_updated": timestamp
    }
    local_log(f"{timestamp} | STATUS | {status}")
    if DB_ONLINE:
        threading.Thread(target=_supabase_update, args=(payload,), daemon=True).start()
    print(f"📊 Status: {status}")

def push_fingerprint_event(fp_id):
    if not DB_ONLINE:
        return

    def _push():
        try:
            supabase.table("dispenser_events").insert({
                "fingerprint_id": fp_id
            }).execute()
        except Exception as e:
            print(f"⚠️  Fingerprint event error: {e}")
    threading.Thread(target=_push, daemon=True).start()

def get_patient_from_fingerprint(fp_id):
    """
    Tries Supabase first (if online); falls back to local_data.json
    if Supabase is unavailable or the lookup fails for any reason.
    """
    global current_patient_id, current_patient_name, current_fingerprint_id

    if DB_ONLINE:
        try:
            res = supabase.table("users") \
                .select("id, name") \
                .eq("fingerprint_id", fp_id) \
                .eq("role", "PATIENT") \
                .single() \
                .execute()

            data: dict = res.data  # type: ignore[assignment]
            current_patient_id     = data["id"]
            current_patient_name   = data["name"]
            current_fingerprint_id = fp_id

            log_event("patient_identified",
                      f"Patient identified: {current_patient_name}")
            return
        except Exception as e:
            print(f"⚠️  Supabase patient lookup failed ({e}) — falling back to local data")

    # --- Local fallback ---
    patient = local_data.get("patients", {}).get(str(fp_id))
    if patient:
        current_patient_id     = patient["id"]
        current_patient_name   = patient["name"]
        current_fingerprint_id = fp_id
        log_event("patient_identified",
                  f"Patient identified (local): {current_patient_name}")
    else:
        current_patient_id = current_patient_name = current_fingerprint_id = None
        log_event("error", f"Patient mapping failed for fingerprint {fp_id} (no local match)")

# ====================== TIME WINDOW DETECTION ======================
def get_current_window():
    """
    Returns (timing_col, timing_val, period_label) for the active time window.
    Returns None if outside all windows.
    """
    now = datetime.now()
    current_minutes = now.hour * 60 + now.minute

    for (sh, sm, eh, em, col, val) in TIME_WINDOWS:
        start = sh * 60 + sm
        end   = eh * 60 + em
        if start <= current_minutes < end:
            period_label = col.replace("_timing", "").capitalize()
            return (col, val, period_label)

    return None

# ====================== MEDICATION PLAN LOOKUP ======================
def get_chambers_to_open(patient_id, timing_col, timing_val):
    """
    Queries medication_plans for the patient (Supabase if online, else
    local_data.json). Returns a list of 0-based chamber indices whose
    timing_col == timing_val. Returns [] if none match or on error.
    """
    if patient_id is None:
        return []

    rows = None

    if DB_ONLINE:
        try:
            print(f"🔍 Querying medication_plans: patient_id={patient_id}, col={timing_col}, val={timing_val}")
            res = supabase.table("medication_plans") \
                .select("chamber_id, morning_timing, afternoon_timing, evening_timing") \
                .eq("patient_id", patient_id) \
                .execute()
            rows = res.data  # type: ignore[assignment]
            print(f"🔍 Rows returned: {rows}")
        except Exception as e:
            print(f"⚠️  Supabase medication_plans fetch error ({e}) — falling back to local data")
            rows = None

    if rows is None:
        rows = local_data.get("medication_plans", {}).get(str(patient_id), [])
        print(f"🔍 Using local medication plan rows: {rows}")

    chambers = []
    try:
        for row in rows:
            cell_value = row.get(timing_col, "")
            print(f"🔍 Chamber {row.get('chamber_id')} -> {timing_col}='{cell_value}' (need '{timing_val}')")
            if cell_value == timing_val:
                cid = int(row["chamber_id"])
                chambers.append(cid - 1)
    except Exception as e:
        log_event("error", f"medication_plans parse error: {e}")
        return []

    return chambers

# ====================== SERVO HELPERS ======================
def move_servo(servo_obj, chamber_index, target_angle, step=2, delay=0.02):
    current = servo_angles[chamber_index]

    if current < target_angle:
        angle_range = range(current, target_angle + 1, step)
    else:
        angle_range = range(current, target_angle - 1, -step)

    for angle in angle_range:
        duty = 2 + (angle / 18)
        servo_obj.ChangeDutyCycle(duty)
        time.sleep(delay)

    servo_obj.ChangeDutyCycle(2 + (target_angle / 18))
    time.sleep(0.05)
    servo_obj.ChangeDutyCycle(0)
    servo_angles[chamber_index] = target_angle

def open_chamber(chamber_index):
    move_servo(servos[chamber_index], chamber_index, OPEN_ANGLE)
    log_event("chamber_open", f"Chamber {chamber_index + 1} opened",
              chamber=chamber_index + 1)

def close_chamber(chamber_index):
    move_servo(servos[chamber_index], chamber_index, CLOSE_ANGLE)
    log_event("chamber_close", f"Chamber {chamber_index + 1} closed",
              chamber=chamber_index + 1)

def open_chambers(indices):
    """Open specified chambers (0-based) simultaneously."""
    threads = [threading.Thread(target=open_chamber, args=(i,)) for i in indices]
    for t in threads: t.start()
    for t in threads: t.join()

def close_chambers(indices):
    """Close specified chambers (0-based) simultaneously."""
    threads = [threading.Thread(target=close_chamber, args=(i,)) for i in indices]
    for t in threads: t.start()
    for t in threads: t.join()

# ====================== ULTRASONIC ======================
def get_distance():
    GPIO.output(TRIG, False)
    time.sleep(0.05)

    GPIO.output(TRIG, True)
    time.sleep(0.00001)
    GPIO.output(TRIG, False)

    timeout = time.time() + 0.04

    pulse_start = time.time()
    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
        if time.time() > timeout:
            return 999

    pulse_end = time.time()
    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
        if time.time() > timeout:
            return 999

    return round((pulse_end - pulse_start) * 17150, 2)

# ====================== HAND DETECTION ======================
def wait_for_hand_n_times(n=2, threshold=10, close_delay=3):
    count = 0
    hand_present = False
    update_status("waiting_for_hand")

    while count < n:
        d = get_distance()
        print(f"📡 Distance: {d} cm")

        if d < threshold and not hand_present:
            count += 1
            hand_present = True
            log_event("hand_detected",
                      f"Hand detected ({count}/{n})",
                      distance=d)

            if count == n:
                time.sleep(close_delay)

            time.sleep(1)

        elif d >= threshold:
            hand_present = False

        time.sleep(0.2)

# ====================== FINGERPRINT AUTH ======================
def authenticate_user():
    try:
        f = PyFingerprint('/dev/ttyS0', 57600, 0xFFFFFFFF, 0x00000000)
        if not f.verifyPassword():
            raise Exception("Fingerprint password error")
    except Exception as e:
        log_event("error", str(e))
        return False

    update_status("waiting_for_fingerprint")
    log_event("ready", "Waiting for fingerprint")

    while True:
        if f.readImage():
            f.convertImage(0x01)
            position = f.searchTemplate()[0]

            if position >= 0:
                log_event("authenticated",
                          f"Fingerprint authenticated (ID {position})")
                push_fingerprint_event(position)
                get_patient_from_fingerprint(position)
                return True
            else:
                log_event("auth_failed", "Unauthorized fingerprint")
                time.sleep(2)

# ====================== DISPENSING LOGIC ======================
def dispense_cycle():
    time.sleep(0.5)   # Brief pause after auth

    if current_patient_id is None:
        print("🚫 No patient identified — cannot dispense")
        log_event("no_patient", "Dispense attempted with no identified patient")
        return

    # --- Check which time window we are in ---
    window = get_current_window()
    if window is None:
        print("⏰ Outside dispensing hours — no chambers opened")
        log_event("out_of_window", "Authentication outside dispensing hours")
        return

    timing_col, timing_val, period_label = window
    print(f"⏰ Window matched: {period_label} {timing_val}")

    # --- Fetch which chambers to open for this patient & window ---
    chambers = get_chambers_to_open(current_patient_id, timing_col, timing_val)

    if not chambers:
        print(f"💊 No chambers assigned for {period_label} {timing_val}")
        log_event("no_chambers",
                  f"No chambers for {period_label} {timing_val} — nothing dispensed")
        return

    print(f"💊 Opening chamber(s): {[c + 1 for c in chambers]}")
    log_event("dispensing",
              f"Opening chamber(s) {[c+1 for c in chambers]} — {period_label} {timing_val}")
    update_status("dispensing")

    open_chambers(chambers)

    wait_for_hand_n_times(n=2, close_delay=3)

    log_event("closing", f"Closing chamber(s) {[c+1 for c in chambers]}")
    close_chambers(chambers)

    update_status("idle")
    log_event("complete", "Dispensing cycle complete")

# ====================== MAIN LOOP ======================
try:
    update_status("idle")
    log_event("startup",
              f"System started — 3 chambers active ({'ONLINE' if DB_ONLINE else 'OFFLINE'} mode)")

    while True:
        if authenticate_user():
            dispense_cycle()
            time.sleep(2)

except KeyboardInterrupt:
    log_event("shutdown", "System stopped")

finally:
    for s in servos:
        s.stop()
    GPIO.cleanup()
    GPIO.output(TRIG, False)

    timeout = time.time() + 0.04

    pulse_start = time.time()
    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
        if time.time() > timeout:
            return 999

    pulse_end = time.time()
    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
        if time.time() > timeout:
            return 999

    return round((pulse_end - pulse_start) * 17150, 2)

# ====================== HAND DETECTION ======================
def wait_for_hand_n_times(n=2, threshold=10, close_delay=3):
    count = 0
    hand_present = False
    update_status("waiting_for_hand")

    while count < n:
        d = get_distance()
        print(f"📡 Distance: {d} cm")

        if d < threshold and not hand_present:
            count += 1
            hand_present = True
            log_event("hand_detected",
                      f"Hand detected ({count}/{n})",
                      distance=d)

            if count == n:
                time.sleep(close_delay)

            time.sleep(1)

        elif d >= threshold:
            hand_present = False

        time.sleep(0.2)

# ====================== FINGERPRINT AUTH ======================
def authenticate_user():
    try:
        f = PyFingerprint('/dev/ttyS0', 57600, 0xFFFFFFFF, 0x00000000)
        if not f.verifyPassword():
            raise Exception("Fingerprint password error")
    except Exception as e:
        log_event("error", str(e))
        return False

    update_status("waiting_for_fingerprint")
    log_event("ready", "Waiting for fingerprint")

    while True:
        if f.readImage():
            f.convertImage(0x01)
            position = f.searchTemplate()[0]

            if position >= 0:
                log_event("authenticated",
                          f"Fingerprint authenticated (ID {position})")
                push_fingerprint_event(position)
                get_patient_from_fingerprint(position)
                return True
            else:
                log_event("auth_failed", "Unauthorized fingerprint")
                time.sleep(2)

# ====================== DISPENSING LOGIC ======================
def dispense_cycle():
    time.sleep(0.5)   # Brief pause after auth

    if current_patient_id is None:
        print("🚫 No patient identified — cannot dispense")
        log_event("no_patient", "Dispense attempted with no identified patient")
        return

    # --- Check which time window we are in ---
    window = get_current_window()
    if window is None:
        print("⏰ Outside dispensing hours — no chambers opened")
        log_event("out_of_window", "Authentication outside dispensing hours")
        return

    timing_col, timing_val, period_label = window
    print(f"⏰ Window matched: {period_label} {timing_val}")

    # --- Fetch which chambers to open for this patient & window ---
    chambers = get_chambers_to_open(current_patient_id, timing_col, timing_val)

    if not chambers:
        print(f"💊 No chambers from pyfingerprint.pyfingerprint import PyFingerprint
import RPi.GPIO as GPIO
import time
import threading
import json
import os
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ====================== OPTIONAL SUPABASE CONFIG ======================
# The system now works fully offline. If Supabase credentials are present
# and reachable, it will also sync logs/status/lookups to the cloud.
# If not, everything falls back to local files automatically.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

supabase = None
DB_ONLINE = False

def try_connect_supabase():
    """Attempt to connect to Supabase. Never raises — just leaves DB_ONLINE False on failure."""
    global supabase, DB_ONLINE
    if not SUPABASE_URL or not SUPABASE_KEY:
        supabase = None
        DB_ONLINE = False
        print("📴 SUPABASE_URL / SUPABASE_KEY not set — running in OFFLINE mode (local files only)")
        return
    try:
        from supabase import create_client, Client
        client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        # Lightweight connectivity check
        client.table("dispenser_status").select("id").limit(1).execute()
        supabase = client
        DB_ONLINE = True
        print("☁️  Supabase connected — running in online+local mode")
    except Exception as e:
        supabase = None
        DB_ONLINE = False
        print(f"📴 Supabase unavailable ({e}) — running in OFFLINE mode (local files only)")

try_connect_supabase()

# ====================== LOCAL DATA STORE ======================
# Used as the source of truth when offline, and as a fallback whenever
# a Supabase call fails mid-run. Edit local_data.json to match your
# patients / medication plans for offline use.
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DATA_FILE = os.path.join(LOCAL_DIR, "local_data.json")
LOCAL_LOG_FILE = os.path.join(LOCAL_DIR, "local_events.log")

DEFAULT_LOCAL_DATA = {
    "patients": {
        # fingerprint_id (as string) -> patient info
        "0": {"id": "local-patient-1", "name": "Patient One"}
    },
    "medication_plans": {
        # patient_id -> list of chamber rows (1-based chamber_id)
        "local-patient-1": [
            {"chamber_id": 1, "morning_timing": "Before", "afternoon_timing": "", "evening_timing": ""},
            {"chamber_id": 2, "morning_timing": "After",  "afternoon_timing": "Before", "evening_timing": ""},
            {"chamber_id": 3, "morning_timing": "", "afternoon_timing": "After", "evening_timing": "Before"}
        ]
    }
}

def load_local_data():
    if not os.path.exists(LOCAL_DATA_FILE):
        with open(LOCAL_DATA_FILE, "w") as f:
            json.dump(DEFAULT_LOCAL_DATA, f, indent=2)
        print(f"📄 Created default {LOCAL_DATA_FILE} — edit it with real patient/medication data")
        return DEFAULT_LOCAL_DATA
    try:
        with open(LOCAL_DATA_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️  Could not read {LOCAL_DATA_FILE} ({e}) — using built-in defaults")
        return DEFAULT_LOCAL_DATA

local_data = load_local_data()

def local_log(line):
    try:
        with open(LOCAL_LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception as e:
        print(f"⚠️  Could not write local log: {e}")

# ====================== GPIO PINS ======================
TRIG = 23
ECHO = 24

SERVO_PIN_1 = 18   # Chamber 1
SERVO_PIN_2 = 12   # Chamber 2
SERVO_PIN_3 = 13   # Chamber 3

# ====================== SERVO ANGLES ======================
OPEN_ANGLE  = 0
CLOSE_ANGLE = 90

# ====================== TIME WINDOWS ======================
# (start_h, start_m, end_h, end_m, timing_col, timing_val)
TIME_WINDOWS = [
    (8,  30,  9,  0,  "morning_timing",   "Before"),   # 08:30 - 09:00
    (10,  0, 12, 30,  "morning_timing",   "After"),    # 10:00 - 10:30
    (12, 30, 14,  0,  "afternoon_timing", "Before"),   # 12:30 - 13:00
    (14,  0, 16, 30,  "afternoon_timing", "After"),    # 14:00 - 14:30
    (19,  0, 19, 30,  "evening_timing",   "Before"),   # 19:00 - 19:30
    (20, 30, 21,  0,  "evening_timing",   "After"),    # 20:30 - 21:00
]

# ====================== GPIO SETUP ======================
GPIO.setmode(GPIO.BCM)
GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

for pin in [SERVO_PIN_1, SERVO_PIN_2, SERVO_PIN_3]:
    GPIO.setup(pin, GPIO.OUT)

servo1 = GPIO.PWM(SERVO_PIN_1, 50)
servo2 = GPIO.PWM(SERVO_PIN_2, 50)
servo3 = GPIO.PWM(SERVO_PIN_3, 50)

servos = [servo1, servo2, servo3]
servo_angles = [CLOSE_ANGLE, CLOSE_ANGLE, CLOSE_ANGLE]

for s in servos:
    s.start(0)

# ====================== GLOBAL PATIENT STATE ======================
current_patient_id     = None
current_patient_name   = None
current_fingerprint_id = None

# ====================== SUPABASE HELPERS (all safe / non-blocking) ======================
def _supabase_insert(payload):
    if not DB_ONLINE:
        return
    try:
        supabase.table("medicine_logs").insert(payload).execute()
    except Exception as e:
        print(f"⚠️  Supabase log error: {e}")

def _supabase_update(payload):
    if not DB_ONLINE:
        return
    try:
        supabase.table("dispenser_status").update(payload).eq("id", 1).execute()
    except Exception as e:
        print(f"⚠️  Supabase status error: {e}")

def log_event(event_type, message, distance=None, chamber=None):
    timestamp = datetime.utcnow().isoformat()
    payload = {
        "event_type": event_type,
        "message": message,
        "distance": distance,
        "timestamp": timestamp
    }
    # Always log locally so nothing is lost when offline
    local_log(f"{timestamp} | {event_type} | {message} | distance={distance} | chamber={chamber}")
    if DB_ONLINE:
        threading.Thread(target=_supabase_insert, args=(payload,), daemon=True).start()
    prefix = f"[Chamber {chamber}] " if chamber is not None else ""
    print(f"📝 {prefix}{message}")

def update_status(status):
    timestamp = datetime.utcnow().isoformat()
    payload = {
        "status": status,
        "last_updated": timestamp
    }
    local_log(f"{timestamp} | STATUS | {status}")
    if DB_ONLINE:
        threading.Thread(target=_supabase_update, args=(payload,), daemon=True).start()
    print(f"📊 Status: {status}")

def push_fingerprint_event(fp_id):
    if not DB_ONLINE:
        return

    def _push():
        try:
            supabase.table("dispenser_events").insert({
                "fingerprint_id": fp_id
            }).execute()
        except Exception as e:
            print(f"⚠️  Fingerprint event error: {e}")
    threading.Thread(target=_push, daemon=True).start()

def get_patient_from_fingerprint(fp_id):
    """
    Tries Supabase first (if online); falls back to local_data.json
    if Supabase is unavailable or the lookup fails for any reason.
    """
    global current_patient_id, current_patient_name, current_fingerprint_id

    if DB_ONLINE:
        try:
            res = supabase.table("users") \
                .select("id, name") \
                .eq("fingerprint_id", fp_id) \
                .eq("role", "PATIENT") \
                .single() \
                .execute()

            data: dict = res.data  # type: ignore[assignment]
            current_patient_id     = data["id"]
            current_patient_name   = data["name"]
            current_fingerprint_id = fp_id

            log_event("patient_identified",
                      f"Patient identified: {current_patient_name}")
            return
        except Exception as e:
            print(f"⚠️  Supabase patient lookup failed ({e}) — falling back to local data")

    # --- Local fallback ---
    patient = local_data.get("patients", {}).get(str(fp_id))
    if patient:
        current_patient_id     = patient["id"]
        current_patient_name   = patient["name"]
        current_fingerprint_id = fp_id
        log_event("patient_identified",
                  f"Patient identified (local): {current_patient_name}")
    else:
        current_patient_id = current_patient_name = current_fingerprint_id = None
        log_event("error", f"Patient mapping failed for fingerprint {fp_id} (no local match)")

# ====================== TIME WINDOW DETECTION ======================
def get_current_window():
    """
    Returns (timing_col, timing_val, period_label) for the active time window.
    Returns None if outside all windows.
    """
    now = datetime.now()
    current_minutes = now.hour * 60 + now.minute

    for (sh, sm, eh, em, col, val) in TIME_WINDOWS:
        start = sh * 60 + sm
        end   = eh * 60 + em
        if start <= current_minutes < end:
            period_label = col.replace("_timing", "").capitalize()
            return (col, val, period_label)

    return None

# ====================== MEDICATION PLAN LOOKUP ======================
def get_chambers_to_open(patient_id, timing_col, timing_val):
    """
    Queries medication_plans for the patient (Supabase if online, else
    local_data.json). Returns a list of 0-based chamber indices whose
    timing_col == timing_val. Returns [] if none match or on error.
    """
    if patient_id is None:
        return []

    rows = None

    if DB_ONLINE:
        try:
            print(f"🔍 Querying medication_plans: patient_id={patient_id}, col={timing_col}, val={timing_val}")
            res = supabase.table("medication_plans") \
                .select("chamber_id, morning_timing, afternoon_timing, evening_timing") \
                .eq("patient_id", patient_id) \
                .execute()
            rows = res.data  # type: ignore[assignment]
            print(f"🔍 Rows returned: {rows}")
        except Exception as e:
            print(f"⚠️  Supabase medication_plans fetch error ({e}) — falling back to local data")
            rows = None

    if rows is None:
        rows = local_data.get("medication_plans", {}).get(str(patient_id), [])
        print(f"🔍 Using local medication plan rows: {rows}")

    chambers = []
    try:
        for row in rows:
            cell_value = row.get(timing_col, "")
            print(f"🔍 Chamber {row.get('chamber_id')} -> {timing_col}='{cell_value}' (need '{timing_val}')")
            if cell_value == timing_val:
                cid = int(row["chamber_id"])
                chambers.append(cid - 1)
    except Exception as e:
        log_event("error", f"medication_plans parse error: {e}")
        return []

    return chambers

# ====================== SERVO HELPERS ======================
def move_servo(servo_obj, chamber_index, target_angle, step=2, delay=0.02):
    current = servo_angles[chamber_index]

    if current < target_angle:
        angle_range = range(current, target_angle + 1, step)
    else:
        angle_range = range(current, target_angle - 1, -step)

    for angle in angle_range:
        duty = 2 + (angle / 18)
        servo_obj.ChangeDutyCycle(duty)
        time.sleep(delay)

    servo_obj.ChangeDutyCycle(2 + (target_angle / 18))
    time.sleep(0.05)
    servo_obj.ChangeDutyCycle(0)
    servo_angles[chamber_index] = target_angle

def open_chamber(chamber_index):
    move_servo(servos[chamber_index], chamber_index, OPEN_ANGLE)
    log_event("chamber_open", f"Chamber {chamber_index + 1} opened",
              chamber=chamber_index + 1)

def close_chamber(chamber_index):
    move_servo(servos[chamber_index], chamber_index, CLOSE_ANGLE)
    log_event("chamber_close", f"Chamber {chamber_index + 1} closed",
              chamber=chamber_index + 1)

def open_chambers(indices):
    """Open specified chambers (0-based) simultaneously."""
    threads = [threading.Thread(target=open_chamber, args=(i,)) for i in indices]
    for t in threads: t.start()
    for t in threads: t.join()

def close_chambers(indices):
    """Close specified chambers (0-based) simultaneously."""
    threads = [threading.Thread(target=close_chamber, args=(i,)) for i in indices]
    for t in threads: t.start()
    for t in threads: t.join()

# ====================== ULTRASONIC ======================
def get_distance():
    GPIO.output(TRIG, False)
    time.sleep(0.05)

    GPIO.output(TRIG, True)
    time.sleep(0.00001)
    GPIO.output(TRIG, False)

    timeout = time.time() + 0.04

    pulse_start = time.time()
    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
        if time.time() > timeout:
            return 999

    pulse_end = time.time()
    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
        if time.time() > timeout:
            return 999

    return round((pulse_end - pulse_start) * 17150, 2)

# ====================== HAND DETECTION ======================
def wait_for_hand_n_times(n=2, threshold=10, close_delay=3):
    count = 0
    hand_present = False
    update_status("waiting_for_hand")

    while count < n:
        d = get_distance()
        print(f"📡 Distance: {d} cm")

        if d < threshold and not hand_present:
            count += 1
            hand_present = True
            log_event("hand_detected",
                      f"Hand detected ({count}/{n})",
                      distance=d)

            if count == n:
                time.sleep(close_delay)

            time.sleep(1)

        elif d >= threshold:
            hand_present = False

        time.sleep(0.2)

# ====================== FINGERPRINT AUTH ======================
def authenticate_user():
    try:
        f = PyFingerprint('/dev/ttyS0', 57600, 0xFFFFFFFF, 0x00000000)
        if not f.verifyPassword():
            raise Exception("Fingerprint password error")
    except Exception as e:
        log_event("error", str(e))
        return False

    update_status("waiting_for_fingerprint")
    log_event("ready", "Waiting for fingerprint")

    while True:
        if f.readImage():
            f.convertImage(0x01)
            position = f.searchTemplate()[0]

            if position >= 0:
                log_event("authenticated",
                          f"Fingerprint authenticated (ID {position})")
                push_fingerprint_event(position)
                get_patient_from_fingerprint(position)
                return True
            else:
                log_event("auth_failed", "Unauthorized fingerprint")
                time.sleep(2)

# ====================== DISPENSING LOGIC ======================
def dispense_cycle():
    time.sleep(0.5)   # Brief pause after auth

    if current_patient_id is None:
        print("🚫 No patient identified — cannot dispense")
        log_event("no_patient", "Dispense attempted with no identified patient")
        return

    # --- Check which time window we are in ---
    window = get_current_window()
    if window is None:
        print("⏰ Outside dispensing hours — no chambers opened")
        log_event("out_of_window", "Authentication outside dispensing hours")
        return

    timing_col, timing_val, period_label = window
    print(f"⏰ Window matched: {period_label} {timing_val}")

    # --- Fetch which chambers to open for this patient & window ---
    chambers = get_chambers_to_open(current_patient_id, timing_col, timing_val)

    if not chambers:
        print(f"💊 No chambers assigned for {period_label} {timing_val}")
        log_event("no_chambers",
                  f"No chambers for {period_label} {timing_val} — nothing dispensed")
        return

    print(f"💊 Opening chamber(s): {[c + 1 for c in chambers]}")
    log_event("dispensing",
              f"Opening chamber(s) {[c+1 for c in chambers]} — {period_label} {timing_val}")
    update_status("dispensing")

    open_chambers(chambers)

    wait_for_hand_n_times(n=2, close_delay=3)

    log_event("closing", f"Closing chamber(s) {[c+1 for c in chambers]}")
    close_chambers(chambers)

    update_status("idle")
    log_event("complete", "Dispensing cycle complete")

# ====================== MAIN LOOP ======================
try:
    update_status("idle")
    log_event("startup",
              f"System started — 3 chambers active ({'ONLINE' if DB_ONLINE else 'OFFLINE'} mode)")

    while True:
        if authenticate_user():
            dispense_cycle()
            time.sleep(2)

except KeyboardInterrupt:
    log_event("shutdown", "System stopped")

finally:
    for s in servos:
        s.stop()
    GPIO.cleanup()assigned for {period_label} {timing_val}")
        log_event("no_chambers",
                  f"No chambers for {period_label} {timing_val} — nothing dispensed")
        return

    print(f"💊 Opening chamber(s): {[c + 1 for c in chambers]}")
    log_event("dispensing",
              f"Opening chamber(s) {[c+1 for c in chambers]} — {period_label} {timing_val}")
    update_status("dispensing")

    open_chambers(chambers)

    wait_for_hand_n_times(n=2, close_delay=3)

    log_event("closing", f"Closing chamber(s) {[c+1 for c in chambers]}")
    close_chambers(chambers)

    update_status("idle")
    log_event("complete", "Dispensing cycle complete")

# ====================== MAIN LOOP ======================
try:
    update_status("idle")
    log_event("startup",
              f"System started — 3 chambers active ({'ONLINE' if DB_ONLINE else 'OFFLINE'} mode)")

    while True:
        if authenticate_user():
            dispense_cycle()
            time.sleep(2)

except KeyboardInterrupt:
    log_event("shutdown", "System stopped")

finally:
    for s in servos:
        s.stop()
    GPIO.cleanup()
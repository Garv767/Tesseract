from pyfingerprint.pyfingerprint import PyFingerprint
import RPi.GPIO as GPIO
import time
import threading
from datetime import datetime, timezone
import db

# ====================== NEON POSTGRES CONFIG ======================
db.check_connection()

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

# ====================== NEON DB HELPERS ======================
def log_event(event_type, message, distance=None, chamber=None):
    ts = datetime.now(timezone.utc).isoformat()
    threading.Thread(
        target=db.insert_medicine_log,
        args=(event_type, message, distance, ts),
        daemon=True,
    ).start()
    prefix = f"[Chamber {chamber}] " if chamber is not None else ""
    print(f"📝 {prefix}{message}")

def update_status(status):
    ts = datetime.now(timezone.utc).isoformat()
    threading.Thread(
        target=db.update_dispenser_status,
        args=(status, ts),
        daemon=True,
    ).start()
    print(f"📊 Status: {status}")

def push_fingerprint_event(fp_id):
    threading.Thread(
        target=db.insert_dispenser_event,
        args=(fp_id,),
        daemon=True,
    ).start()

def get_patient_from_fingerprint(fp_id):
    global current_patient_id, current_patient_name, current_fingerprint_id
    if not db.is_configured():
        print(f"[OFFLINE] Cannot look up patient for fingerprint {fp_id}")
        return
    try:
        data = db.get_patient_by_fingerprint(fp_id)
        if not data:
            current_patient_id = current_patient_name = current_fingerprint_id = None
            log_event("error", f"No patient matched fingerprint ID {fp_id}")
            return
        current_patient_id     = str(data["id"])
        current_patient_name   = str(data["name"])
        current_fingerprint_id = fp_id

        log_event("patient_identified",
                  f"Patient identified: {current_patient_name}")
    except Exception:
        current_patient_id = current_patient_name = current_fingerprint_id = None
        log_event("error", "Patient mapping failed")

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
    Queries medication_plans for the patient.
    Returns a list of 0-based chamber indices whose timing_col == timing_val.
    Returns [] if none match or on error.
    """
    if not db.is_configured() or patient_id is None:
        return []
    try:
        print(f"🔍 Querying medication_plans: patient_id={patient_id}, col={timing_col}, val={timing_val}")

        rows = db.get_medication_plans(patient_id)
        print(f"🔍 Rows returned: {rows}")

        chambers = []
        for row in rows:
            cell_value = row.get(timing_col, "") or ""
            print(f"🔍 Chamber {row.get('chamber_id')} -> {timing_col}='{cell_value}' (need '{timing_val}')")
            if cell_value == timing_val:
                cid = int(row["chamber_id"])
                chambers.append(cid - 1)

        return chambers

    except Exception as e:
        log_event("error", f"medication_plans fetch error: {e}")
        return []

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
    log_event("startup", "System started — 3 chambers active")

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

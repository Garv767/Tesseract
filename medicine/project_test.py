import io
import sys
import time
import threading
from datetime import datetime, timezone
from typing import Optional

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, line_buffering=True)

from pyfingerprint.pyfingerprint import PyFingerprint
import RPi.GPIO as GPIO
from hx711 import HX711
import db

# ================================================================
# HELPER — timezone-aware UTC timestamp (no deprecation warning)
# ================================================================
def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()

# ================================================================
# NEON POSTGRES CONFIG (reads DATABASE_URL from .env via stdlib)
# ================================================================
db.check_connection()

# ================================================================
# GPIO PIN ASSIGNMENTS
# ================================================================
TRIG        = 23
ECHO        = 24
SERVO_PIN_1 = 18
SERVO_PIN_2 = 12
SERVO_PIN_3 = 13

HX711_PINS = [
    (5,  6),
    (19, 26),
    (20, 21),
]

CALIBRATION_FACTORS = [
    -7050.0,
    -7050.0,
    -7050.0,
]

# ================================================================
# SERVO ANGLES — adjust per chamber if mounting differs
# ================================================================
OPEN_ANGLES  = [0,  0,  0 ]
CLOSE_ANGLES = [90, 90, 90]

# ================================================================
# HAND DETECTION THRESHOLDS (cm) — one per chamber
# ================================================================
HAND_THRESHOLDS = [20.0, 40.0, 60.0]

# ================================================================
# TIME WINDOWS
# ================================================================
TIME_WINDOWS = [
    (8,  30,  9,  0,  "morning_timing",   "Before"),
    (10,  0, 12, 30,  "morning_timing",   "After"),
    (12, 30, 13,  0,  "afternoon_timing", "Before"),
    (14,  0, 18, 30,  "afternoon_timing", "After"),
    (19,  0, 19, 30,  "evening_timing",   "Before"),
    (20, 30, 21,  0,  "evening_timing",   "After"),
]

# ================================================================
# GPIO SETUP
# ================================================================
GPIO.setmode(GPIO.BCM)
GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

for _pin in [SERVO_PIN_1, SERVO_PIN_2, SERVO_PIN_3]:
    GPIO.setup(_pin, GPIO.OUT)

servo1 = GPIO.PWM(SERVO_PIN_1, 50)
servo2 = GPIO.PWM(SERVO_PIN_2, 50)
servo3 = GPIO.PWM(SERVO_PIN_3, 50)

SERVOS: list       = [servo1, servo2, servo3]
servo_angles: list = list(CLOSE_ANGLES)

for _s in SERVOS:
    _s.start(0)

print("[SETUP] GPIO and servos ready")

# ================================================================
# LOAD CELL SETUP
# ================================================================
hx_sensors: list = []

for _idx, (_dt, _sck) in enumerate(HX711_PINS):
    try:
        _hx = HX711(_dt, _sck)
        _hx.set_reading_format("MSB", "MSB")
        _hx.set_reference_unit(CALIBRATION_FACTORS[_idx])
        _hx.reset()
        _hx.tare()
        hx_sensors.append(_hx)
        print(f"[SETUP] Load cell {_idx + 1} ready and tared")
    except Exception as _e:
        hx_sensors.append(None)
        print(f"[WARN] Load cell {_idx + 1} failed to init: {_e}")

print("[SETUP] All load cells done")

# ================================================================
# GLOBAL PATIENT STATE
# ================================================================
current_patient_id:     Optional[str] = None
current_patient_name:   Optional[str] = None
current_fingerprint_id: Optional[int] = None

# ================================================================
# NEON DB HELPERS
# ================================================================
def _db_insert(table: str, payload: dict) -> None:
    if table == "weight_logs":
        db.insert_weight_log(payload)
    elif table == "consumption_logs":
        db.insert_consumption_log(payload)
    elif table == "medicine_logs":
        db.insert_medicine_log(
            payload.get("event_type", ""),
            payload.get("message", ""),
            payload.get("distance"),
        )


def log_event(
    event_type: str,
    message: str,
    distance: Optional[float] = None,
    chamber: Optional[int] = None,
) -> None:
    """Print immediately, then insert into medicine_logs in background."""
    prefix = f"[Chamber {chamber}] " if chamber is not None else ""
    print(f"[LOG] {prefix}{message}")
    threading.Thread(
        target=db.insert_medicine_log,
        args=(event_type, message, distance),
        daemon=True,
    ).start()


def update_status(status: str) -> None:
    print(f"[STATUS] {status}")
    threading.Thread(
        target=db.update_dispenser_status,
        args=(status, utcnow()),
        daemon=True,
    ).start()


def push_fingerprint_event(fp_id: int) -> None:
    threading.Thread(
        target=db.insert_dispenser_event,
        args=(fp_id,),
        daemon=True,
    ).start()


def get_patient_from_fingerprint(fp_id: int) -> None:
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
    except Exception as exc:
        current_patient_id = current_patient_name = current_fingerprint_id = None
        log_event("error", f"Patient lookup failed: {exc}")


# ================================================================
# WEIGHT HELPERS
# Reduced to 3 samples with 1 internal ADC read each for speed.
# Increase samples/internal_reads if you need more accuracy.
# ================================================================
def read_weight_grams(chamber_idx: int, samples: int = 3) -> Optional[float]:
    """
    Fast weight read — 3 samples, 1 internal ADC read each, no sleep between.
    Returns average in grams, or None on error.
    """
    sensor = hx_sensors[chamber_idx]
    if sensor is None:
        print(f"[WARN] No load cell for Chamber {chamber_idx + 1}")
        return None
    try:
        readings: list = []
        for _ in range(samples):
            readings.append(float(sensor.get_weight(1)))  # 1 internal ADC sample
        avg = round(sum(readings) / len(readings), 2)
        print(f"[WEIGHT] Chamber {chamber_idx + 1}: {avg} g")
        return avg
    except Exception as exc:
        print(f"[WARN] Weight read error Chamber {chamber_idx + 1}: {exc}")
        return None


def snapshot_all_chambers(
    chamber_indices: list,
    snapshot_type: str,
    timing_col: str,
    timing_val: str,
    patient_id: Optional[str],
) -> dict:
    """
    Read all chambers in parallel threads.
    Returns {chamber_idx: weight_or_None}.
    DB inserts happen in background — does NOT block.
    """
    weights: dict = {}
    lock          = threading.Lock()
    period_label  = timing_col.replace("_timing", "")

    def _read_one(idx: int) -> None:
        weight = read_weight_grams(idx)
        with lock:
            weights[idx] = weight
        if weight is not None:
            payload = {
                "patient_id":    patient_id,
                "chamber_id":    idx + 1,
                "weight_grams":  weight,
                "snapshot_type": snapshot_type,
                "timing_period": period_label,
                "timing_slot":   timing_val,
                "fingerprint_id": current_fingerprint_id,
            }
            threading.Thread(
                target=_db_insert, args=("weight_logs", payload), daemon=True
            ).start()
            log_event(
                "weight_logged",
                f"[{snapshot_type.upper()}] Chamber {idx + 1}: {weight} g "
                f"({period_label} {timing_val})",
                chamber=idx + 1,
            )
        else:
            log_event("error",
                      f"Weight read failed — Chamber {idx + 1} ({snapshot_type})")

    threads = [
        threading.Thread(target=_read_one, args=(idx,), daemon=True)
        for idx in chamber_indices
    ]
    for t in threads: t.start()
    for t in threads: t.join()

    return weights


def calculate_consumption(
    pre: Optional[float], post: Optional[float]
) -> Optional[float]:
    if pre is None or post is None:
        return None
    return round(pre - post, 2)


# ================================================================
# TIME WINDOW DETECTION
# ================================================================
def get_current_window() -> Optional[tuple]:
    now     = datetime.now()
    minutes = now.hour * 60 + now.minute
    for (sh, sm, eh, em, col, val) in TIME_WINDOWS:
        if (sh * 60 + sm) <= minutes < (eh * 60 + em):
            return (col, val, col.replace("_timing", ""))
    return None


# ================================================================
# MEDICATION PLAN LOOKUP
# ================================================================
def get_chambers_to_open(
    patient_id: Optional[str], timing_col: str, timing_val: str
) -> list:
    if not db.is_configured() or patient_id is None:
        print("[OFFLINE] Cannot query medication_plans")
        return []
    try:
        print(f"[DB] Querying chambers for patient={patient_id} "
              f"{timing_col}={timing_val}")
        rows = db.get_medication_plans(patient_id)

        chambers: list = []
        for row in rows:
            cell = str(row.get(timing_col, "") or "")
            if cell == timing_val:
                chambers.append(int(row["chamber_id"]) - 1)

        print(f"[DB] Chambers matched: {[c + 1 for c in chambers]}")
        return chambers
    except Exception as exc:
        log_event("error", f"medication_plans query failed: {exc}")
        return []


# ================================================================
# SERVO HELPERS
# ================================================================
def move_servo(
    servo_obj: GPIO.PWM,
    chamber_idx: int,
    target_angle: int,
    step: int = 3,          # larger step = faster sweep
    delay: float = 0.015,   # shorter delay = faster sweep
) -> None:
    current = servo_angles[chamber_idx]
    angle_range = (
        range(current, target_angle + 1, step)
        if current < target_angle
        else range(current, target_angle - 1, -step)
    )
    for angle in angle_range:
        servo_obj.ChangeDutyCycle(2 + (angle / 18))
        time.sleep(delay)
    servo_obj.ChangeDutyCycle(2 + (target_angle / 18))
    time.sleep(0.04)
    servo_obj.ChangeDutyCycle(0)
    servo_angles[chamber_idx] = target_angle


def open_chamber(chamber_idx: int) -> None:
    target = OPEN_ANGLES[chamber_idx]
    move_servo(SERVOS[chamber_idx], chamber_idx, target)
    log_event("chamber_open",
              f"Chamber {chamber_idx + 1} opened to {target} deg",
              chamber=chamber_idx + 1)


def close_chamber(chamber_idx: int) -> None:
    target = CLOSE_ANGLES[chamber_idx]
    move_servo(SERVOS[chamber_idx], chamber_idx, target)
    log_event("chamber_close",
              f"Chamber {chamber_idx + 1} closed to {target} deg",
              chamber=chamber_idx + 1)


def open_chambers(indices: list) -> None:
    threads = [threading.Thread(target=open_chamber, args=(idx,))
               for idx in indices]
    for t in threads: t.start()
    for t in threads: t.join()


# ================================================================
# ULTRASONIC SENSOR
# ================================================================
def get_distance() -> float:
    GPIO.output(TRIG, False)
    time.sleep(0.02)          # shorter settle time
    GPIO.output(TRIG, True)
    time.sleep(0.00001)
    GPIO.output(TRIG, False)

    timeout     = time.time() + 0.04
    pulse_start = time.time()

    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
        if time.time() > timeout:
            return 999.0

    pulse_end = time.time()
    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
        if time.time() > timeout:
            return 999.0

    return round((pulse_end - pulse_start) * 17150, 2)


# ================================================================
# HAND DETECTION — per chamber, runs in its own thread
# ================================================================
def wait_and_close_chamber(chamber_idx: int,
                            n: int = 2,
                            close_delay: float = 3.0) -> None:
    """
    Wait for n hand detections within this chamber's distance threshold,
    then close the chamber. Designed to run in its own thread so multiple
    chambers work independently and in parallel.
    """
    threshold    = HAND_THRESHOLDS[chamber_idx]
    count        = 0
    hand_present = False

    print(f"[SENSOR] Chamber {chamber_idx + 1} waiting "
          f"(threshold {threshold} cm)")

    while count < n:
        dist = get_distance()
        print(f"[SENSOR] Ch{chamber_idx + 1}: {dist} cm")

        if dist < threshold and not hand_present:
            count       += 1
            hand_present = True
            log_event("hand_detected",
                      f"Chamber {chamber_idx + 1}: hand {count}/{n}",
                      distance=dist,
                      chamber=chamber_idx + 1)
            if count == n:
                time.sleep(close_delay)
            time.sleep(0.5)     # brief debounce
        elif dist >= threshold:
            hand_present = False

        time.sleep(0.15)        # polling interval

    close_chamber(chamber_idx)


# ================================================================
# FINGERPRINT AUTHENTICATION
# ================================================================
def authenticate_user() -> bool:
    try:
        reader = PyFingerprint('/dev/ttyS0', 57600, 0xFFFFFFFF, 0x00000000)
        if not reader.verifyPassword():
            raise ValueError("Fingerprint sensor password mismatch")
    except Exception as exc:
        log_event("error", f"Fingerprint sensor error: {exc}")
        return False

    update_status("waiting_for_fingerprint")
    log_event("ready", "Waiting for fingerprint...")

    while True:
        try:
            if reader.readImage():
                reader.convertImage(0x01)
                result   = reader.searchTemplate()
                position = int(result[0])

                if position >= 0:
                    log_event("authenticated",
                              f"Fingerprint authenticated (ID {position})")
                    push_fingerprint_event(position)
                    get_patient_from_fingerprint(position)
                    return True

                log_event("auth_failed", "Unrecognised fingerprint — try again")
                time.sleep(2)
        except Exception as exc:
            log_event("error", f"Fingerprint read error: {exc}")
            time.sleep(1)


# ================================================================
# DISPENSE CYCLE
# ================================================================
def dispense_cycle() -> None:

    # --- Time window check ---
    window = get_current_window()
    if window is None:
        print("[TIME] Outside dispensing hours — nothing dispensed")
        log_event("out_of_window", "Authentication outside dispensing hours")
        return

    timing_col, timing_val, period_label = window
    print(f"[TIME] Window: {period_label} {timing_val}")

    # --- Which chambers to open? ---
    chambers = get_chambers_to_open(current_patient_id, timing_col, timing_val)
    if not chambers:
        print(f"[INFO] No chambers for {period_label} {timing_val}")
        log_event("no_chambers", f"No chambers for {period_label} {timing_val}")
        return

    # ------------------------------------------------------------------
    # PRE-WEIGHT — instant, parallel across all relevant chambers
    # ------------------------------------------------------------------
    print("[WEIGHT] Taking PRE snapshot...")
    pre_weights = snapshot_all_chambers(
        chambers, "pre", timing_col, timing_val, current_patient_id
    )

    # ------------------------------------------------------------------
    # OPEN all chambers simultaneously
    # ------------------------------------------------------------------
    log_event("dispensing",
              f"Opening chambers {[c + 1 for c in chambers]} — "
              f"{period_label} {timing_val}")
    update_status("dispensing")
    open_chambers(chambers)

    # ------------------------------------------------------------------
    # Each chamber independently waits for hand then closes itself
    # ------------------------------------------------------------------
    dispense_threads = [
        threading.Thread(
            target=wait_and_close_chamber,
            args=(idx, 2, 3.0),
            daemon=False,
        )
        for idx in chambers
    ]
    for t in dispense_threads: t.start()
    for t in dispense_threads: t.join()   # wait until ALL chambers are closed

    log_event("closed", f"All chambers closed")

    # ------------------------------------------------------------------
    # POST-WEIGHT — instant, parallel, right after all chambers close
    # ------------------------------------------------------------------
    print("[WEIGHT] Taking POST snapshot...")
    post_weights = snapshot_all_chambers(
        chambers, "post", timing_col, timing_val, current_patient_id
    )

    # ------------------------------------------------------------------
    # CONSUMPTION REPORT
    # ------------------------------------------------------------------
    for chamber_idx in chambers:
        pre      = pre_weights.get(chamber_idx)
        post     = post_weights.get(chamber_idx)
        consumed = calculate_consumption(pre, post)

        if consumed is None:
            print(f"[CONSUMPTION] Chamber {chamber_idx + 1}: data unavailable")
            continue

        status_str = (
            "taken"     if consumed > 0 else
            "refilled"  if consumed < 0 else
            "no_change"
        )

        payload = {
            "patient_id":        current_patient_id,
            "chamber_id":        chamber_idx + 1,
            "pre_weight_grams":  pre,
            "post_weight_grams": post,
            "consumed_grams":    consumed,
            "status":            status_str,
            "timing_period":     period_label,
            "timing_slot":       timing_val,
            "fingerprint_id":    current_fingerprint_id,
        }
        threading.Thread(
            target=_db_insert, args=("consumption_logs", payload), daemon=True
        ).start()
        print(f"[CONSUMPTION] Chamber {chamber_idx + 1}: {consumed} g "
              f"(pre={pre} g  post={post} g)  [{status_str}]")
        log_event("consumption_logged",
                  f"Chamber {chamber_idx + 1}: {consumed} g — {status_str}",
                  chamber=chamber_idx + 1)

    update_status("idle")
    log_event("complete", "Dispensing cycle complete")


# ================================================================
# MAIN LOOP
# ================================================================
try:
    update_status("idle")
    log_event("startup", "System started — 3 chambers with weight sensors")

    while True:
        if authenticate_user():
            dispense_cycle()
            time.sleep(2)

except KeyboardInterrupt:
    log_event("shutdown", "System stopped by user")

finally:
    for _s in SERVOS:
        _s.stop()
    GPIO.cleanup()
    print("[EXIT] GPIO cleaned up")

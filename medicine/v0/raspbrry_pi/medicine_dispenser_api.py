from flask import Flask, request, jsonify
from pyfingerprint.pyfingerprint import PyFingerprint
import RPi.GPIO as GPIO
import time
from hx711 import HX711
import requests
import threading

app = Flask(__name__)

# ---------------------- GPIO Pins ----------------------
TRIG = 23
ECHO = 24
SERVO_PIN = 18

# ---------------------- Setup --------------------------
GPIO.setmode(GPIO.BCM)
GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)
GPIO.setup(SERVO_PIN, GPIO.PWM, frequency=50)

servo = GPIO.PWM(SERVO_PIN, 50)
servo.start(0)

hx = HX711(5, 6)
hx.set_reading_format("MSB", "MSB")
hx.set_reference_unit(6200)
hx.reset()
hx.tare()

BACKEND_URL = 'http://10.0.2.2:5000/api'
CURRENT_PATIENT_ID = None
CURRENT_MEDICINE_ID = None

# ---------------------- Helper Functions ----------------------
def set_servo(angle):
    duty = 2 + (angle / 18)
    servo.ChangeDutyCycle(duty)
    time.sleep(0.5)
    servo.ChangeDutyCycle(0)

def get_distance():
    GPIO.output(TRIG, False)
    time.sleep(0.05)
    GPIO.output(TRIG, True)
    time.sleep(0.00001)
    GPIO.output(TRIG, False)
    
    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
    
    duration = pulse_end - pulse_start
    distance = duration * 17150
    return round(distance, 2)

def wait_for_hand(threshold=10):
    print("Place hand near dispenser...")
    while True:
        d = get_distance()
        if d < threshold:
            print(f"Hand detected at {d} cm")
            return True
        time.sleep(0.2)

def wait_for_weight_increase(threshold=0.5):
    print("Waiting for medicine to be taken...")
    base_weight = hx.get_weight(5)
    while True:
        new_weight = hx.get_weight(5)
        if new_weight - base_weight > threshold:
            print("Medicine taken (weight increased).")
            return new_weight
        time.sleep(0.3)

def authenticate_user():
    try:
        f = PyFingerprint('/dev/ttyS0', 57600, 0xFFFFFFFF, 0x00000000)
        if not f.verifyPassword():
            raise ValueError('Fingerprint sensor password incorrect.')

    except Exception as e:
        print('Fingerprint sensor initialization failed:', str(e))
        return False

    print("System Ready. Place your finger for authentication.")

    while True:
        if f.readImage():
            f.convertImage(0x01)
            result = f.searchTemplate()
            positionNumber = result[0]

            if positionNumber >= 0:
                print("Authorized user detected.")
                return True
            else:
                print("Fingerprint not recognized!")
                time.sleep(2)

# ---------------------- Flask Routes ----------------------
@app.route('/api/dispense', methods=['POST'])
def dispense_medicine():
    global CURRENT_MEDICINE_ID
    data = request.get_json()
    
    medicine_id = data.get('medicine_id')
    patient_id = data.get('patient_id')
    
    CURRENT_MEDICINE_ID = medicine_id
    
    def dispense_process():
        if authenticate_user():
            wait_for_hand()
            print("Dispensing medicine...")
            set_servo(90)
            time.sleep(1)
            weight = wait_for_weight_increase()
            set_servo(0)
            
            # Notify backend
            requests.post(
                f'{BACKEND_URL}/raspi/medicine-taken',
                json={'medicine_id': medicine_id, 'weight': weight}
            )
            print("Dispenser closed. Cycle complete.")
    
    thread = threading.Thread(target=dispense_process)
    thread.start()
    
    return jsonify({'status': 'dispensing started'}), 200

@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify({
        'status': 'operational',
        'sensors': {
            'fingerprint': 'ready',
            'distance': f'{get_distance()} cm',
            'weight': 'ready'
        }
    }), 200

@app.route('/api/sensors/distance', methods=['GET'])
def get_distance_reading():
    return jsonify({'distance': get_distance()}), 200

@app.route('/api/sensors/weight', methods=['GET'])
def get_weight_reading():
    return jsonify({'weight': hx.get_weight(5)}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)

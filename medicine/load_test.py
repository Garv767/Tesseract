import sys
sys.path.append("/home/pi/hx711py")
from hx711 import HX711
import RPi.GPIO as GPIO
import time
import statistics

hx = HX711(5, 6)   # (dout, pd_sck)

hx.set_reading_format("MSB", "MSB")
hx.set_reference_unit(6200)   # Adjust after calibration

hx.reset()
hx.tare()
print("Tare complete. Starting measurement...\n")

def get_stable_weight(samples=15):
    values = []

    # Collect multiple readings
    for _ in range(samples):
        val = hx.get_weight(3)
        values.append(val)
        time.sleep(0.05)

    # Use median to remove spikes
    weight = statistics.median(values)

    # Convert to milligrams
    mg = weight * 1000

    # Prevent negatives
    if mg < 0:
        mg = 0

    return mg

try:
    while True:
        weight_mg = get_stable_weight()

        print(f"Weight: {weight_mg:.2f} mg")

        hx.power_down()
        time.sleep(0.1)
        hx.power_up()
        time.sleep(0.5)

except (KeyboardInterrupt, SystemExit):
    print("\nExiting…")
    GPIO.cleanup()

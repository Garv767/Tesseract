import RPi.GPIO as GPIO
from time import sleep

servo_pins = [12]

GPIO.setmode(GPIO.BCM)

servos = []
for pin in servo_pins:
    GPIO.setup(pin, GPIO.OUT)
    pwm = GPIO.PWM(pin, 50)
    pwm.start(0)
    servos.append(pwm)

def set_angle(servo, angle):
    duty = 2 + (angle / 18)
    servo.ChangeDutyCycle(duty)

try:
    while True:
        for angle in range(0, 181, 5):   # 0 to 180 fast
            for servo in servos:
                set_angle(servo, angle)
            sleep(0.01)

        for angle in range(180, -1, -5): # 180 to 0 fast
            for servo in servos:
                set_angle(servo, angle)
            sleep(0.01)

except KeyboardInterrupt:
    print("Stopped")

finally:
    for servo in servos:
        servo.stop()
    GPIO.cleanup()
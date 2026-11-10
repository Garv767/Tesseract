from pyfingerprint.pyfingerprint import PyFingerprint
import time

try:
    # Initialize sensor
    f = PyFingerprint('/dev/ttyS0', 57600, 0xFFFFFFFF, 0x00000000)

    if not f.verifyPassword():
        raise ValueError('The fingerprint sensor password is wrong!')

except Exception as e:
    print('Fingerprint sensor initialization failed!')
    print('Exception message:', str(e))
    exit(1)

print('Fingerprint sensor initialized.')
print('Currently stored templates:', f.getTemplateCount())
print('Place your finger on the sensor...')

# --- First scan ---
while f.readImage() == False:
    pass

f.convertImage(0x01)
print('First image taken, remove your finger...')
time.sleep(2)

print('Place the same finger again...')
while f.readImage() == False:
    pass

f.convertImage(0x02)

if f.compareCharacteristics() == 0:
    raise Exception('Fingers do not match. Try again.')

f.createTemplate()
positionNumber = f.storeTemplate()
print('Fingerprint enrolled successfully!')
print('Stored at position #', positionNumber)

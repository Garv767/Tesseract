from pyfingerprint.pyfingerprint import PyFingerprint
import time

try:
    f = PyFingerprint('/dev/serial0', 57600, 0xFFFFFFFF, 0x00000000)

    if f.verifyPassword() == False:
        raise ValueError('Fingerprint sensor password is wrong!')

except Exception as e:
    print('Failed to initialize fingerprint sensor!')
    print('Exception message:', str(e))
    exit(1)

print('Fingerprint sensor initialized.')
print('Currently stored templates:', f.getTemplateCount())

print('\nWaiting for finger...')

while f.readImage() == False:
    pass

f.convertImage(0x01)
result = f.searchTemplate()
positionNumber = result[0]

if positionNumber >= 0:
    print('Access Granted! Fingerprint found at position #', positionNumber)
else:
    print('Fingerprint not recognized! Access Denied.')

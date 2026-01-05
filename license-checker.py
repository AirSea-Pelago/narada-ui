# ==========================================
# LICENSE VALIDATOR ONLY (tanpa MediaMTX logic)
# ==========================================

import json
import sys
import hashlib
import os
import platform
from datetime import datetime
from cryptography.fernet import Fernet
import base64

class LicenseValidator:
    def __init__(self, master_key):
        self.master_key = master_key
        self.cipher = Fernet(self.get_fernet_key())
    
    def get_fernet_key(self):
        key = hashlib.sha256(self.master_key.encode()).digest()
        return base64.urlsafe_b64encode(key)
    
    def get_usb_hardware_id(self, drive_letter):
        """Dapatkan hardware ID USB"""
        try:
            import wmi
            c = wmi.WMI()
            for disk in c.Win32_DiskDrive():
                for partition in disk.associators("Win32_DiskDriveToDiskPartition"):
                    for logical_disk in partition.associators("Win32_LogicalDiskToPartition"):
                        if logical_disk.Caption == f"{drive_letter}:":
                            hardware_id = f"{disk.SerialNumber}_{disk.PNPDeviceID}"
                            return hardware_id
        except ImportError:
            print("⚠️  Module 'wmi' tidak terinstall, gunakan: pip install wmi", file=sys.stderr)
            return None
        except Exception as e:
            print(f"⚠️  Error mendapatkan hardware ID: {e}", file=sys.stderr)
            return None
    
    def find_license_drive(self):
        """Cari drive yang berisi file .license.sys"""
        if platform.system() == 'Windows':
            import string
            drives = [f"{d}:" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]
            
            for drive in drives:
                license_path = os.path.join(drive, ".license.sys")
                if os.path.exists(license_path):
                    return drive[0]
        else:
            for mount_point in ['/media', '/mnt']:
                if os.path.exists(mount_point):
                    for item in os.listdir(mount_point):
                        full_path = os.path.join(mount_point, item)
                        license_path = os.path.join(full_path, ".license.sys")
                        if os.path.exists(license_path):
                            return full_path
        return None
    
    def verify_signature(self, hardware_id, signature, expiry_date):
        """Verifikasi signature lisensi"""
        expected_signature_data = f"{hardware_id}_{self.master_key}_{expiry_date}"
        expected_signature = hashlib.sha256(expected_signature_data.encode()).hexdigest()
        return signature == expected_signature
    
    def validate_license(self):
        """Validasi lisensi lengkap"""
        drive_letter = self.find_license_drive()
        
        if not drive_letter:
            return {
                'valid': False,
                'message': 'Flashdisk lisensi tidak ditemukan. Pastikan flashdisk terpasang.',
                'drive': None
            }
        
        if platform.system() == 'Windows':
            license_path = f"{drive_letter}:\\.license.sys"
        else:
            license_path = os.path.join(drive_letter, ".license.sys")
        
        try:
            with open(license_path, 'rb') as f:
                encrypted_data = f.read()
            
            decrypted_data = self.cipher.decrypt(encrypted_data)
            license_data = json.loads(decrypted_data.decode())
            
        except Exception as e:
            return {
                'valid': False,
                'message': f'File lisensi tidak valid atau rusak: {str(e)}',
                'drive': None
            }
        
        # Validasi hardware ID
        current_hardware_id = self.get_usb_hardware_id(drive_letter)
        
        if current_hardware_id:
            if current_hardware_id != license_data['hardware_id']:
                return {
                    'valid': False,
                    'message': 'Lisensi tidak valid! File di-copy dari flashdisk lain.',
                    'drive': None
                }
        
        # Verifikasi signature
        if not self.verify_signature(
            license_data['hardware_id'],
            license_data['signature'],
            license_data['expiry']
        ):
            return {
                'valid': False,
                'message': 'Signature lisensi tidak valid.',
                'drive': None
            }
        
        # Cek expiry
        try:
            expiry = datetime.fromisoformat(license_data['expiry'])
            if datetime.now() > expiry:
                return {
                    'valid': False,
                    'message': f'Lisensi kadaluarsa sejak {expiry.strftime("%d %B %Y")}',
                    'drive': None
                }
        except Exception as e:
            return {
                'valid': False,
                'message': f'Format tanggal expiry tidak valid: {e}',
                'drive': None
            }
        
        return {
            'valid': True,
            'message': f'Lisensi valid hingga {expiry.strftime("%d %B %Y")}',
            'data': license_data,
            'drive': drive_letter
        }

def main():
    MASTER_KEY = "rahasia-kunci-super-aman-12345"
    
    validator = LicenseValidator(MASTER_KEY)
    license_result = validator.validate_license()
    print(json.dumps(license_result))
    sys.stdout.flush()
    sys.exit(0)

if __name__ == "__main__":
    main()
# ==========================================
# LICENSE GENERATOR untuk Flashdisk
# ==========================================

import json
import hashlib
import base64
import os
import platform
import subprocess
from datetime import datetime, timedelta
from cryptography.fernet import Fernet

class LicenseGenerator:
    def __init__(self, master_key):
        self.master_key = master_key
        self.cipher = Fernet(self.get_fernet_key())
    
    def get_fernet_key(self):
        key = hashlib.sha256(self.master_key.encode()).digest()
        return base64.urlsafe_b64encode(key)
    
    def get_usb_hardware_id(self, drive_letter):
        """Dapatkan hardware ID dari flashdisk"""
        try:
            import wmi
            c = wmi.WMI()
            for disk in c.Win32_DiskDrive():
                for partition in disk.associators("Win32_DiskDriveToDiskPartition"):
                    for logical_disk in partition.associators("Win32_LogicalDiskToPartition"):
                        if logical_disk.Caption == f"{drive_letter}:":
                            hardware_id = f"{disk.SerialNumber}_{disk.PNPDeviceID}"
                            return hardware_id, disk.SerialNumber, disk.Model
            return None, None, None
        except ImportError:
            print("❌ Module 'wmi' tidak terinstall!")
            print("   Install dengan: pip install wmi")
            return None, None, None
        except Exception as e:
            print(f"❌ Error membaca hardware ID: {e}")
            return None, None, None
    
    def create_signature(self, hardware_id, expiry_date):
        """Buat signature untuk lisensi"""
        signature_data = f"{hardware_id}_{self.master_key}_{expiry_date}"
        signature = hashlib.sha256(signature_data.encode()).hexdigest()
        return signature
    
    def generate_license(self, drive_letter, customer_name, duration_days=365):
        """Generate lisensi untuk flashdisk tertentu"""
        
        # Dapatkan hardware ID
        hardware_id, serial, model = self.get_usb_hardware_id(drive_letter)
        
        if not hardware_id:
            return {
                'success': False,
                'message': 'Gagal membaca hardware ID flashdisk'
            }
        
        print(f"\n📀 Informasi Flashdisk:")
        print(f"   Drive: {drive_letter}:")
        print(f"   Model: {model}")
        print(f"   Serial: {serial}")
        print(f"   Hardware ID: {hardware_id}\n")
        
        # Hitung tanggal expiry
        issue_date = datetime.now()
        expiry_date = issue_date + timedelta(days=duration_days)
        
        # Buat license data
        license_data = {
            'customer_name': customer_name,
            'hardware_id': hardware_id,
            'serial_number': serial,
            'model': model,
            'issue_date': issue_date.isoformat(),
            'expiry': expiry_date.isoformat(),
            'duration_days': duration_days,
            'signature': self.create_signature(hardware_id, expiry_date.isoformat())
        }
        
        # Enkripsi license data
        try:
            json_data = json.dumps(license_data, indent=2)
            encrypted_data = self.cipher.encrypt(json_data.encode())
            
            # Simpan ke flashdisk
            license_path = f"{drive_letter}:\\.license.sys"
            with open(license_path, 'wb') as f:
                f.write(encrypted_data)
            
            # Sembunyikan file (Windows)
            if platform.system() == 'Windows':
                try:
                    subprocess.run(['attrib', '+h', '+s', license_path], 
                                 capture_output=True, check=True)
                    print(f"✅ File lisensi disembunyikan")
                except:
                    print(f"⚠️  Gagal menyembunyikan file")
            
            print(f"\n✅ LISENSI BERHASIL DIBUAT!")
            print(f"   File: {license_path}")
            print(f"   Customer: {customer_name}")
            print(f"   Berlaku hingga: {expiry_date.strftime('%d %B %Y')}")
            print(f"   Durasi: {duration_days} hari\n")
            
            return {
                'success': True,
                'message': 'Lisensi berhasil dibuat',
                'license_path': license_path,
                'license_data': license_data
            }
        
        except Exception as e:
            print(f"❌ Error membuat lisensi: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'message': f'Error: {e}'
            }
    
    def list_available_drives(self):
        """List semua drive yang tersedia"""
        if platform.system() == 'Windows':
            import string
            drives = []
            for letter in string.ascii_uppercase:
                drive_path = f"{letter}:\\"
                if os.path.exists(drive_path):
                    try:
                        # Cek apakah removable drive
                        import win32api
                        drive_type = win32api.GetDriveType(drive_path)
                        # DRIVE_REMOVABLE = 2
                        if drive_type == 2:
                            drives.append(letter)
                    except:
                        # Jika win32api tidak tersedia, tampilkan semua
                        drives.append(letter)
            return drives
        return []


def main():
    # MASTER KEY HARUS SAMA dengan di license-checker.py
    MASTER_KEY = "rahasia-kunci-super-aman-12345"
    
    print("=" * 60)
    print("  LICENSE GENERATOR - SecureStream Pro")
    print("=" * 60)
    
    generator = LicenseGenerator(MASTER_KEY)
    
    # List available drives
    drives = generator.list_available_drives()
    
    if not drives:
        print("\n❌ Tidak ada flashdisk removable yang terdeteksi!")
        print("   Pastikan flashdisk sudah terpasang.")
        return
    
    print(f"\n📀 Flashdisk yang terdeteksi: {', '.join(drives)}")
    
    # Input dari user
    print("\n" + "=" * 60)
    drive_letter = input("Masukkan drive letter flashdisk (contoh: E): ").strip().upper()
    
    if not drive_letter or drive_letter not in drives:
        print(f"❌ Drive {drive_letter} tidak valid!")
        return
    
    customer_name = input("Nama Customer: ").strip()
    if not customer_name:
        print("❌ Nama customer harus diisi!")
        return
    
    duration_input = input("Durasi lisensi (hari) [default: 365]: ").strip()
    duration_days = int(duration_input) if duration_input else 365
    
    # Konfirmasi
    print("\n" + "=" * 60)
    print("KONFIRMASI PEMBUATAN LISENSI:")
    print(f"  Drive: {drive_letter}:")
    print(f"  Customer: {customer_name}")
    print(f"  Durasi: {duration_days} hari")
    print("=" * 60)
    
    confirm = input("\nLanjutkan? (y/n): ").strip().lower()
    
    if confirm != 'y':
        print("❌ Dibatalkan.")
        return
    
    # Generate license
    result = generator.generate_license(drive_letter, customer_name, duration_days)
    
    if result['success']:
        print("\n✅ SELESAI!")
        print("\n⚠️  PENTING:")
        print("   1. Jangan format atau hapus file .license.sys")
        print("   2. File ini terikat dengan hardware flashdisk ini")
        print("   3. Jika di-copy ke flashdisk lain, tidak akan berfungsi")
        print("   4. Simpan backup di tempat aman")
        
        # Tanyakan apakah ingin save backup
        save_backup = input("\nSimpan backup license ke file JSON? (y/n): ").strip().lower()
        if save_backup == 'y':
            backup_path = f"license_backup_{customer_name.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(backup_path, 'w') as f:
                json.dump(result['license_data'], f, indent=2)
            print(f"✅ Backup disimpan: {backup_path}")
    else:
        print(f"\n❌ GAGAL: {result['message']}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n❌ Dibatalkan oleh user.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


# ==========================================
# CARA PAKAI:
# ==========================================
"""
1. Install dependencies:
   pip install cryptography wmi pywin32

2. Colok flashdisk yang akan dibuat lisensi

3. Jalankan script:
   python generate-license.py

4. Ikuti instruksi di layar:
   - Pilih drive letter
   - Input nama customer
   - Input durasi (hari)

5. File .license.sys akan dibuat di flashdisk

CATATAN:
- Master key HARUS SAMA dengan license-checker.py
- Lisensi terikat dengan hardware ID flashdisk
- Tidak bisa di-copy ke flashdisk lain
- File .license.sys hidden + system attribute
"""
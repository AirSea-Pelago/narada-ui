# drone_access_control.py
"""
Drone Access Control System
- Whitelist MAC addresses untuk drone dan remote
- Auto-detect device yang connect
- Block unauthorized devices
"""

import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path

class DroneAccessControl:
    def __init__(self, config_file="drone_access.json"):
        self.config_file = config_file
        self.config = self.load_config()
        self.authorized_devices = self.config.get("authorized_devices", {})
        self.connection_log = []
        
    def load_config(self):
        """Load configuration from JSON file"""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading config: {e}")
                return self.get_default_config()
        else:
            config = self.get_default_config()
            self.save_config(config)
            return config
    
    def get_default_config(self):
        """Default configuration"""
        return {
            "authorized_devices": {
                "drone": {
                    "mac_address": "",
                    "name": "Primary Drone",
                    "description": "Main authorized drone",
                    "added_date": datetime.now().isoformat()
                },
                "remote": {
                    "mac_address": "",
                    "name": "Primary Remote",
                    "description": "Main authorized remote control",
                    "added_date": datetime.now().isoformat()
                }
            },
            "settings": {
                "auto_block_unauthorized": True,
                "log_attempts": True,
                "alert_on_unauthorized": True,
                "max_connection_attempts": 3
            }
        }
    
    def save_config(self, config=None):
        """Save configuration to JSON file"""
        if config is None:
            config = self.config
        
        try:
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving config: {e}")
            return False
    
    def register_drone(self, mac_address, name="Primary Drone", description=""):
        """Register authorized drone MAC address"""
        mac_address = self.normalize_mac(mac_address)
        
        if not self.is_valid_mac(mac_address):
            return {"success": False, "message": "Invalid MAC address format"}
        
        self.config["authorized_devices"]["drone"] = {
            "mac_address": mac_address,
            "name": name,
            "description": description,
            "added_date": datetime.now().isoformat(),
            "last_seen": None
        }
        
        if self.save_config():
            return {
                "success": True,
                "message": f"Drone registered successfully: {mac_address}",
                "device": self.config["authorized_devices"]["drone"]
            }
        else:
            return {"success": False, "message": "Failed to save configuration"}
    
    def register_remote(self, mac_address, name="Primary Remote", description=""):
        """Register authorized remote MAC address"""
        mac_address = self.normalize_mac(mac_address)
        
        if not self.is_valid_mac(mac_address):
            return {"success": False, "message": "Invalid MAC address format"}
        
        self.config["authorized_devices"]["remote"] = {
            "mac_address": mac_address,
            "name": name,
            "description": description,
            "added_date": datetime.now().isoformat(),
            "last_seen": None
        }
        
        if self.save_config():
            return {
                "success": True,
                "message": f"Remote registered successfully: {mac_address}",
                "device": self.config["authorized_devices"]["remote"]
            }
        else:
            return {"success": False, "message": "Failed to save configuration"}
    
    def is_authorized(self, mac_address, device_type=None):
        """Check if MAC address is authorized"""
        mac_address = self.normalize_mac(mac_address)
        
        # Check against all authorized devices
        for dev_type, device in self.config["authorized_devices"].items():
            if device.get("mac_address") == mac_address:
                # Update last seen
                device["last_seen"] = datetime.now().isoformat()
                self.save_config()
                
                return {
                    "authorized": True,
                    "device_type": dev_type,
                    "device": device
                }
        
        # Log unauthorized attempt
        if self.config["settings"]["log_attempts"]:
            self.log_connection_attempt(mac_address, False)
        
        return {
            "authorized": False,
            "device_type": None,
            "device": None
        }
    
    def get_connected_devices(self):
        """Get list of currently connected devices on network"""
        try:
            # Windows: arp -a
            if os.name == 'nt':
                result = subprocess.run(['arp', '-a'], 
                                       capture_output=True, 
                                       text=True)
                return self.parse_arp_windows(result.stdout)
            # Linux/Mac: arp -n or ip neigh
            else:
                result = subprocess.run(['arp', '-n'], 
                                       capture_output=True, 
                                       text=True)
                return self.parse_arp_unix(result.stdout)
        except Exception as e:
            print(f"Error getting connected devices: {e}")
            return []
    
    def parse_arp_windows(self, arp_output):
        """Parse Windows ARP output"""
        devices = []
        lines = arp_output.split('\n')
        
        for line in lines:
            if '-' in line or ':' in line:
                parts = line.split()
                if len(parts) >= 2:
                    ip = parts[0]
                    mac = parts[1]
                    
                    if self.is_valid_mac(mac):
                        devices.append({
                            "ip": ip,
                            "mac": self.normalize_mac(mac)
                        })
        
        return devices
    
    def parse_arp_unix(self, arp_output):
        """Parse Unix/Linux ARP output"""
        devices = []
        lines = arp_output.split('\n')
        
        for line in lines:
            parts = line.split()
            if len(parts) >= 3:
                ip = parts[0]
                mac = parts[2]
                
                if self.is_valid_mac(mac):
                    devices.append({
                        "ip": ip,
                        "mac": self.normalize_mac(mac)
                    })
        
        return devices
    
    def scan_for_authorized_devices(self):
        """Scan network for authorized devices"""
        connected = self.get_connected_devices()
        found_devices = []
        
        for device in connected:
            mac = device["mac"]
            auth_check = self.is_authorized(mac)
            
            if auth_check["authorized"]:
                found_devices.append({
                    **device,
                    "device_type": auth_check["device_type"],
                    "device_info": auth_check["device"]
                })
        
        return {
            "total_connected": len(connected),
            "authorized_found": len(found_devices),
            "devices": found_devices
        }
    
    def verify_rtmp_connection(self, source_ip):
        """Verify RTMP connection from IP address"""
        # Get MAC address from IP
        connected = self.get_connected_devices()
        
        for device in connected:
            if device["ip"] == source_ip:
                mac = device["mac"]
                auth_check = self.is_authorized(mac)
                
                if auth_check["authorized"]:
                    return {
                        "allowed": True,
                        "device_type": auth_check["device_type"],
                        "message": f"Authorized {auth_check['device_type']} connected"
                    }
                else:
                    return {
                        "allowed": False,
                        "message": "Unauthorized device attempting to connect"
                    }
        
        return {
            "allowed": False,
            "message": "Device not found in network"
        }
    
    def log_connection_attempt(self, mac_address, authorized, additional_info=None):
        """Log connection attempt"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "mac_address": mac_address,
            "authorized": authorized,
            "additional_info": additional_info
        }
        
        self.connection_log.append(log_entry)
        
        # Keep only last 1000 entries
        if len(self.connection_log) > 1000:
            self.connection_log = self.connection_log[-1000:]
        
        # Save to file
        try:
            log_file = "drone_access_log.json"
            with open(log_file, 'w') as f:
                json.dump(self.connection_log, f, indent=2)
        except Exception as e:
            print(f"Error saving log: {e}")
    
    @staticmethod
    def normalize_mac(mac_address):
        """Normalize MAC address format to XX:XX:XX:XX:XX:XX"""
        # Remove common separators
        mac = mac_address.replace('-', '').replace(':', '').replace('.', '')
        mac = mac.upper()
        
        # Add colons every 2 characters
        if len(mac) == 12:
            return ':'.join(mac[i:i+2] for i in range(0, 12, 2))
        
        return mac_address
    
    @staticmethod
    def is_valid_mac(mac_address):
        """Validate MAC address format"""
        mac = mac_address.replace('-', '').replace(':', '').replace('.', '')
        return len(mac) == 12 and all(c in '0123456789ABCDEFabcdef' for c in mac)
    
    def get_status(self):
        """Get current system status"""
        drone = self.config["authorized_devices"]["drone"]
        remote = self.config["authorized_devices"]["remote"]
        
        return {
            "drone": {
                "registered": bool(drone.get("mac_address")),
                "mac": drone.get("mac_address", "Not registered"),
                "name": drone.get("name"),
                "last_seen": drone.get("last_seen", "Never")
            },
            "remote": {
                "registered": bool(remote.get("mac_address")),
                "mac": remote.get("mac_address", "Not registered"),
                "name": remote.get("name"),
                "last_seen": remote.get("last_seen", "Never")
            },
            "settings": self.config["settings"]
        }
    
    def export_config(self, filename="drone_access_backup.json"):
        """Export configuration for backup"""
        try:
            import shutil
            shutil.copy(self.config_file, filename)
            return {"success": True, "message": f"Configuration exported to {filename}"}
        except Exception as e:
            return {"success": False, "message": f"Export failed: {e}"}
    
    def import_config(self, filename):
        """Import configuration from backup"""
        try:
            with open(filename, 'r') as f:
                config = json.load(f)
            
            # Validate config structure
            if "authorized_devices" in config and "settings" in config:
                self.config = config
                self.save_config()
                return {"success": True, "message": "Configuration imported successfully"}
            else:
                return {"success": False, "message": "Invalid configuration file"}
        except Exception as e:
            return {"success": False, "message": f"Import failed: {e}"}


# CLI Interface
if __name__ == "__main__":
    import sys
    
    dac = DroneAccessControl()
    
    if len(sys.argv) < 2:
        print("\n=== Drone Access Control System ===")
        print("\nUsage:")
        print("  python drone_access_control.py register-drone <MAC_ADDRESS> [NAME]")
        print("  python drone_access_control.py register-remote <MAC_ADDRESS> [NAME]")
        print("  python drone_access_control.py check <MAC_ADDRESS>")
        print("  python drone_access_control.py scan")
        print("  python drone_access_control.py status")
        print("  python drone_access_control.py verify-ip <IP_ADDRESS>")
        print("\nExamples:")
        print("  python drone_access_control.py register-drone AA:BB:CC:DD:EE:FF 'DJI Mavic'")
        print("  python drone_access_control.py scan")
        sys.exit(0)
    
    command = sys.argv[1].lower()
    
    if command == "register-drone":
        if len(sys.argv) < 3:
            print("Error: MAC address required")
            sys.exit(1)
        
        mac = sys.argv[2]
        name = sys.argv[3] if len(sys.argv) > 3 else "Primary Drone"
        
        result = dac.register_drone(mac, name)
        print(json.dumps(result, indent=2))
    
    elif command == "register-remote":
        if len(sys.argv) < 3:
            print("Error: MAC address required")
            sys.exit(1)
        
        mac = sys.argv[2]
        name = sys.argv[3] if len(sys.argv) > 3 else "Primary Remote"
        
        result = dac.register_remote(mac, name)
        print(json.dumps(result, indent=2))
    
    elif command == "check":
        if len(sys.argv) < 3:
            print("Error: MAC address required")
            sys.exit(1)
        
        mac = sys.argv[2]
        result = dac.is_authorized(mac)
        print(json.dumps(result, indent=2))
    
    elif command == "scan":
        print("Scanning network for authorized devices...")
        result = dac.scan_for_authorized_devices()
        print(json.dumps(result, indent=2))
    
    elif command == "status":
        result = dac.get_status()
        print(json.dumps(result, indent=2))
    
    elif command == "verify-ip":
        if len(sys.argv) < 3:
            print("Error: IP address required")
            sys.exit(1)
        
        ip = sys.argv[2]
        result = dac.verify_rtmp_connection(ip)
        print(json.dumps(result, indent=2))
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
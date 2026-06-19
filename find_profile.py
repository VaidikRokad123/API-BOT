import os
import json

local_state_path = os.path.join(
    os.path.expanduser('~'),
    'AppData',
    'Local',
    'Google',
    'Chrome',
    'User Data',
    'Local State'
)

try:
    print(f"Reading Local State from: {local_state_path}")
    with open(local_state_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    info_cache = data.get('profile', {}).get('info_cache', {})
    print('\nChrome Profiles Found:')
    print('====================================')
    
    for profile_dir, profile_info in info_cache.items():
        print(f"Directory: {profile_dir}")
        print(f"  Name: {profile_info.get('name')}")
        print(f"  Email: {profile_info.get('user_name', 'N/A')}")
        print('------------------------------------')
except Exception as e:
    print('Error reading Chrome profiles:', str(e))

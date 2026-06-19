import fs from 'fs';
import path from 'path';
import os from 'os';

const localStatePath = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'Google',
  'Chrome',
  'User Data',
  'Local State'
);

try {
  console.log(`Reading Local State from: ${localStatePath}`);
  const raw = fs.readFileSync(localStatePath, 'utf8');
  const data = JSON.parse(raw);
  
  const infoCache = data.profile.info_cache;
  console.log('\nChrome Profiles Found:');
  console.log('====================================');
  
  for (const [profileDir, profileInfo] of Object.entries(infoCache)) {
    console.log(`Directory: ${profileDir}`);
    console.log(`  Name: ${profileInfo.name}`);
    console.log(`  Email: ${profileInfo.user_name || 'N/A'}`);
    console.log('------------------------------------');
  }
} catch (e) {
  console.error('Error reading Chrome profiles:', e.message);
}

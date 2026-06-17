import fs from 'fs';
import path from 'path';

// 1. Update package.json
const pkgPath = path.resolve('package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
let [major, minor, patch] = pkg.version.split('.').map(Number);
patch += 1;
pkg.version = `${major}.${minor}.${patch}`;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\n[Increment Version] Bumping package.json to version ${pkg.version}`);

// 2. Update android/app/build.gradle
const gradlePath = path.resolve('android/app/build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf-8');
  
  // Increment versionCode
  let newVersionCode = 1;
  gradle = gradle.replace(/versionCode\s+(\d+)/, (match, p1) => {
    newVersionCode = parseInt(p1, 10) + 1;
    return `versionCode ${newVersionCode}`;
  });

  // Update versionName
  gradle = gradle.replace(/versionName\s+"([^"]+)"/, (match, p1) => {
    return `versionName "${pkg.version}"`;
  });

  fs.writeFileSync(gradlePath, gradle);
  console.log(`[Increment Version] Bumping build.gradle versionCode to ${newVersionCode} and versionName to ${pkg.version}\n`);
} else {
  console.log("[Increment Version] android/app/build.gradle not found, skipping.");
}

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

console.log('=== INITIATING ASSET CATALOG AUDIT & VALIDATION ===\n');

const rootXcassets = path.join('ios', 'App', 'App', 'Assets.xcassets');
let totalErrors = 0;
let totalWarnings = 0;
let validatedFiles = 0;

function reportError(msg) {
  console.error(`❌ [ERROR] ${msg}`);
  totalErrors++;
}

function reportWarning(msg) {
  console.warn(`⚠️ [WARN] ${msg}`);
  totalWarnings++;
}

function reportPass(msg) {
  console.log(`✅ [PASS] ${msg}`);
}

// 1. Validate Root Directory
if (!fs.existsSync(rootXcassets)) {
  reportError(`Assets.xcassets directory not found at: ${rootXcassets}`);
  process.exit(1);
}

// 2. Validate Root Contents.json
const rootContentsPath = path.join(rootXcassets, 'Contents.json');
if (!fs.existsSync(rootContentsPath)) {
  reportError(`Missing root Contents.json in ${rootXcassets}`);
} else {
  try {
    const raw = fs.readFileSync(rootContentsPath, 'utf8');
    const json = JSON.parse(raw);
    if (!json.info || json.info.version !== 1) {
      reportError(`Invalid info structure in root Contents.json: ${raw}`);
    } else {
      reportPass(`Root Contents.json is valid (version ${json.info.version}, author ${json.info.author})`);
    }
  } catch (e) {
    reportError(`Failed to parse root Contents.json: ${e.message}`);
  }
}

// 3. Scan subdirectories in Assets.xcassets
const entries = fs.readdirSync(rootXcassets, { withFileTypes: true });

for (const entry of entries) {
  if (entry.name === 'Contents.json' || entry.name.startsWith('.')) continue;
  const entryPath = path.join(rootXcassets, entry.name);

  if (entry.isDirectory()) {
    if (entry.name.endsWith('.appiconset')) {
      validateAppIconSet(entryPath);
    } else if (entry.name.endsWith('.imageset')) {
      validateImageSet(entryPath);
    } else {
      reportWarning(`Unknown directory format in xcassets: ${entry.name}`);
    }
  } else {
    reportWarning(`Loose file in xcassets root: ${entry.name}`);
  }
}

function validateAppIconSet(dirPath) {
  console.log(`\n--- Validating AppIconSet: ${path.basename(dirPath)} ---`);
  const contentsPath = path.join(dirPath, 'Contents.json');
  if (!fs.existsSync(contentsPath)) {
    reportError(`Missing Contents.json in ${dirPath}`);
    return;
  }

  let contents;
  try {
    contents = JSON.parse(fs.readFileSync(contentsPath, 'utf8'));
    reportPass(`AppIcon Contents.json is valid JSON`);
  } catch (e) {
    reportError(`AppIcon Contents.json JSON parse error: ${e.message}`);
    return;
  }

  if (!Array.isArray(contents.images) || contents.images.length === 0) {
    reportError(`AppIcon Contents.json must contain a non-empty 'images' array`);
    return;
  }

  const existingFiles = new Set(fs.readdirSync(dirPath).filter(f => f !== 'Contents.json' && !f.startsWith('.')));
  const referencedFiles = new Set();

  for (const img of contents.images) {
    if (!img.filename) {
      reportWarning(`Image entry without filename in AppIcon Contents.json: ${JSON.stringify(img)}`);
      continue;
    }
    referencedFiles.add(img.filename);

    const imgPath = path.join(dirPath, img.filename);
    if (!fs.existsSync(imgPath)) {
      reportError(`Referenced AppIcon file does not exist: ${imgPath}`);
      continue;
    }

    // Verify exact filename casing
    const dirFiles = fs.readdirSync(dirPath);
    if (!dirFiles.includes(img.filename)) {
      reportError(`Filename casing mismatch on disk: expected ${img.filename}`);
    }

    validatePngFile(imgPath, {
      expectedWidth: 1024,
      expectedHeight: 1024,
      allowTransparency: false,
      context: 'AppIcon'
    });
  }

  // Check for orphan files
  for (const f of existingFiles) {
    if (!referencedFiles.has(f)) {
      reportWarning(`Orphan file in AppIcon directory: ${f}`);
    }
  }
}

function validateImageSet(dirPath) {
  console.log(`\n--- Validating ImageSet: ${path.basename(dirPath)} ---`);
  const contentsPath = path.join(dirPath, 'Contents.json');
  if (!fs.existsSync(contentsPath)) {
    reportError(`Missing Contents.json in ${dirPath}`);
    return;
  }

  let contents;
  try {
    contents = JSON.parse(fs.readFileSync(contentsPath, 'utf8'));
    reportPass(`ImageSet Contents.json is valid JSON`);
  } catch (e) {
    reportError(`ImageSet Contents.json JSON parse error: ${e.message}`);
    return;
  }

  if (!Array.isArray(contents.images) || contents.images.length === 0) {
    reportError(`ImageSet Contents.json must contain a non-empty 'images' array`);
    return;
  }

  const existingFiles = new Set(fs.readdirSync(dirPath).filter(f => f !== 'Contents.json' && !f.startsWith('.')));
  const referencedFiles = new Set();

  for (const img of contents.images) {
    if (!img.filename) {
      reportWarning(`Image entry without filename in ImageSet Contents.json: ${JSON.stringify(img)}`);
      continue;
    }
    referencedFiles.add(img.filename);

    const imgPath = path.join(dirPath, img.filename);
    if (!fs.existsSync(imgPath)) {
      reportError(`Referenced ImageSet file does not exist: ${imgPath}`);
      continue;
    }

    // Verify exact filename casing
    const dirFiles = fs.readdirSync(dirPath);
    if (!dirFiles.includes(img.filename)) {
      reportError(`Filename casing mismatch on disk: expected ${img.filename}`);
    }

    validatePngFile(imgPath, {
      expectedWidth: 2732,
      expectedHeight: 2732,
      allowTransparency: true,
      context: 'Splash'
    });
  }

  // Check for orphan files
  for (const f of existingFiles) {
    if (!referencedFiles.has(f)) {
      reportWarning(`Orphan file in ImageSet directory: ${f}`);
    }
  }
}

function validatePngFile(filePath, options) {
  validatedFiles++;
  const buf = fs.readFileSync(filePath);
  
  // 1. Magic bytes
  const isPng = buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!isPng) {
    reportError(`Corrupt PNG header in ${filePath}: magic bytes=${buf.slice(0, 8).toString('hex')}`);
    return;
  }

  // 2. Decode with pngjs
  try {
    const png = PNG.sync.read(buf);
    reportPass(`${path.basename(filePath)} is valid PNG: ${png.width}x${png.height}, channels=${png.data.length / (png.width * png.height)}`);

    if (options.expectedWidth && png.width !== options.expectedWidth) {
      reportError(`${filePath} width is ${png.width}, expected ${options.expectedWidth}`);
    }
    if (options.expectedHeight && png.height !== options.expectedHeight) {
      reportError(`${filePath} height is ${png.height}, expected ${options.expectedHeight}`);
    }

    // Check transparency if forbidden
    if (!options.allowTransparency) {
      let hasTransparentPixels = false;
      for (let i = 3; i < png.data.length; i += 4) {
        if (png.data[i] < 255) {
          hasTransparentPixels = true;
          break;
        }
      }
      if (hasTransparentPixels) {
        reportError(`${filePath} contains transparent/alpha pixels, which is forbidden for App Store AppIcon`);
      } else {
        reportPass(`${path.basename(filePath)} alpha channel is 100% opaque (0 transparent pixels)`);
      }
    }
  } catch (e) {
    reportError(`Failed to decode PNG in ${filePath}: ${e.message}`);
  }
}

console.log('\n=== AUDIT SUMMARY ===');
console.log(`Validated files: ${validatedFiles}`);
console.log(`Errors: ${totalErrors}`);
console.log(`Warnings: ${totalWarnings}`);

if (totalErrors > 0) {
  console.error('\n❌ AUDIT FAILED!');
  process.exit(1);
} else {
  console.log('\n✅ ASSET CATALOG AUDIT PASSED 100% CLEAN!');
}

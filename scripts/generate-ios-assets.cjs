const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Spartan helmet polygon definitions (512x512 viewbox)
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const leftOuter = [
  [250, 110], [210, 160], [222, 190], [210, 165],
  [170, 210], [170, 300], [192, 300], [192, 345],
  [170, 345], [170, 390], [216, 482], [250, 422]
];
const leftHole = [
  [184, 264], [234, 264], [224, 304], [184, 304]
];

const rightOuter = leftOuter.map(([x, y]) => [512 - x, y]);
const rightHole = leftHole.map(([x, y]) => [512 - x, y]);

function isInsideHelmet(vx, vy) {
  const inLeft = pointInPolygon(vx, vy, leftOuter) && !pointInPolygon(vx, vy, leftHole);
  if (inLeft) return true;
  const inRight = pointInPolygon(vx, vy, rightOuter) && !pointInPolygon(vx, vy, rightHole);
  return inRight;
}

// Gold color gradient interpolation (x1=0, y1=0 -> x2=1, y2=1)
function getGoldColor(t) {
  // t from 0 to 1
  const stops = [
    { pos: 0.00, r: 255, g: 239, b: 166 }, // #FFEFA6
    { pos: 0.20, r: 245, g: 171, b: 18  }, // #F5AB12
    { pos: 0.50, r: 217, g: 119, b: 6   }, // #D97706
    { pos: 0.80, r: 180, g: 83,  b: 9   }, // #B45309
    { pos: 1.00, r: 124, g: 45,  b: 18  }  // #7C2D12
  ];
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].pos && t <= stops[i+1].pos) {
      const segT = (t - stops[i].pos) / (stops[i+1].pos - stops[i].pos);
      return {
        r: Math.round(stops[i].r + segT * (stops[i+1].r - stops[i].r)),
        g: Math.round(stops[i].g + segT * (stops[i+1].g - stops[i].g)),
        b: Math.round(stops[i].b + segT * (stops[i+1].b - stops[i].b))
      };
    }
  }
  return stops[0];
}

function generateAppIcon(outPath) {
  console.log(`Generating AppIcon 1024x1024 -> ${outPath}`);
  const width = 1024;
  const height = 1024;
  const png = new PNG({ width, height });

  // Center & scale for helmet inside 1024x1024
  const emblemSize = 640;
  const offsetX = (width - emblemSize) / 2;
  const offsetY = (height - emblemSize) / 2 - 10;
  const scale = emblemSize / 512;

  const samples = 3; // 3x3 supersampling for anti-aliasing

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Dark luxurious radial gradient background (#16181E -> #0A0B0E)
      const dx = (x - width / 2) / (width / 2);
      const dy = (y - height / 2) / (height / 2);
      const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 1.4);
      
      let bgR = Math.round(22 - dist * 12);
      let bgG = Math.round(24 - dist * 13);
      let bgB = Math.round(30 - dist * 16);
      bgR = Math.max(8, Math.min(255, bgR));
      bgG = Math.max(9, Math.min(255, bgG));
      bgB = Math.max(12, Math.min(255, bgB));

      // Golden ambient glow behind helmet
      const hDistX = (x - width / 2) / (emblemSize * 0.6);
      const hDistY = (y - (height / 2 - 10)) / (emblemSize * 0.6);
      const hDist = Math.sqrt(hDistX * hDistX + hDistY * hDistY);
      if (hDist < 1.6) {
        const glowFactor = Math.max(0, 1 - hDist / 1.6) * 0.35;
        bgR = Math.round(bgR + glowFactor * 217);
        bgG = Math.round(bgG + glowFactor * 119);
        bgB = Math.round(bgB + glowFactor * 6);
      }

      // Check supersamples inside helmet
      let hits = 0;
      let gradSumR = 0, gradSumG = 0, gradSumB = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const sampleX = x + (sx + 0.5) / samples;
          const sampleY = y + (sy + 0.5) / samples;

          const vx = (sampleX - offsetX) / scale;
          const vy = (sampleY - offsetY) / scale;

          if (vx >= 0 && vx <= 512 && vy >= 0 && vy <= 512) {
            if (isInsideHelmet(vx, vy)) {
              hits++;
              const t = (vx / 512 * 0.4 + vy / 512 * 0.6);
              const col = getGoldColor(t);
              gradSumR += col.r;
              gradSumG += col.g;
              gradSumB += col.b;
            }
          }
        }
      }

      const coverage = hits / (samples * samples);
      let finalR = bgR;
      let finalG = bgG;
      let finalB = bgB;

      if (coverage > 0) {
        const goldR = gradSumR / hits;
        const goldG = gradSumG / hits;
        const goldB = gradSumB / hits;
        finalR = Math.round(bgR * (1 - coverage) + goldR * coverage);
        finalG = Math.round(bgG * (1 - coverage) + goldG * coverage);
        finalB = Math.round(bgB * (1 - coverage) + goldB * coverage);
      }

      const idx = (width * y + x) << 2;
      png.data[idx] = Math.max(0, Math.min(255, finalR));
      png.data[idx + 1] = Math.max(0, Math.min(255, finalG));
      png.data[idx + 2] = Math.max(0, Math.min(255, finalB));
      png.data[idx + 3] = 255; // Fully opaque alpha
    }
  }

  const buf = PNG.sync.write(png);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated ${outPath}: ${buf.length} bytes (Magic valid: ${buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a'})`);
}

function generateSplash(outPath) {
  console.log(`Generating Splash 2732x2732 -> ${outPath}`);
  const width = 2732;
  const height = 2732;
  const png = new PNG({ width, height });

  const emblemSize = 800;
  const offsetX = (width - emblemSize) / 2;
  const offsetY = (height - emblemSize) / 2 - 80;
  const scale = emblemSize / 512;

  const samples = 2; // 2x2 supersampling for 2732x2732

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Dark background with subtle radial vignette
      const dx = (x - width / 2) / (width / 2);
      const dy = (y - height / 2) / (height / 2);
      const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 1.5);

      let bgR = Math.round(14 - dist * 8);
      let bgG = Math.round(15 - dist * 8);
      let bgB = Math.round(18 - dist * 9);
      bgR = Math.max(6, Math.min(255, bgR));
      bgG = Math.max(7, Math.min(255, bgG));
      bgB = Math.max(9, Math.min(255, bgB));

      // Golden ambient glow
      const hDistX = (x - width / 2) / (emblemSize * 0.7);
      const hDistY = (y - offsetY - emblemSize / 2) / (emblemSize * 0.7);
      const hDist = Math.sqrt(hDistX * hDistX + hDistY * hDistY);
      if (hDist < 1.8) {
        const glow = Math.max(0, 1 - hDist / 1.8) * 0.28;
        bgR = Math.round(bgR + glow * 217);
        bgG = Math.round(bgG + glow * 119);
        bgB = Math.round(bgB + glow * 6);
      }

      // Check helmet
      let hits = 0;
      let gradSumR = 0, gradSumG = 0, gradSumB = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const sampleX = x + (sx + 0.5) / samples;
          const sampleY = y + (sy + 0.5) / samples;

          const vx = (sampleX - offsetX) / scale;
          const vy = (sampleY - offsetY) / scale;

          if (vx >= 0 && vx <= 512 && vy >= 0 && vy <= 512) {
            if (isInsideHelmet(vx, vy)) {
              hits++;
              const t = (vx / 512 * 0.4 + vy / 512 * 0.6);
              const col = getGoldColor(t);
              gradSumR += col.r;
              gradSumG += col.g;
              gradSumB += col.b;
            }
          }
        }
      }

      const coverage = hits / (samples * samples);
      let finalR = bgR;
      let finalG = bgG;
      let finalB = bgB;

      if (coverage > 0) {
        const goldR = gradSumR / hits;
        const goldG = gradSumG / hits;
        const goldB = gradSumB / hits;
        finalR = Math.round(bgR * (1 - coverage) + goldR * coverage);
        finalG = Math.round(bgG * (1 - coverage) + goldG * coverage);
        finalB = Math.round(bgB * (1 - coverage) + goldB * coverage);
      }

      const idx = (width * y + x) << 2;
      png.data[idx] = Math.max(0, Math.min(255, finalR));
      png.data[idx + 1] = Math.max(0, Math.min(255, finalG));
      png.data[idx + 2] = Math.max(0, Math.min(255, finalB));
      png.data[idx + 3] = 255;
    }
  }

  const buf = PNG.sync.write(png);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated ${outPath}: ${buf.length} bytes (Magic valid: ${buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a'})`);
  return buf;
}

// Generate files
const appIconPath = path.join('ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
generateAppIcon(appIconPath);

const splashBase = path.join('ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset');
const splashBuf = generateSplash(path.join(splashBase, 'splash-2732x2732.png'));

// Copy to splash variants
fs.writeFileSync(path.join(splashBase, 'splash-2732x2732-1.png'), splashBuf);
fs.writeFileSync(path.join(splashBase, 'splash-2732x2732-2.png'), splashBuf);
console.log('All iOS assets generated successfully.');

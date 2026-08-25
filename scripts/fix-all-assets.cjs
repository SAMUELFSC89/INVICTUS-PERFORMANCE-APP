const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// 1. Spartan helmet polygon definitions
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

function getGoldColor(t) {
  const stops = [
    { pos: 0.00, r: 255, g: 239, b: 166 },
    { pos: 0.20, r: 245, g: 171, b: 18  },
    { pos: 0.50, r: 217, g: 119, b: 6   },
    { pos: 0.80, r: 180, g: 83,  b: 9   },
    { pos: 1.00, r: 124, g: 45,  b: 18  }
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

function renderIcon(size, options = {}) {
  const png = new PNG({ width: size, height: size });
  const emblemSize = size * (options.emblemRatio || 0.62);
  const offsetX = (size - emblemSize) / 2;
  const offsetY = (size - emblemSize) / 2;
  const scale = emblemSize / 512;
  const samples = options.samples || (size > 256 ? 2 : 1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgR = 13, bgG = 14, bgB = 18, bgA = 255;
      if (options.transparent) {
        bgR = 0; bgG = 0; bgB = 0; bgA = 0;
      } else {
        const dx = (x - size / 2) / (size / 2);
        const dy = (y - size / 2) / (size / 2);
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 1.4);
        bgR = Math.max(8, Math.round(20 - dist * 10));
        bgG = Math.max(9, Math.round(22 - dist * 11));
        bgB = Math.max(12, Math.round(28 - dist * 14));
      }

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
      const idx = (size * y + x) << 2;

      if (options.transparent) {
        if (coverage > 0) {
          png.data[idx] = Math.round(gradSumR / hits);
          png.data[idx + 1] = Math.round(gradSumG / hits);
          png.data[idx + 2] = Math.round(gradSumB / hits);
          png.data[idx + 3] = Math.round(255 * coverage);
        } else {
          png.data[idx] = 0;
          png.data[idx + 1] = 0;
          png.data[idx + 2] = 0;
          png.data[idx + 3] = 0;
        }
      } else {
        if (coverage > 0) {
          const goldR = gradSumR / hits;
          const goldG = gradSumG / hits;
          const goldB = gradSumB / hits;
          png.data[idx] = Math.round(bgR * (1 - coverage) + goldR * coverage);
          png.data[idx + 1] = Math.round(bgG * (1 - coverage) + goldG * coverage);
          png.data[idx + 2] = Math.round(bgB * (1 - coverage) + goldB * coverage);
          png.data[idx + 3] = 255;
        } else {
          png.data[idx] = bgR;
          png.data[idx + 1] = bgG;
          png.data[idx + 2] = bgB;
          png.data[idx + 3] = 255;
        }
      }
    }
  }

  return PNG.sync.write(png);
}

// Generate public icons
console.log('Generating public icons...');
fs.writeFileSync('public/icon-512.png', renderIcon(512));
fs.writeFileSync('public/icon-512-maskable.png', renderIcon(512, { emblemRatio: 0.5 }));
fs.writeFileSync('public/icon-192.png', renderIcon(192));
fs.writeFileSync('public/icon-180.png', renderIcon(180));
fs.writeFileSync('public/apple-touch-icon.png', renderIcon(180));
fs.writeFileSync('public/brand-share.png', renderIcon(512));
fs.writeFileSync('public/favicon-32.png', renderIcon(32));
fs.writeFileSync('public/favicon-16.png', renderIcon(16));

// Preserve banner from root valid PNG
if (fs.existsSync('BANNER HOME POWER LIFT.png')) {
  const bannerBuf = fs.readFileSync('BANNER HOME POWER LIFT.png');
  fs.writeFileSync('public/banner_home_power_lift.png', bannerBuf);
  const bannerDirs = [
    'public/assets/banners',
    'public/assets/championships'
  ];
  for (const dir of bannerDirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'banner_home_power_lift.png'), bannerBuf);
  }
}

console.log('Public assets generated and restored.');

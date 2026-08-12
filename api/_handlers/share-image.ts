import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_lib/common.js';
import Jimp from 'jimp';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;

  if (!id) return res.status(400).send('ID skipping');

  try {
    let workoutDoc = await db.collection('workouts').doc(id as string).get();
    let workout = workoutDoc.data();

    if (!workout) {
      const sessionDoc = await db.collection('run_sessions').doc(id as string).get();
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();
        if (sessionData) {
          workout = {
            userId: sessionData.userId,
            type: 'workout',
            timestamp: sessionData.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            duration: Math.floor((new Date(sessionData.endTime).getTime() - new Date(sessionData.startTime).getTime()) / 60000),
            distance: sessionData.totalDistance / 1000,
            points: Math.floor((sessionData.totalDistance / 1000) * 10),
            photoUrl: sessionData.photoProof || null
          };
        }
      }
    }

    if (!workout) return res.status(404).send('No data');
    
    const userDoc = await db.collection('users').doc(workout.userId).get();
    const user = userDoc.data() || { displayName: 'Atleta' };

    // Create 1200x630 canvas
    const width = 1200;
    const height = 630;
    const image = new Jimp(width, height, '#0c0d10');

    // 1. Process Background Image
    if (workout.photoUrl) {
      try {
        let bgBuffer: Buffer | null = null;
        if (workout.photoUrl.startsWith('data:image')) {
          const base64Data = workout.photoUrl.split(',')[1];
          bgBuffer = Buffer.from(base64Data, 'base64');
        } else if (workout.photoUrl.startsWith('http')) {
          // Download from external URL
          const response = await fetch(workout.photoUrl);
          if (response.ok) {
            bgBuffer = Buffer.from(await response.arrayBuffer());
          }
        }
        
        if (bgBuffer) {
          const bgImage = await Jimp.read(bgBuffer);
          // Resize and center background
          bgImage.cover(width, height);
          bgImage.blur(2); // Light blur for style
          // Composite
          image.composite(bgImage, 0, 0);
        }
      } catch (err) {
        console.warn('Failed to load workout photo for share image:', err);
      }
    }

    // 2. Add Overlay Gradient (Bottom to Top)
    // We'll simulate a gradient with a semi-transparent rect
    const overlay = new Jimp(width, height, '#000000');
    overlay.opacity(0.6);
    image.composite(overlay, 0, 0);

    // 3. Load Fonts
    const fontTitle = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const fontStats = await Jimp.loadFont(Jimp.FONT_SANS_128_WHITE);
    const fontLabel = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontXP = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

    // 4. Draw Header
    image.print(fontTitle, 60, 60, 'INVICTUS');
    image.print(fontLabel, 60, 130, `@${user.displayName.toLowerCase().replace(/\s+/g, '')}`);

    // 5. Draw Main Stats (XP)
    const points = workout.points || (workout.distance ? Math.floor(workout.distance * 10) : 0);
    const xpText = `+${points} XP`;
    // Background for XP badge (using moove green #00E676)
    const xpBg = new Jimp(200, 60, '#00E676');
    image.composite(xpBg, 60, height - 120);
    image.print(fontXP, 80, height - 110, xpText);

    // 6. Draw Activity Type & Details
    const typeLabel = (workout.type === 'workout' ? 'TREINO 🔥' : 
                      workout.type === 'cardio' ? 'CORRIDA 🏃' : 
                      workout.type === 'diet' ? 'DIETA 🥗' : 'ATIVIDADE').toUpperCase();
    
    image.print(fontLabel, 300, height - 110, typeLabel);
    
    if (workout.distance > 0) {
      image.print(fontLabel, 600, height - 110, `${workout.distance.toFixed(2)} KM`);
    } else {
      image.print(fontLabel, 600, height - 110, `${workout.duration} MIN`);
    }

    // 7. Watermark
    image.print(fontLabel, width - 300, height - 60, 'INVICTUS.APP');

    // 8. Output Image
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h
    return res.send(buffer);
  } catch (error: any) {
    console.error('Image Generation Error:', error);
    return res.status(500).send('Internal Error');
  }
}

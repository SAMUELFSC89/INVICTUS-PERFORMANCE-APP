import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Captura o ID tanto de query param quanto de rota customizada se o server passar
  const id = req.query.id || (req as any).params?.id;

  if (!id) {
    return res.status(400).send('<h1>ID não fornecido</h1>');
  }

  try {
    let workoutDoc = await db.collection('workouts').doc(id as string).get();
    let workout = workoutDoc.data();
    let rawAppUrl = process.env.APP_URL || process.env.VITE_APP_URL || `https://${req.headers.host}`;
    if (rawAppUrl.includes('sem-desculpa.vercel.app')) {
      rawAppUrl = rawAppUrl.replace('sem-desculpa.vercel.app', 'www.invictusperformance.app.br');
    }
    const appUrl = rawAppUrl.replace(/\/$/, '');
    const shareUrl = `${appUrl}/share/${id}`;
    const imageUrl = `${appUrl}/api/share-image?id=${id}`;

    // Se não encontrar em workouts, tenta em run_sessions (específico para corridas rasteadas)
    if (!workout) {
      const sessionDoc = await db.collection('run_sessions').doc(id as string).get();
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();
        if (sessionData) {
          workout = {
            userId: sessionData.userId,
            type: 'cardio',
            timestamp: sessionData.createdAt?.toDate?.()?.toISOString() || sessionData.startTime,
            duration: sessionData.startTime && sessionData.endTime
              ? Math.floor((new Date(sessionData.endTime).getTime() - new Date(sessionData.startTime).getTime()) / 60000)
              : undefined,
            distance: Number.isFinite(Number(sessionData.totalDistance)) ? Number(sessionData.totalDistance) / 1000 : undefined,
            points: Number.isFinite(Number(sessionData.pointsEarned)) ? Number(sessionData.pointsEarned) : 0,
            status: sessionData.validationStatus,
            photoUrl: sessionData.photoProof || null
          };
        }
      }
    }

    if (!workout) {
      return res.status(404).send('<h1>Atividade não encontrada</h1>');
    }
    
    const userDoc = await db.collection('users').doc(workout.userId).get();
    const user = userDoc.data() || { displayName: 'Atleta' };

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = appUrl || `${protocol}://${req.headers.host}`;
    
    // Formatting
    const typeLabel = workout.type === 'workout' ? 'Treino 🔥' : 
                     workout.type === 'cardio' ? 'Corrida 🏃' : 
                     workout.type === 'diet' ? 'Dieta 🥗' : 'Atividade';
    
    const details = [
      Number.isFinite(Number(workout.distance)) ? `${Number(workout.distance).toFixed(2)} km` : null,
      Number.isFinite(Number(workout.duration)) ? `${Number(workout.duration)} min` : null,
    ].filter(Boolean).join(' em ');

    const rawStatus = String(workout.status || workout.validationStatus || '').toLowerCase();
    const approved = ['valid', 'validated', 'approved', 'homologada'].includes(rawStatus);
    const rejected = ['invalid', 'rejected', 'not_eligible', 'rejeitada', 'suspicious'].includes(rawStatus);
    const points = approved && Number.isFinite(Number(workout.points)) ? Number(workout.points) : 0;
    const title = `${user.displayName} concluiu um ${typeLabel}!`;
    const resultText = approved
      ? (points > 0 ? `Atividade aprovada com +${points} XP.` : 'Atividade aprovada.')
      : rejected
        ? 'Atividade registrada sem pontuação.'
        : 'Atividade em análise.';
    const description = `Atividade no INVICTUS. ${resultText}${details ? ` ${details}.` : ''}`;

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${shareUrl}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">

    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${shareUrl}">
    <meta property="twitter:title" content="${title}">
    <meta property="twitter:description" content="${description}">
    <meta property="twitter:image" content="${imageUrl}">

    <!-- Favicon -->
    <link rel="icon" href="${baseUrl}/favicon-32.png" type="image/png">

    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    
    <style>
        body {
            margin: 0;
            padding: 0;
            background-color: #0c0d10;
            color: #ffffff;
            font-family: 'Space Grotesk', sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .container {
            max-width: 480px;
            width: 90%;
            background: #16181d;
            border-radius: 28px;
            overflow: hidden;
            box-shadow: 0 30px 60px rgba(0,0,0,0.8);
            border: 1px solid rgba(255,255,255,0.08);
            margin-bottom: 40px;
        }
        .header {
            padding: 24px;
            text-align: center;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .photo-container {
            width: 100%;
            height: 260px;
            background-size: cover;
            background-position: center;
            position: relative;
            background-color: #1a1c23;
        }
        .stats {
            padding: 32px 24px;
        }
        .stat-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 24px;
        }
        .stat-item {
            flex: 1;
        }
        .stat-label {
            font-size: 11px;
            color: #8b949e;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-bottom: 6px;
            font-weight: 600;
        }
        .stat-value {
            font-size: 22px;
            font-weight: 700;
            color: #ffffff;
        }
        .xp-badge {
            background: linear-gradient(135deg, #00E676 0%, #00C853 100%);
            color: #000;
            padding: 6px 14px;
            border-radius: 20px;
            font-weight: 800;
            font-size: 15px;
            box-shadow: 0 4px 12px rgba(0, 230, 118, 0.3);
        }
        .footer {
            padding: 32px 24px;
            text-align: center;
            background: rgba(255,255,255,0.02);
        }
        .btn {
            display: block;
            background: #00E676;
            color: #000000;
            padding: 18px;
            border-radius: 14px;
            text-decoration: none;
            font-weight: 800;
            transition: all 0.3s ease;
            font-size: 16px;
            letter-spacing: 1px;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0,230,118,0.2);
        }
        .logo {
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
        }
        .logo img {
            height: 28px;
        }
        .logo span {
            font-weight: 800;
            font-size: 20px;
            letter-spacing: -0.5px;
            color: #00E676;
        }
        .user-tag {
            font-size: 14px;
            color: #8b949e;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">
                <img src="${baseUrl}/capacete.webp" alt="INVICTUS">
                <span>INVICTUS</span>
            </div>
            <div class="user-tag">@${user.displayName.toLowerCase().replace(/\s+/g, '')}</div>
        </div>
        
        <div class="photo-container" style="background-image: url('${workout.photoUrl || ''}')">
            ${!workout.photoUrl ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ffffff1a;font-size:80px">🔥</div>' : ''}
        </div>
        
        <div class="stats">
            <div class="stat-row">
                <div class="stat-item">
                    <div class="stat-label">Atividade</div>
                    <div class="stat-value">${typeLabel}</div>
                </div>
                <div class="stat-item" style="text-align: right;">
                    <div class="stat-label">Recompensa</div>
                    <div style="margin-top: 4px;"><span class="xp-badge">${approved ? (points > 0 ? `+${points} XP` : 'APROVADA') : rejected ? 'NÃO PONTUOU' : 'EM ANÁLISE'}</span></div>
                </div>
            </div>
            
            <div class="stat-row" style="margin-bottom: 0;">
                <div class="stat-item">
                    <div class="stat-label">Duração</div>
                    <div class="stat-value">${Number.isFinite(Number(workout.duration)) ? `${Number(workout.duration)} min` : '—'}</div>
                </div>
                ${Number.isFinite(Number(workout.distance)) && Number(workout.distance) > 0 ? `
                <div class="stat-item" style="text-align: right;">
                    <div class="stat-label">Distância</div>
                    <div class="stat-value">${Number(workout.distance).toFixed(2)} km</div>
                </div>
                ` : `
                <div class="stat-item" style="text-align: right;">
                    <div class="stat-label">Cidade</div>
                    <div class="stat-value">${user.city || 'Ranking Geral'}</div>
                </div>
                `}
            </div>
        </div>
        
        <div class="footer">
            <a href="${baseUrl}" class="btn">CONHECER O INVICTUS</a>
            <p style="margin-top: 20px; font-size: 12px; color: #555;">Desafie seus limites no ranking oficial</p>
        </div>
    </div>
    
    <div style="color: #444; font-size: 13px;">INVICTUS.APP</div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache 1h
    return res.status(200).send(html);
  } catch (error) {
    console.error('Share API Error:', error);
    return res.status(500).send('<h1>Erro interno no compartilhamento</h1>');
  }
}

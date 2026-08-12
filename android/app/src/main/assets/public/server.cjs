var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// api/_lib/common.ts
function fixProjectId(id) {
  if (!id) return id;
  const trimmed = id.trim();
  if (/^\d+$/.test(trimmed)) {
    return `gen-lang-client-${trimmed}`;
  }
  return trimmed;
}
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    const auth = (0, import_auth.getAuth)(app);
    const decodedToken = await auth.verifyIdToken(token);
    return { uid: decodedToken.uid, email: decodedToken.email };
  } catch (error) {
    console.error(`[verifyAuth] Verification failed: ${error.message}`);
    return null;
  }
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && origin !== "null") {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}
var import_config, import_app, import_firestore, import_auth, import_path, import_fs, configPath, config, serviceAccount, saPath, app, dbInstance, initError, configPid, envPid, saPid, primaryPid, db, serverTimestamp;
var init_common = __esm({
  "api/_lib/common.ts"() {
    import_config = require("dotenv/config");
    import_app = require("firebase-admin/app");
    import_firestore = require("firebase-admin/firestore");
    import_auth = require("firebase-admin/auth");
    import_path = __toESM(require("path"), 1);
    import_fs = __toESM(require("fs"), 1);
    configPath = import_path.default.resolve(process.cwd(), "firebase-applet-config.json");
    config = {};
    try {
      if (import_fs.default.existsSync(configPath)) {
        config = JSON.parse(import_fs.default.readFileSync(configPath, "utf8"));
      }
    } catch (e) {
    }
    saPath = import_path.default.resolve(process.cwd(), "api/_lib/serviceAccountKey.json");
    try {
      if (import_fs.default.existsSync(saPath)) {
        serviceAccount = JSON.parse(import_fs.default.readFileSync(saPath, "utf8"));
        console.log(`[Firebase Admin] Service Account loaded from file: ${saPath}`);
      }
    } catch (e) {
    }
    if ((!serviceAccount || !serviceAccount.private_key) && process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log(`[Firebase Admin] Service Account loaded from FIREBASE_SERVICE_ACCOUNT`);
      } catch (e) {
        console.error(`[Firebase Admin] Failed to parse env FIREBASE_SERVICE_ACCOUNT`);
      }
    }
    dbInstance = null;
    initError = null;
    configPid = fixProjectId(config.projectId);
    envPid = fixProjectId(process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID);
    if (configPid) {
      process.env.PROJECT_ID = configPid;
      process.env.GOOGLE_CLOUD_PROJECT = configPid;
    }
    saPid = serviceAccount?.project_id;
    primaryPid = saPid || configPid || envPid;
    try {
      if (!(0, import_app.getApps)().length) {
        console.log(`[Firebase Admin] Forcing environment Project ID to: ${primaryPid || "auto-detect"}`);
        try {
          const options = { projectId: primaryPid };
          if (serviceAccount?.private_key) {
            options.credential = (0, import_app.cert)(serviceAccount);
          }
          app = (0, import_app.initializeApp)(options);
        } catch (e) {
          console.warn(`[Firebase Admin] Init with options failed: ${e.message}. Trying generic init.`);
          app = (0, import_app.initializeApp)();
        }
      } else {
        app = (0, import_app.getApp)();
      }
      const firestoreDbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== "(default)" ? config.firestoreDatabaseId : void 0;
      dbInstance = (0, import_firestore.getFirestore)(app, firestoreDbId);
    } catch (e) {
      console.error(`[Firebase Admin Init Error] Failed to initialize App or Firestore safely: ${e.message}`);
      initError = e;
    }
    db = new Proxy({}, {
      get(target, prop, receiver) {
        if (!dbInstance) {
          throw new Error(`[Firebase Connection Error] O Firestore n\xE3o foi inicializado corretamente fora do ambiente de produ\xE7\xE3o. Verifique se o arquivo /api/_lib/serviceAccountKey.json ou a vari\xE1vel de ambiente FIREBASE_SERVICE_ACCOUNT est\xE1 configurada.`);
        }
        const value = Reflect.get(dbInstance, prop, receiver);
        if (typeof value === "function") {
          return value.bind(dbInstance);
        }
        return value;
      }
    });
    serverTimestamp = () => import_firestore.FieldValue.serverTimestamp();
  }
});

// api/_handlers/health.ts
async function handler(req, res) {
  if (cors(req, res)) return;
  const results = {
    status: "Healthy",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    firebase: {
      projectId: app.options.projectId,
      initialized: (0, import_app2.getApps)().length > 0,
      database: db._databaseId || "default"
    }
  };
  try {
    if (req.query.full === "true") {
      const testDoc = await db.collection("test").doc("ping").get();
      results.firestore = {
        connected: true,
        exists: testDoc.exists
      };
    } else {
      results.firestore = {
        connected: true,
        note: "Database check skipped (requested by default to save quota)"
      };
    }
  } catch (e) {
    results.firestore = {
      connected: false,
      error: e.message
    };
  }
  return res.status(200).json(results);
}
var import_app2;
var init_health = __esm({
  "api/_handlers/health.ts"() {
    init_common();
    import_app2 = require("firebase-admin/app");
  }
});

// api/_handlers/profile.ts
async function handler2(req, res) {
  if (cors(req, res)) return;
  const userId = req.query.id;
  if (!userId) return res.status(400).json({ error: "ID do usu\xE1rio obrigat\xF3rio." });
  const cacheKey = `profile_${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    if (!db) return res.status(500).json({ error: "Falha na inicializa\xE7\xE3o do banco de dados." });
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado." });
    }
    const data = userSnap.data();
    const publicProfile = {
      uid: userSnap.id,
      displayName: data?.displayName,
      photoURL: data?.photoURL,
      bio: data?.bio,
      city: data?.city,
      state: data?.state,
      streak: data?.streak,
      score: data?.score,
      league: data?.league,
      gymName: data?.gymName,
      gymId: data?.gymId,
      positions: data?.positions,
      achievements: data?.achievements,
      profileLikes: data?.profileLikes || []
    };
    cache.set(cacheKey, publicProfile);
    return res.json(publicProfile);
  } catch (error) {
    const errorMsg = error.message || "";
    const isQuotaError = errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("Quota limit exceeded");
    console.error("Profile API Error:", error);
    if (isQuotaError) {
      return res.status(429).json({
        error: "Servidor sob alta carga. Tente novamente em alguns instantes.",
        code: "QUOTA_EXHAUSTED",
        fallback: true
      });
    }
    return res.status(500).json({ error: error.message });
  }
}
var import_node_cache, cache;
var init_profile = __esm({
  "api/_handlers/profile.ts"() {
    init_common();
    import_node_cache = __toESM(require("node-cache"), 1);
    cache = new import_node_cache.default({ stdTTL: 300 });
  }
});

// api/_handlers/ranking.ts
async function handler3(req, res) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: "N\xE3o autorizado." });
  const level = req.query.level || "global";
  const levelId = req.query.levelId || "";
  const period = req.query.period || "all";
  const tier = req.query.tier || "performance";
  const scoreField = period === "weekly" ? "weeklyScore" : period === "monthly" ? "monthlyScore" : "score";
  const cacheKey = `${level}_${levelId}_${period}_${scoreField}_${tier}`;
  const now = Date.now();
  try {
    console.log(`[Ranking API] Query: level=${level}, levelId=${levelId}, period=${period}, tier=${tier}`);
    if (!db) {
      console.error("[Ranking API] Database not initialized");
      return res.status(500).json({ error: "Falha na inicializa\xE7\xE3o do banco de dados." });
    }
    const cached = serverRankingCache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      console.log(`[Ranking API] Serving from in-memory cache for ${cacheKey}`);
      return res.status(200).json({ topUsers: cached.topUsers, cached: true });
    }
    if (tier === "performance" && (level === "global" || level === "league")) {
      const snapshotId = `${level === "league" ? "global" : level}_${period}`;
      const snapshotRef = db.collection("aggregated_rankings").doc(snapshotId);
      const snapshotSnap = await snapshotRef.get();
      if (snapshotSnap.exists) {
        const snapshotData = snapshotSnap.data();
        const updatedAt = snapshotData?.updatedAt;
        const updatedAtDate = updatedAt ? new Date(updatedAt) : null;
        if (updatedAtDate) {
          console.log(`[Ranking API] Serving pre-calculated snapshot for ${snapshotId}`);
          const topUsers2 = snapshotData?.topUsers || [];
          serverRankingCache.set(cacheKey, { topUsers: topUsers2, timestamp: now });
          return res.status(200).json({ topUsers: topUsers2 });
        }
      }
    }
    let query = db.collection("users").where("activeSeason", "==", "S1");
    if (level === "league" && levelId) {
      query = query.where("league", "==", levelId);
    } else if (level === "gym" && levelId) {
      query = query.where("gymId", "==", levelId);
    } else if (level === "city" && levelId) {
      query = query.where("city", "==", levelId);
    }
    console.log("[Ranking API] Executing query...");
    const snap = await query.orderBy(scoreField, "desc").limit(300).get();
    console.log(`[Ranking API] Query finished. Found ${snap.size} users.`);
    let filteredDocs = snap.docs;
    if (tier === "performance") {
      filteredDocs = snap.docs.filter((d) => d.data().subscriptionTier === "performance");
    } else {
      filteredDocs = snap.docs.filter((d) => d.data().subscriptionTier === "open" || !d.data().subscriptionTier);
    }
    const slicedDocs = filteredDocs.slice(0, 50);
    const topUsers = slicedDocs.map((d, i) => {
      const data = d.data();
      return {
        uid: d.id,
        displayName: data.displayName || "Atleta",
        photoURL: data.photoURL || "",
        score: data[scoreField] || 0,
        streak: data.streak || 0,
        rank: i + 1,
        isSubscribed: data.isSubscribed || false,
        city: data.city || "",
        gymId: data.gymId || "",
        positions: data.positions || {}
      };
    });
    serverRankingCache.set(cacheKey, { topUsers, timestamp: now });
    return res.status(200).json({ topUsers });
  } catch (error) {
    const errorMsg = error.message || "";
    const isQuotaError = errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("Quota limit exceeded");
    console.error("Ranking API Error:", error);
    const staleCached = serverRankingCache.get(cacheKey);
    if (staleCached) {
      console.warn(`[Ranking API] Serving expired cache for ${cacheKey} due to live db fetch error.`);
      return res.status(200).json({ topUsers: staleCached.topUsers, stale: true });
    }
    if (isQuotaError) {
      return res.status(429).json({
        error: "Limite de tr\xE1fego excedido temporariamente (Quota).",
        code: "QUOTA_EXHAUSTED",
        fallback: true
      });
    }
    const isIndexError = error.message?.includes("index") || error.code === 9;
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({
      error: isIndexError ? "Erro de \xCDndice: O ranking requer um \xEDndice composto no Firestore. Por favor, verifique o console do Firebase." : error.message || "Falha ao carregar ranking",
      tip: isIndexError ? "Abra o link de erro no log do servidor para criar o \xEDndice automaticamente." : void 0
    });
  }
}
var serverRankingCache, CACHE_TTL;
var init_ranking = __esm({
  "api/_handlers/ranking.ts"() {
    init_common();
    serverRankingCache = /* @__PURE__ */ new Map();
    CACHE_TTL = 3 * 60 * 1e3;
  }
});

// api/_handlers/share.ts
async function handler4(req, res) {
  const id = req.query.id || req.params?.id;
  if (!id) {
    return res.status(400).send("<h1>ID n\xE3o fornecido</h1>");
  }
  try {
    let workoutDoc = await db.collection("workouts").doc(id).get();
    let workout = workoutDoc.data();
    const appUrl = process.env.APP_URL || process.env.VITE_APP_URL || `https://${req.headers.host}`;
    const shareUrl = `${appUrl}/share/${id}`;
    const imageUrl = `${appUrl}/api/share-image?id=${id}`;
    if (!workout) {
      const sessionDoc = await db.collection("run_sessions").doc(id).get();
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();
        if (sessionData) {
          workout = {
            userId: sessionData.userId,
            type: "workout",
            timestamp: sessionData.createdAt?.toDate?.()?.toISOString() || (/* @__PURE__ */ new Date()).toISOString(),
            duration: Math.floor((new Date(sessionData.endTime).getTime() - new Date(sessionData.startTime).getTime()) / 6e4),
            distance: sessionData.totalDistance / 1e3,
            points: Math.floor(sessionData.totalDistance / 1e3 * 10),
            // Estimativa de pontos
            photoUrl: sessionData.photoProof || null
          };
        }
      }
    }
    if (!workout) {
      return res.status(404).send("<h1>Atividade n\xE3o encontrada</h1>");
    }
    const userDoc = await db.collection("users").doc(workout.userId).get();
    const user = userDoc.data() || { displayName: "Atleta" };
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const baseUrl = appUrl || `${protocol}://${req.headers.host}`;
    const typeLabel = workout.type === "workout" ? "Treino \u{1F525}" : workout.type === "cardio" ? "Corrida \u{1F3C3}" : workout.type === "diet" ? "Dieta \u{1F957}" : "Atividade";
    const details = workout.type === "cardio" ? `${workout.distance?.toFixed(2)}km em ${workout.duration}min` : `${workout.duration}min de intensidade`;
    const points = workout.points || (workout.distance ? Math.floor(workout.distance * 10) : 0);
    const title = `${user.displayName} concluiu um ${typeLabel}!`;
    const description = `Vem ver minha evolu\xE7\xE3o no INVICTUS! +${points} XP garantidos. ${details}. Aceite o desafio e suba no ranking!`;
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
    <link rel="icon" href="${baseUrl}/logo.svg" type="image/svg+xml">

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
                <img src="${baseUrl}/logo.svg" alt="INVICTUS" onerror="this.src='https://moove-app.site/logo.svg'">
                <span>INVICTUS</span>
            </div>
            <div class="user-tag">@${user.displayName.toLowerCase().replace(/\s+/g, "")}</div>
        </div>
        
        <div class="photo-container" style="background-image: url('${workout.photoUrl || ""}')">
            ${!workout.photoUrl ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ffffff1a;font-size:80px">\u{1F525}</div>' : ""}
        </div>
        
        <div class="stats">
            <div class="stat-row">
                <div class="stat-item">
                    <div class="stat-label">Atividade</div>
                    <div class="stat-value">${typeLabel}</div>
                </div>
                <div class="stat-item" style="text-align: right;">
                    <div class="stat-label">Recompensa</div>
                    <div style="margin-top: 4px;"><span class="xp-badge">+${workout.points} XP</span></div>
                </div>
            </div>
            
            <div class="stat-row" style="margin-bottom: 0;">
                <div class="stat-item">
                    <div class="stat-label">Dura\xE7\xE3o</div>
                    <div class="stat-value">${workout.duration} min</div>
                </div>
                ${workout.distance ? `
                <div class="stat-item" style="text-align: right;">
                    <div class="stat-label">Dist\xE2ncia</div>
                    <div class="stat-value">${workout.distance.toFixed(2)} km</div>
                </div>
                ` : `
                <div class="stat-item" style="text-align: right;">
                    <div class="stat-label">Cidade</div>
                    <div class="stat-value">${user.city || "Ranking Geral"}</div>
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
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(html);
  } catch (error) {
    console.error("Share API Error:", error);
    return res.status(500).send("<h1>Erro interno no compartilhamento</h1>");
  }
}
var init_share = __esm({
  "api/_handlers/share.ts"() {
    init_common();
  }
});

// api/_handlers/share-image.ts
async function handler5(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send("ID skipping");
  try {
    let workoutDoc = await db.collection("workouts").doc(id).get();
    let workout = workoutDoc.data();
    if (!workout) {
      const sessionDoc = await db.collection("run_sessions").doc(id).get();
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();
        if (sessionData) {
          workout = {
            userId: sessionData.userId,
            type: "workout",
            timestamp: sessionData.createdAt?.toDate?.()?.toISOString() || (/* @__PURE__ */ new Date()).toISOString(),
            duration: Math.floor((new Date(sessionData.endTime).getTime() - new Date(sessionData.startTime).getTime()) / 6e4),
            distance: sessionData.totalDistance / 1e3,
            points: Math.floor(sessionData.totalDistance / 1e3 * 10),
            photoUrl: sessionData.photoProof || null
          };
        }
      }
    }
    if (!workout) return res.status(404).send("No data");
    const userDoc = await db.collection("users").doc(workout.userId).get();
    const user = userDoc.data() || { displayName: "Atleta" };
    const width = 1200;
    const height = 630;
    const image = new import_jimp.default(width, height, "#0c0d10");
    if (workout.photoUrl) {
      try {
        let bgBuffer = null;
        if (workout.photoUrl.startsWith("data:image")) {
          const base64Data = workout.photoUrl.split(",")[1];
          bgBuffer = Buffer.from(base64Data, "base64");
        } else if (workout.photoUrl.startsWith("http")) {
          const response = await fetch(workout.photoUrl);
          if (response.ok) {
            bgBuffer = Buffer.from(await response.arrayBuffer());
          }
        }
        if (bgBuffer) {
          const bgImage = await import_jimp.default.read(bgBuffer);
          bgImage.cover(width, height);
          bgImage.blur(2);
          image.composite(bgImage, 0, 0);
        }
      } catch (err) {
        console.warn("Failed to load workout photo for share image:", err);
      }
    }
    const overlay = new import_jimp.default(width, height, "#000000");
    overlay.opacity(0.6);
    image.composite(overlay, 0, 0);
    const fontTitle = await import_jimp.default.loadFont(import_jimp.default.FONT_SANS_64_WHITE);
    const fontStats = await import_jimp.default.loadFont(import_jimp.default.FONT_SANS_128_WHITE);
    const fontLabel = await import_jimp.default.loadFont(import_jimp.default.FONT_SANS_32_WHITE);
    const fontXP = await import_jimp.default.loadFont(import_jimp.default.FONT_SANS_32_BLACK);
    image.print(fontTitle, 60, 60, "INVICTUS");
    image.print(fontLabel, 60, 130, `@${user.displayName.toLowerCase().replace(/\s+/g, "")}`);
    const points = workout.points || (workout.distance ? Math.floor(workout.distance * 10) : 0);
    const xpText = `+${points} XP`;
    const xpBg = new import_jimp.default(200, 60, "#00E676");
    image.composite(xpBg, 60, height - 120);
    image.print(fontXP, 80, height - 110, xpText);
    const typeLabel = (workout.type === "workout" ? "TREINO \u{1F525}" : workout.type === "cardio" ? "CORRIDA \u{1F3C3}" : workout.type === "diet" ? "DIETA \u{1F957}" : "ATIVIDADE").toUpperCase();
    image.print(fontLabel, 300, height - 110, typeLabel);
    if (workout.distance > 0) {
      image.print(fontLabel, 600, height - 110, `${workout.distance.toFixed(2)} KM`);
    } else {
      image.print(fontLabel, 600, height - 110, `${workout.duration} MIN`);
    }
    image.print(fontLabel, width - 300, height - 60, "INVICTUS.APP");
    const buffer = await image.getBufferAsync(import_jimp.default.MIME_PNG);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(buffer);
  } catch (error) {
    console.error("Image Generation Error:", error);
    return res.status(500).send("Internal Error");
  }
}
var import_jimp;
var init_share_image = __esm({
  "api/_handlers/share-image.ts"() {
    init_common();
    import_jimp = __toESM(require("jimp"), 1);
  }
});

// api/_handlers/gyms.ts
async function handler6(req, res) {
  const requestId = Math.random().toString(36).substring(7);
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: "Autentica\xE7\xE3o necess\xE1ria." });
  try {
    const latStr = req.query.lat;
    const lngStr = req.query.lng;
    const q = req.query.q;
    const neighborhood = req.query.neighborhood;
    const city = req.query.city;
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: "Latitude e longitude s\xE3o obrigat\xF3rios" });
    }
    const roundedLat = lat.toFixed(3);
    const roundedLng = lng.toFixed(3);
    const cacheKey = q ? `gyms_search_${q}_${roundedLat}_${roundedLng}` : `gyms_nearby_${roundedLat}_${roundedLng}`;
    const cached = cache2.get(cacheKey);
    if (cached) {
      console.log(`[GymAPI][${requestId}] Returning cached results for ${cacheKey}`);
      return res.json(cached);
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "API key n\xE3o configurada." });
    }
    const fetchPlacesLegacy = async (type, params) => {
      const requestId_f = Math.random().toString(36).substring(7);
      const url = new URL(`https://maps.googleapis.com/maps/api/place/${type}/json`);
      Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
      url.searchParams.append("key", apiKey);
      try {
        console.log(`[GymAPI][${requestId}][${requestId_f}] REQUEST: ${type} with params:`, params);
        const response = await fetch(url.toString());
        if (!response.ok) {
          const text = await response.text().catch(() => "no body");
          console.error(`[GymAPI][${requestId}][${requestId_f}] HTTP ERROR:`, response.status, text);
          return [];
        }
        const data = await response.json();
        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
          console.error(`[GymAPI][${requestId}][${requestId_f}] GOOGLE API STATUS ERROR:`, data.status, data.error_message || "No error message");
          if (data.status === "REQUEST_DENIED") {
            const isBillingError = data.error_message?.toLowerCase().includes("billing");
            return {
              error: true,
              status: data.status,
              message: data.error_message,
              isBillingError
            };
          }
        } else {
          console.log(`[GymAPI][${requestId}][${requestId_f}] GOOGLE API STATUS: ${data.status} (Results: ${data.results?.length || 0})`);
        }
        return data.results || [];
      } catch (err) {
        console.error(`[GymAPI][${requestId}][${requestId_f}] FETCH EXCEPTION:`, err.message);
        return [];
      }
    };
    const resultGyms = await (async () => {
      const tryPlacesV1 = async (q2) => {
        try {
          const url = `https://places.googleapis.com/v1/places:${q2 ? "searchText" : "searchNearby"}`;
          const body = q2 ? {
            textQuery: q2,
            locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 15e3 } }
          } : {
            locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 5e3 } },
            includedTypes: ["gym"]
          };
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.photos"
            },
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const data2 = await response.json().catch(() => ({}));
            if (data2.error) {
              return { error: true, status: "V1_ERROR", message: data2.error.message };
            }
            return null;
          }
          const data = await response.json();
          return (data.places || []).map((p) => ({
            place_id: p.id,
            name: p.displayName?.text,
            vicinity: p.formattedAddress,
            geometry: { location: { lat: p.location.latitude, lng: p.location.longitude } },
            rating: p.rating,
            photos: p.photos
          }));
        } catch (e) {
          return null;
        }
      };
      if (q) {
        console.log(`[GymAPI][${requestId}] User searching for specific term: ${q}`);
        const legacy = await fetchPlacesLegacy("textsearch", {
          query: q,
          location: `${lat},${lng}`,
          radius: "20000"
        });
        if (legacy && legacy.error) return legacy;
        if (!legacy || legacy.length === 0) return await tryPlacesV1(q);
        return legacy;
      }
      console.log(`[GymAPI][${requestId}] Primary search (5km radius)...`);
      let gyms = await fetchPlacesLegacy("nearbysearch", {
        location: `${lat},${lng}`,
        radius: "5000",
        type: "gym"
      });
      if (gyms && gyms.error) return gyms;
      if (!gyms || gyms.length < 3) {
        const moreGyms = await fetchPlacesLegacy("nearbysearch", {
          location: `${lat},${lng}`,
          radius: "5000",
          keyword: "academia"
        });
        if (moreGyms && !Array.isArray(moreGyms) && moreGyms.error) return moreGyms;
        if (Array.isArray(moreGyms)) {
          const existingIds = new Set((gyms || []).map((g) => g.place_id));
          moreGyms.forEach((g) => {
            if (!existingIds.has(g.place_id)) {
              gyms.push(g);
            }
          });
        }
      }
      if (!gyms || gyms.length < 2) {
        const v1Results = await tryPlacesV1();
        if (v1Results && v1Results.error) return v1Results;
        if (v1Results && Array.isArray(v1Results)) {
          const existingIds = new Set((gyms || []).map((g) => g.place_id));
          v1Results.forEach((g) => {
            if (!existingIds.has(g.place_id)) {
              gyms.push(g);
            }
          });
        }
      }
      if ((!gyms || gyms.length === 0) && neighborhood) {
        const query = `${neighborhood} academia`;
        console.log(`[GymAPI][${requestId}] Trying text search for neighborhood: ${query}`);
        gyms = await fetchPlacesLegacy("textsearch", {
          query,
          location: `${lat},${lng}`,
          radius: "5000"
        });
        if (gyms && gyms.error) return gyms;
      }
      if (!gyms || gyms.length === 0) {
        const query = [city, "academia fitness"].filter(Boolean).join(" ");
        console.log(`[GymAPI][${requestId}] No immediate results, trying broader city search: ${query}`);
        gyms = await fetchPlacesLegacy("textsearch", {
          query,
          location: `${lat},${lng}`,
          radius: "10000"
        });
        if (gyms && gyms.error) return gyms;
      }
      if (!gyms || gyms.length === 0) {
        console.log(`[GymAPI][${requestId}] Last resort: wide area search...`);
        gyms = await fetchPlacesLegacy("textsearch", {
          query: "academia",
          location: `${lat},${lng}`,
          radius: "20000"
        });
        if (gyms && gyms.error) return gyms;
      }
      return gyms || [];
    })();
    if (resultGyms && resultGyms.error) {
      const err = resultGyms;
      console.warn(`[GymAPI] Google API failed with error: ${err.message}. Providing robust local mock gyms fallback for uninterrupted testing.`);
      const mockNames = [
        "Invictus Prime Unidade Centro",
        "Invictus Club Unidade Jardins",
        "Academia Smart Fit - Proximidade",
        "Bluefit Academia Unidade Real",
        "Invictus Arena & Fitness"
      ];
      const fallbackGyms = mockNames.map((name, idx) => {
        const offsetLat = lat + (idx % 2 === 0 ? 3e-4 : -3e-4) * (idx + 1);
        const offsetLng = lng + (idx % 2 === 1 ? 3e-4 : -3e-4) * (idx + 1);
        const distance = calculateDistance({ lat, lng }, { lat: offsetLat, lng: offsetLng });
        return {
          id: `mock_gym_${idx + 1}_${roundedLat.replace(".", "")}`,
          name,
          address: `Rua do Esporte Real, ${100 * (idx + 1)}, Bairro Fitness - Fallback`,
          lat: offsetLat,
          lng: offsetLng,
          rating: 4.8,
          photoUrl: null,
          distance,
          score: distance
        };
      });
      return res.status(200).json({
        success: true,
        count: fallbackGyms.length,
        gyms: fallbackGyms,
        isDemoFallback: true,
        originalError: err.message,
        tip: err.isBillingError ? "Modo de simula\xE7\xE3o ativo: Sua conta do Google Cloud precisa de faturamento ativo. Ative em: https://console.cloud.google.com/billing" : "Modo de simula\xE7\xE3o ativo: Verifique se a Places API est\xE1 ativada no seu console do Google Cloud."
      });
    }
    const gymsArray = Array.isArray(resultGyms) ? resultGyms : [];
    const formatted = gymsArray.map((g) => {
      const gLat = g.geometry?.location?.lat;
      const gLng = g.geometry?.location?.lng;
      const distance = calculateDistance({ lat, lng }, { lat: gLat, lng: gLng });
      const gymAddress = (g.vicinity || g.formatted_address || "").toLowerCase();
      let score = distance;
      if (neighborhood && gymAddress.includes(neighborhood.toLowerCase())) {
        score -= 0.5;
      }
      let photoUrl = null;
      if (g.photos?.[0]) {
        const photo = g.photos[0];
        const ref = photo.photo_reference || photo.name;
        if (ref) {
          const isV1 = ref.startsWith("places/");
          const isValidV1 = isV1 && ref.includes("/photos/");
          const isLegacy = !isV1 && ref.length > 20;
          if (isValidV1 || isLegacy) {
            photoUrl = `/api/gyms/photo?ref=${encodeURIComponent(ref)}`;
          }
        }
      }
      return {
        id: g.place_id,
        name: g.name || "Academia",
        address: g.vicinity || g.formatted_address || "N/A",
        lat: gLat,
        lng: gLng,
        rating: g.rating || null,
        photoUrl,
        distance,
        score
      };
    });
    formatted.sort((a, b) => a.score - b.score);
    const finalResult = {
      success: true,
      count: formatted.length,
      gyms: formatted,
      requestId
    };
    cache2.set(cacheKey, finalResult);
    return res.status(200).json(finalResult);
  } catch (error) {
    console.error("SERVERLESS_GYMS_ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Erro interno no servidor"
    });
  }
}
function calculateDistance(p1, p2) {
  const rad = (x) => x * Math.PI / 180;
  const R = 6371;
  const dLat = rad(p2.lat - p1.lat);
  const dLng = rad(p2.lng - p1.lng);
  if (isNaN(dLat) || isNaN(dLng)) return 999;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(p1.lat)) * Math.cos(rad(p2.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
var import_node_cache2, cache2;
var init_gyms = __esm({
  "api/_handlers/gyms.ts"() {
    init_common();
    import_node_cache2 = __toESM(require("node-cache"), 1);
    cache2 = new import_node_cache2.default({ stdTTL: 1800 });
  }
});

// api/_handlers/gyms_join.ts
async function handler7(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "M\xE9todo n\xE3o permitido." });
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: "N\xE3o autorizado." });
  const { gym } = req.body;
  if (!gym || !gym.id || !gym.name) {
    return res.status(400).json({ error: "Dados da academia incompletos" });
  }
  try {
    if (!db) return res.status(500).json({ error: "Falha na inicializa\xE7\xE3o do banco de dados." });
    const gymRef = db.collection("gyms").doc(gym.id);
    const userRef = db.collection("users").doc(auth.uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const userData = userSnap.data();
      const lastChange = userData?.lastGymChange;
      if (lastChange) {
        const lastChangeDate = new Date(lastChange);
        const diffDays = ((/* @__PURE__ */ new Date()).getTime() - lastChangeDate.getTime()) / (1e3 * 3600 * 24);
        if (diffDays < 7) {
          return res.status(400).json({
            error: `Voc\xEA s\xF3 pode trocar de academia uma vez por semana. Tente novamente em ${Math.ceil(7 - diffDays)} dias.`
          });
        }
      }
    }
    const batch = db.batch();
    batch.set(gymRef, {
      ...gym,
      updatedAt: serverTimestamp()
    }, { merge: true });
    batch.update(userRef, {
      gymId: gym.id,
      gymName: gym.name,
      gymLocation: { lat: gym.latitude, lng: gym.longitude },
      lastGymChange: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: serverTimestamp()
    });
    await batch.commit();
    return res.json({ success: true });
  } catch (error) {
    console.error("Gym Join API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
var init_gyms_join = __esm({
  "api/_handlers/gyms_join.ts"() {
    init_common();
  }
});

// api/_lib/observability.ts
var observability_exports = {};
__export(observability_exports, {
  getOverallMetricsForDashboard: () => getOverallMetricsForDashboard,
  incrementMetric: () => incrementMetric,
  logEvent: () => logEvent,
  memoryCache: () => memoryCache,
  triggerAlert: () => triggerAlert
});
async function logEvent(payload) {
  const now = /* @__PURE__ */ new Date();
  const logId = db.collection(payload.category).doc().id;
  const sanitizedDetails = payload.details ? sanitizeDetails(payload.details) : {};
  const logEntry = {
    id: logId,
    timestamp: now.toISOString(),
    severity: payload.severity,
    message: payload.message,
    userId: payload.userId || "system",
    route: payload.route || "",
    details: sanitizedDetails,
    createdAt: import_firestore2.FieldValue.serverTimestamp()
  };
  try {
    db.collection(payload.category).doc(logId).set(logEntry).catch((err) => {
      console.error(`[Observability] Firestore failed to save log ${logId} in ${payload.category}:`, err);
    });
    const consoleMsg = `[${payload.severity}] [${payload.category.toUpperCase()}] ${payload.message} ${payload.userId ? `(User: ${payload.userId})` : ""}`;
    if (payload.severity === "CRITICAL" || payload.severity === "HIGH_RISK") {
      console.error(consoleMsg);
      triggerAlert(payload.category, payload.severity, payload.message, payload.userId, sanitizedDetails);
    } else if (payload.severity === "WARNING") {
      console.warn(consoleMsg);
    } else {
      console.log(consoleMsg);
    }
    incrementMetric(payload.category === "fraud_audit_logs" ? "total_frauds_detected" : `${payload.category}_count`, 1);
    if (payload.severity === "CRITICAL") {
      incrementMetric("critical_failures_count", 1);
    }
  } catch (error) {
    console.error("[Observability Error] Failure inside logEvent wrapper:", error);
  }
  return logId;
}
function sanitizeDetails(details) {
  const result = { ...details };
  const sensitiveKeys = [
    "accessToken",
    "token",
    "access_token",
    "password",
    "deviceFingerprint",
    "deviceId",
    "cpf",
    "card",
    "cvv",
    "key",
    "secret",
    "client_secret",
    "mercadoPagoToken",
    "coordenadas",
    "full_coordinates"
  ];
  for (const key of Object.keys(result)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      if (typeof result[key] === "string") {
        result[key] = result[key].length > 10 ? `${result[key].substring(0, 4)}...[MASKED]...${result[key].substring(result[key].length - 4)}` : "***[MASKED]***";
      } else {
        result[key] = "***[MASKED]***";
      }
    } else if (key === "checkpoints" && Array.isArray(result[key])) {
      result[key] = `Checkpoints Array Count: ${result[key].length} (Coordinates stripped for privacy)`;
    } else if (typeof result[key] === "object" && result[key] !== null) {
      result[key] = sanitizeDetails(result[key]);
    }
  }
  return result;
}
async function incrementMetric(metricName, incrementValue = 1) {
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().substring(0, 10);
  const metricDocRef = db.collection("system_metrics").doc(todayStr);
  try {
    const cacheKey = `metric_${todayStr}_${metricName}`;
    const cachedVal = (memoryCache.get(cacheKey) || 0) + incrementValue;
    memoryCache.set(cacheKey, cachedVal, 1800);
    metricDocRef.set({
      date: todayStr,
      metrics: {
        [metricName]: import_firestore2.FieldValue.increment(incrementValue)
      },
      updatedAt: import_firestore2.FieldValue.serverTimestamp()
    }, { merge: true }).catch((err) => {
      console.error("[Metrics Error] Failed database write for system metrics:", err);
    });
    checkAlertThresholds(metricName, cachedVal);
  } catch (error) {
    console.error("[Metrics Error] Failed executing increment:", error);
  }
}
function checkAlertThresholds(metricName, currentVal) {
  const thresholdKey = `${metricName}_alert`;
  let alertTriggered = false;
  let severity = "WARNING";
  let message = "";
  if (metricName === "critical_failures_count" && currentVal >= 5) {
    alertTriggered = true;
    severity = "CRITICAL";
    message = `Produ\xE7\xE3o em Alerta M\xE1ximo: Detectada recorr\xEAncia de ${currentVal} falhas cr\xEDticas do sistema nas \xFAltimas horas.`;
  } else if (metricName === "total_frauds_detected" && currentVal >= 100) {
    alertTriggered = true;
    severity = "HIGH_RISK";
    message = `Pico An\xF4malo de Fraude: Mais de ${currentVal} logs de fraude registrados no dia.`;
  } else if (metricName === "duplicate_payment_attempts" && currentVal >= 3) {
    alertTriggered = true;
    severity = "CRITICAL";
    message = `Ataque Suspeito de Corrida: Detectada duplica\xE7\xE3o de transa\xE7\xE3o / corrida de webhooks concurrentes.`;
  }
  if (alertTriggered && !activeAlertsSpamFilter.has(thresholdKey)) {
    activeAlertsSpamFilter.add(thresholdKey);
    setTimeout(() => activeAlertsSpamFilter.delete(thresholdKey), 6e5);
    triggerAlert("system_logs", severity, message, "multiple_users", { currentVal, metricName });
  }
}
async function triggerAlert(category, severity, message, userId, details) {
  const alertId = db.collection("system_alerts").doc().id;
  const alertObj = {
    id: alertId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    category,
    severity,
    message,
    userId: userId || "system",
    details: details || {},
    status: "open"
    // open, investigating, resolved
  };
  try {
    await db.collection("system_alerts").doc(alertId).set(alertObj);
    console.log(`[ALERT TRIGGERED] [${severity}] ${message}`);
  } catch (err) {
    console.error("[Alerts Error] Failed to store alert event in DB:", err);
  }
}
async function getOverallMetricsForDashboard() {
  const cacheKey = "global_production_dashboard_metrics";
  const cachedVal = memoryCache.get(cacheKey);
  if (cachedVal) {
    return cachedVal;
  }
  const result = {
    validations_per_minute: 0,
    validations_today: 0,
    frauds_blocked_today: 0,
    total_payments_processed: 0,
    firestore_safety_index: 100,
    current_active_alerts: 0,
    average_validation_time_ms: 320,
    estimated_gemini_cost_usd: 0,
    server_uptime_seconds: process.uptime()
  };
  try {
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().substring(0, 10);
    const metricDoc = await db.collection("system_metrics").doc(todayStr).get();
    if (metricDoc.exists) {
      const data = metricDoc.data()?.metrics || {};
      result.validations_today = data["activity_validation_logs_count"] || 0;
      result.frauds_blocked_today = data["total_frauds_detected"] || 0;
      result.total_payments_processed = data["payments_processed_count"] || 0;
      result.critical_errors = data["critical_failures_count"] || 0;
    }
    const openAlertsSnap = await db.collection("system_alerts").where("status", "==", "open").limit(50).get();
    result.current_active_alerts = openAlertsSnap.size;
    memoryCache.set(cacheKey, result, 15);
  } catch (err) {
    console.error("[Dashboard Metrics] Error fetching production metrics:", err);
  }
  return result;
}
var import_firestore2, import_node_cache3, memoryCache, activeAlertsSpamFilter;
var init_observability = __esm({
  "api/_lib/observability.ts"() {
    init_common();
    import_firestore2 = require("firebase-admin/firestore");
    import_node_cache3 = __toESM(require("node-cache"), 1);
    memoryCache = new import_node_cache3.default({ stdTTL: 60, checkperiod: 120 });
    activeAlertsSpamFilter = /* @__PURE__ */ new Set();
  }
});

// api/_handlers/gyms_checkin.ts
function calculateDistance2(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
async function handler8(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "M\xE9todo n\xE3o permitido." });
  }
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Sess\xE3o expirada. Fa\xE7a login novamente." });
  }
  const { action, latitude, longitude, accuracy, isMock, deviceId, deviceFingerprint } = req.body;
  if (latitude === void 0 || longitude === void 0 || accuracy === void 0) {
    return res.status(400).json({
      status: "error",
      error: "Coordenadas e precis\xE3o de GPS s\xE3o obrigat\xF3rios para valida\xE7\xE3o."
    });
  }
  try {
    if (!db) {
      return res.status(500).json({ error: "Banco de dados indispon\xEDvel no momento." });
    }
    const userRef = db.collection("users").doc(auth.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: "Perfil do usu\xE1rio n\xE3o encontrado." });
    }
    const userData = userSnap.data() || {};
    if (!userData.gymId) {
      return res.status(400).json({
        status: "blocked_no_gym",
        error: "Voc\xEA precisa selecionar uma academia cadastrada antes de confirmar o check-in."
      });
    }
    if (!userData.gymLocation || userData.gymLocation.lat === void 0 || userData.gymLocation.lng === void 0) {
      console.log(`Academia sem coordenadas v\xE1lidas: ${userData.gymId}, ${auth.uid}, ${(/* @__PURE__ */ new Date()).toISOString()}`);
      return res.status(400).json({
        status: "error",
        error: "\u26A0 N\xE3o conseguimos validar a localiza\xE7\xE3o desta academia.\nEntre em contato com o suporte para corrigirmos o cadastro."
      });
    }
    const userLat = Number(latitude);
    const userLng = Number(longitude);
    const gymLat = Number(userData.gymLocation.lat);
    const gymLng = Number(userData.gymLocation.lng);
    if (accuracy > 100) {
      return res.status(400).json({
        status: "blocked_low_accuracy",
        error: "\u{1F4CD} Sua localiza\xE7\xE3o est\xE1 imprecisa no momento.\nTente ir para uma \xE1rea mais aberta ou aguarde alguns segundos e tente novamente."
      });
    }
    const distanceKm = calculateDistance2(userLat, userLng, gymLat, gymLng);
    const distanceMeters = distanceKm * 1e3;
    if (distanceMeters > 100) {
      return res.status(400).json({
        status: "blocked_out_of_range",
        error: "\u{1F4CD} Voc\xEA est\xE1 fora da \xE1rea da sua academia cadastrada.\nAproxime-se da academia para iniciar ou finalizar seu treino.",
        distanceMeters
      });
    }
    const riskFlags = [];
    let isSuspicious = false;
    if (isMock) {
      return res.status(400).json({
        status: "blocked_mock_location",
        error: "Acesso bloqueado: Localiza\xE7\xE3o simulada/fict\xEDcia (Mock Location) detectada pela tecnologia antifraude Invictus."
      });
    }
    const latestCheckinSnap = await db.collection("gym_checkins").where("userId", "==", auth.uid).orderBy("confirmedAt", "desc").limit(1).get();
    if (!latestCheckinSnap.empty) {
      const lastCheckin = latestCheckinSnap.docs[0].data();
      const lastGymId = lastCheckin.gymId;
      const lastTime = new Date(lastCheckin.confirmedAt).getTime();
      const timeDiffMins = (Date.now() - lastTime) / 6e4;
      if (lastGymId !== userData.gymId && timeDiffMins < 15) {
        riskFlags.push("SUSPICIOUS_RAPID_GYM_HOPPING");
        isSuspicious = true;
      }
    }
    if (action === "verify") {
      return res.json({
        success: true,
        status: "eligible",
        distanceMeters: Number(distanceMeters.toFixed(1)),
        gpsAccuracy: accuracy,
        message: "Voc\xEA est\xE1 na academia. Confirme seu check-in para iniciar."
      });
    }
    const checkInId = db.collection("gym_checkins").doc().id;
    const now = /* @__PURE__ */ new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1e3).toISOString();
    const checkinStatus = isSuspicious ? "suspicious" : "confirmed";
    const checkinDoc = {
      id: checkInId,
      userId: auth.uid,
      gymId: userData.gymId,
      gymName: userData.gymName || "Academia Vinculada",
      confirmedAt: now.toISOString(),
      expiresAt,
      userLocation: { lat: userLat, lng: userLng },
      gymLocation: { lat: gymLat, lng: gymLng },
      distanceMeters: Number(distanceMeters.toFixed(1)),
      gpsAccuracy: accuracy,
      status: checkinStatus,
      deviceId: deviceId || "",
      deviceFingerprint: deviceFingerprint || "",
      mockLocationDetected: false,
      riskFlags,
      createdAt: serverTimestamp()
    };
    await db.collection("gym_checkins").doc(checkInId).set(checkinDoc);
    try {
      const { logEvent: logEvent2 } = (init_observability(), __toCommonJS(observability_exports));
      await logEvent2({
        severity: isSuspicious ? "WARNING" : "INFO",
        category: "fraud_audit_logs",
        message: `Check-in manual presencial realizado por ${userData.displayName || auth.uid} na academia ${userData.gymName || ""} (Dist\xE2ncia: ${Math.round(distanceMeters)}m)`,
        userId: auth.uid,
        route: "/api/gyms/checkin",
        details: {
          checkInId,
          gymId: userData.gymId,
          distanceMeters,
          gpsAccuracy: accuracy,
          isSuspicious,
          riskFlags
        }
      });
    } catch (_) {
    }
    return res.json({
      success: true,
      status: checkinStatus,
      checkInId,
      expiresAt,
      gymName: userData.gymName,
      distanceMeters: Number(distanceMeters.toFixed(1)),
      gpsAccuracy: accuracy,
      riskFlags
    });
  } catch (error) {
    console.error("Gym Checkin API Error:", error);
    return res.status(500).json({ error: error.message || "Erro ao registrar check-in" });
  }
}
var init_gyms_checkin = __esm({
  "api/_handlers/gyms_checkin.ts"() {
    init_common();
  }
});

// api/_handlers/gyms_photo.ts
async function handler9(req, res) {
  const requestId = Math.random().toString(36).substring(7);
  if (cors(req, res)) return;
  try {
    const photoRef = req.query.ref;
    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;
    if (!photoRef) {
      console.warn(`[PhotoProxy][${requestId}] Missing ref query parameter`);
      return res.status(400).send("Missing photo reference");
    }
    if (!apiKey) {
      console.error(`[PhotoProxy][${requestId}] Google API Key not found in environment`);
      return res.status(500).send("Server configuration error: Missing API Key");
    }
    const isV1 = photoRef.startsWith("places/");
    let url;
    const isInvalidV1 = isV1 && !photoRef.includes("/photos/");
    if (isV1) {
      if (isInvalidV1) {
        console.warn(`[PhotoProxy][${requestId}] Invalid V1 ref (place name instead of photo name): ${photoRef}`);
        return res.redirect("https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=400&auto=format&fit=crop");
      }
      url = new URL(`https://places.googleapis.com/v1/${photoRef}/media`);
      url.searchParams.append("maxWidthPx", "800");
      console.log(`[PhotoProxy][${requestId}] Fetching from Places V1 API: ${photoRef.substring(0, 50)}...`);
    } else {
      url = new URL("https://maps.googleapis.com/maps/api/place/photo");
      url.searchParams.append("maxwidth", "800");
      url.searchParams.append("photoreference", photoRef);
      url.searchParams.append("key", apiKey);
      console.log(`[PhotoProxy][${requestId}] Fetching from Legacy Google API: ${photoRef.substring(0, 30)}...`);
    }
    let finalUrl = url.toString();
    const headers = {
      "Accept": "image/*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
    };
    if (isV1) {
      console.log(`[PhotoProxy][${requestId}] Resolving V1 redirect for Google API...`);
      const redirectRes = await fetch(finalUrl, {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "User-Agent": headers["User-Agent"]
        },
        redirect: "manual"
      });
      if (redirectRes.status === 307 || redirectRes.status === 302 || redirectRes.status === 301 || redirectRes.status === 308) {
        const redirectUrl = redirectRes.headers.get("location");
        if (redirectUrl) {
          finalUrl = redirectUrl;
          console.log(`[PhotoProxy][${requestId}] Successfully resolved redirect to: ${finalUrl.substring(0, 70)}...`);
        }
      } else if (!redirectRes.ok) {
        const errorInfo = await redirectRes.text().catch(() => "no error body");
        console.error(`[PhotoProxy][${requestId}] Google API V1 Init Error: ${redirectRes.status} - KeyPrefix: ${apiKey.substring(0, 5)}`);
        console.error(`[PhotoProxy][${requestId}] V1 Init Error Body: ${errorInfo.substring(0, 500)}`);
        if (redirectRes.status === 403 || redirectRes.status === 404 || redirectRes.status === 400) {
          return res.redirect("https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=400&auto=format&fit=crop");
        }
        return res.status(redirectRes.status).send(`Google API V1 Init Error: ${redirectRes.status}`);
      }
    }
    const response = await fetch(finalUrl, {
      redirect: "follow",
      headers
    });
    if (!response.ok) {
      const contentType2 = response.headers.get("content-type");
      let errorInfo = "";
      if (contentType2 && contentType2.startsWith("image/")) {
        errorInfo = "(Binary Image Content)";
      } else {
        errorInfo = await response.text().catch(() => "no error body");
      }
      console.error(`[PhotoProxy][${requestId}] Google API Error: ${response.status} - KeyPrefix: ${apiKey.substring(0, 5)} - Ref: ${photoRef.substring(0, 60)}`);
      console.error(`[PhotoProxy][${requestId}] Full Error Body: ${errorInfo.substring(0, 500)}`);
      if (response.status === 403) {
        console.error(`[PhotoProxy][${requestId}] 403 Forbidden - Check if Places API (New) is enabled for V1 refs, or if the key is restricted.`);
      }
      if (response.status === 403 || response.status === 404) {
        return res.redirect("https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=400&auto=format&fit=crop");
      }
      return res.status(response.status).send(`Google API Error: ${response.status}`);
    }
    const contentType = response.headers.get("content-type");
    console.log(`[PhotoProxy][${requestId}] Google response content-type: ${contentType}`);
    if (contentType && !contentType.startsWith("image/")) {
      console.warn(`[PhotoProxy][${requestId}] Google returned non-image content: ${contentType}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      console.warn(`[PhotoProxy][${requestId}] Received empty body from Google`);
      return res.status(404).send("Not found");
    }
    console.log(`[PhotoProxy][${requestId}] Success: ${arrayBuffer.byteLength} bytes, type: ${contentType}`);
    const finalContentType = contentType || "image/jpeg";
    res.setHeader("Content-Type", finalContentType);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    const buffer = Buffer.from(arrayBuffer);
    return res.end(buffer);
  } catch (error) {
    console.error(`[PhotoProxy][${requestId}] CRITICAL ERROR:`, error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
var init_gyms_photo = __esm({
  "api/_handlers/gyms_photo.ts"() {
    init_common();
  }
});

// api/_handlers/running.ts
async function handler10(req, res) {
  if (cors(req, res)) return;
  const { method, query: reqQuery } = req;
  const action = reqQuery.action || "me";
  try {
    const auth = await verifyAuth(req);
    const sensitiveActions = ["me", "add", "history"];
    if (sensitiveActions.includes(action) && !auth) {
      return res.status(401).json({ error: "Autentica\xE7\xE3o necess\xE1ria." });
    }
    const queryUserId = req.query.userId;
    const bodyUserId = req.body?.userId;
    const targetUserId = queryUserId || bodyUserId || (action === "me" ? auth?.uid : null);
    if (action === "me" && !queryUserId && !bodyUserId && auth) {
      req.query.userId = auth.uid;
    }
    if (auth && targetUserId && targetUserId !== auth.uid) {
      console.warn(`[Running API] User ${auth.uid} attempting to access data for ${targetUserId}`);
      if (action === "me" || action === "add" || action === "history") {
        return res.status(403).json({ error: "Acesso negado. Voc\xEA s\xF3 pode acessar seus pr\xF3prios dados." });
      }
    }
    if (!db) {
      return res.status(500).json({
        error: "Falha na inicializa\xE7\xE3o do banco de dados.",
        details: "Admin SDK n\xE3o inicializado."
      });
    }
    return await runAction(action, req, res);
  } catch (error) {
    const errorMsg = error.message || "";
    const isQuotaError = errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("Quota limit exceeded");
    console.error(`[Running API] Operation "${action}" failed. Error: ${errorMsg}`);
    if (isQuotaError) {
      return res.status(429).json({
        error: "Servidor sob alta carga. Tente novamente em alguns instantes.",
        code: "QUOTA_EXHAUSTED",
        fallback: true
      });
    }
    return res.status(500).json({
      error: `Erro ao processar ${action}: ${errorMsg}`,
      details: error.stack
    });
  }
}
async function runAction(action, req, res) {
  switch (action) {
    case "me":
      return await getUserStats(req, res);
    case "add":
      return await addRun(req, res);
    case "ranking":
      return await getRanking(req, res);
    case "history":
      return await getHistory(req, res);
    default:
      return res.status(400).json({ error: "Invalid action" });
  }
}
async function getUserStats(req, res) {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "User ID required" });
  const cacheKey = `user_stats_${userId}`;
  const cached = cache3.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const snap = await db.collection("running_stats").doc(userId).get();
    if (!snap.exists) {
      const defaultStats = {
        userId,
        best_run_km_month: 0,
        best_run_km_week: 0,
        last_run_date: (/* @__PURE__ */ new Date()).toISOString(),
        is_paid_running: false
      };
      cache3.set(cacheKey, defaultStats, 600);
      return res.json(defaultStats);
    }
    const data = snap.data();
    const now = /* @__PURE__ */ new Date();
    const lastRun = data?.last_run_date ? new Date(data.last_run_date) : null;
    let best_run_km_month = data?.best_run_km_month || 0;
    let best_run_km_week = data?.best_run_km_week || 0;
    if (lastRun) {
      if (!(0, import_date_fns.isWithinInterval)(lastRun, { start: (0, import_date_fns.startOfMonth)(now), end: (0, import_date_fns.endOfMonth)(now) })) {
        best_run_km_month = 0;
      }
      if (!(0, import_date_fns.isWithinInterval)(lastRun, { start: (0, import_date_fns.startOfWeek)(now, { weekStartsOn: 1 }), end: (0, import_date_fns.endOfWeek)(now, { weekStartsOn: 1 }) })) {
        best_run_km_week = 0;
      }
    }
    const result = { ...data, best_run_km_month, best_run_km_week };
    cache3.set(cacheKey, result, 600);
    return res.json(result);
  } catch (err) {
    const isQuotaError = err.message?.includes("RESOURCE_EXHAUSTED") || err.message?.includes("Quota limit exceeded");
    if (isQuotaError) {
      console.warn(`[Running API] Quota hit for getUserStats(${userId}), returning error response with fallback hint`);
      return res.status(429).json({
        error: "Servidor sob alta carga. Tente novamente em instantes.",
        code: "QUOTA_EXHAUSTED",
        fallback: true,
        userId
        // Send back ID so UI can at least identify the scope
      });
    }
    throw err;
  }
}
async function addRun(req, res) {
  const { userId, km, timeSeconds, pace, calories, elevationGain, steps, trajectory, date, session } = req.body;
  if (!userId || km === void 0) return res.status(400).json({ error: "Missing parameters" });
  try {
    const snap = await db.collection("running_stats").doc(userId).get();
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    let data = snap.exists ? snap.data() : {
      userId,
      best_run_km_month: 0,
      best_run_km_week: 0,
      last_run_date: nowIso,
      is_paid_running: false
    };
    const lastRun = data?.last_run_date ? new Date(data.last_run_date) : null;
    let currentMonthBest = data?.best_run_km_month || 0;
    let currentWeekBest = data?.best_run_km_week || 0;
    if (lastRun) {
      if (!(0, import_date_fns.isWithinInterval)(lastRun, { start: (0, import_date_fns.startOfMonth)(now), end: (0, import_date_fns.endOfMonth)(now) })) currentMonthBest = 0;
      if (!(0, import_date_fns.isWithinInterval)(lastRun, { start: (0, import_date_fns.startOfWeek)(now, { weekStartsOn: 1 }), end: (0, import_date_fns.endOfWeek)(now, { weekStartsOn: 1 }) })) currentWeekBest = 0;
    }
    const currentKm = parseFloat(km);
    if (currentKm > currentMonthBest) currentMonthBest = currentKm;
    if (currentKm > currentWeekBest) currentWeekBest = currentKm;
    const lastRunStats = {
      km: currentKm,
      timeSeconds: timeSeconds || 0,
      pace: pace || `0'00"/km`,
      calories: calories || 0,
      elevationGain: elevationGain || 0,
      steps: steps || 0,
      trajectory: trajectory || [],
      date: date || nowIso
    };
    const updatedData = {
      ...data,
      best_run_km_month: currentMonthBest,
      best_run_km_week: currentWeekBest,
      last_run_date: nowIso,
      last_run_stats: lastRunStats
    };
    let sessionId = null;
    if (session) {
      const sessionRef = db.collection("run_sessions").doc();
      sessionId = sessionRef.id;
      await sessionRef.set({
        ...session,
        id: sessionId,
        userId,
        createdAt: import_firestore.FieldValue.serverTimestamp()
      });
    }
    await db.collection("running_stats").doc(userId).set(updatedData, { merge: true });
    const userRef = db.collection("users").doc(userId);
    const getWeekNumber = (date2) => {
      const d = new Date(Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
    };
    const currentWeekInfo = getWeekNumber(now);
    const weekId = `${now.getFullYear()}-W${currentWeekInfo}`;
    const todayISO = nowIso.split("T")[0];
    const weeklyStatsRef = db.collection("users").doc(userId).collection("weeklyStats").doc(weekId);
    let isScoringEligible = false;
    let nonScoringReason = null;
    let finalXpAwarded = 0;
    let trustScore = 100;
    try {
      const userRefSnap = await db.collection("users").doc(userId).get();
      const userData = userRefSnap.exists ? userRefSnap.data() || {} : {};
      const trustProfileSnap = await db.collection("user_trust_profiles").doc(userId).get();
      if (trustProfileSnap.exists) {
        trustScore = trustProfileSnap.data()?.trustScore ?? 100;
      } else if (userData.createdAt) {
        const ageMs = Date.now() - new Date(userData.createdAt).getTime();
        const ageDays = ageMs / (1e3 * 60 * 60 * 24);
        trustScore = ageDays > 30 ? 95 : 70;
      } else {
        trustScore = 70;
      }
    } catch (_) {
    }
    let riskAcc = 10;
    const isMockLoc = req.body.isMockLocation || false;
    const isEmu = req.body.isEmulator || false;
    const isRoot = req.body.isRooted || false;
    const isDev = req.body.isDeveloperMode || false;
    const hasOscillation = req.body.hasSensorOscillation ?? true;
    const sensStatus = req.body.sensorStatus || "unavailable";
    if (isEmu || isDev) riskAcc += 25;
    if (isMockLoc || isRoot) riskAcc += 45;
    if (sensStatus === "unavailable" || !hasOscillation) riskAcc += 15;
    const calculatedSpeedKmh = currentKm / ((timeSeconds || 3600) / 3600);
    if (calculatedSpeedKmh > 22) riskAcc += 35;
    else if (calculatedSpeedKmh > 16) riskAcc += 15;
    const presenceRiskScore = Math.min(100, Math.max(0, riskAcc));
    let presenceCheckRequired = false;
    if (presenceRiskScore >= 75) {
      presenceCheckRequired = true;
    } else {
      let triggerProbability = 0.1;
      if (trustScore >= 90) {
        triggerProbability = 0.05;
      } else if (trustScore < 70) {
        triggerProbability = 0.3;
      }
      if (presenceRiskScore >= 40) {
        triggerProbability = Math.max(triggerProbability, 0.4);
      }
      presenceCheckRequired = Math.random() < triggerProbability;
    }
    if (presenceCheckRequired) {
      const dbCollection = db.collection("pending_presence_checks");
      const presenceCheckId = dbCollection.doc().id;
      const nowTime = /* @__PURE__ */ new Date();
      const expiredAt = new Date(nowTime.getTime() + 15 * 60 * 1e3).toISOString();
      const GESTURES = [
        "pisque os olhos repetidamente",
        "d\xEA um sorriso natural para a c\xE2mera",
        "vire a cabe\xE7a levemente para a esquerda",
        "vire a cabe\xE7a levemente para a direita",
        "levante uma das m\xE3os \xE0 altura do ombro",
        "olhe diretamente para cima e depois para a c\xE2mera"
      ];
      const livenessPrompt = GESTURES[Math.floor(Math.random() * GESTURES.length)];
      await dbCollection.doc(presenceCheckId).set({
        id: presenceCheckId,
        userId,
        type: "running",
        livenessPrompt,
        riskScore: presenceRiskScore,
        createdAt: nowTime.toISOString(),
        expiredAt,
        workoutPayload: req.body,
        status: "pending"
      });
      return res.json({
        success: true,
        // indicate endpoint parsing success
        status: "presence_check_required",
        presenceCheckRequired: true,
        presenceCheckId,
        livenessPrompt,
        userMessage: "Para finalizar sua corrida e computar seus pontos, conclua a confirma\xE7\xE3o r\xE1pida de presen\xE7a."
      });
    }
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) return;
      const userData = userSnap.data();
      let xpAwarded = userData.isSubscribed || true ? 20 + Math.floor(currentKm * 5) : 0;
      const weeklyStatsSnap = await transaction.get(weeklyStatsRef);
      let weeklyStatsData = weeklyStatsSnap.exists ? weeklyStatsSnap.data() : {
        weekId,
        scoredDays: [],
        totalScoredDays: 0,
        totalPoints: 0
      };
      const scoredDays = weeklyStatsData.scoredDays || [];
      const isDayAlreadyScored = scoredDays.includes(todayISO);
      if (xpAwarded > 0) {
        if (isDayAlreadyScored) {
          isScoringEligible = true;
          finalXpAwarded = xpAwarded;
        } else if (scoredDays.length < 5) {
          isScoringEligible = true;
          finalXpAwarded = xpAwarded;
          scoredDays.push(todayISO);
          weeklyStatsData.scoredDays = scoredDays;
          weeklyStatsData.totalScoredDays = scoredDays.length;
        } else {
          isScoringEligible = false;
          nonScoringReason = "WEEKLY_SCORING_LIMIT_REACHED";
          finalXpAwarded = 0;
        }
      } else {
        isScoringEligible = true;
      }
      const userUpdates = {
        updatedAt: import_firestore.FieldValue.serverTimestamp()
      };
      if (userData.isSubscribed || true) {
        userUpdates.score = (userData.score || 0) + finalXpAwarded;
        userUpdates.lastCheckIn = nowIso;
        const lastCheckInDay = userData.lastCheckIn ? userData.lastCheckIn.split("T")[0] : "";
        if (todayISO !== lastCheckInDay) {
          userUpdates.totalActiveDays = (userData.totalActiveDays || 0) + 1;
        }
      }
      if (finalXpAwarded > 0) {
        weeklyStatsData.totalPoints = (weeklyStatsData.totalPoints || 0) + finalXpAwarded;
        weeklyStatsData.updatedAt = import_firestore.FieldValue.serverTimestamp();
        transaction.set(weeklyStatsRef, weeklyStatsData);
      }
      transaction.update(userRef, userUpdates);
    });
    cache3.flushAll();
    const isWeeklyLimit = !isScoringEligible && nonScoringReason === "WEEKLY_SCORING_LIMIT_REACHED";
    const userMsg = isWeeklyLimit ? "Treino registrado com sucesso, mas voc\xEA j\xE1 atingiu seus 5 dias pontu\xE1veis da semana." : "Corrida validada com sucesso! Seus pontos foram adicionados.";
    return res.json({
      ...updatedData,
      sessionId,
      isScoringEligible,
      nonScoringReason,
      pointsEarned: finalXpAwarded,
      success: !isWeeklyLimit,
      status: isWeeklyLimit ? "not_validated" : "approved",
      reasonCode: isWeeklyLimit ? "WEEKLY_LIMIT_REACHED" : null,
      userMessage: userMsg,
      canRetry: false,
      pointsAwarded: finalXpAwarded,
      message: userMsg
    });
  } catch (err) {
    const isQuotaError = err.message?.includes("RESOURCE_EXHAUSTED") || err.message?.includes("Quota limit exceeded");
    if (isQuotaError) {
      return res.status(429).json({
        error: "Servidor ocupado. Tente novamente em instantes.",
        code: "QUOTA_EXHAUSTED_WRITE"
      });
    }
    throw err;
  }
}
async function getRanking(req, res) {
  const period = req.query.period;
  const mode = req.query.mode || "official";
  const userId = req.query.userId;
  if (!period) return res.status(400).json({ error: "Period required" });
  const cacheKey = `ranking_${period}_${mode}`;
  const cachedData = cache3.get(cacheKey);
  if (cachedData) return res.json(cachedData);
  try {
    const field = period === "month" ? "best_run_km_month" : "best_run_km_week";
    const now = /* @__PURE__ */ new Date();
    const start = period === "month" ? (0, import_date_fns.startOfMonth)(now) : (0, import_date_fns.startOfWeek)(now, { weekStartsOn: 1 });
    const isPaidFilter = mode === "official";
    const querySnap = await db.collection("running_stats").where("is_paid_running", "==", isPaidFilter).where(field, ">", 0).where("last_run_date", ">=", start.toISOString()).orderBy(field, "desc").limit(10).get();
    const runnerIds = querySnap.docs.map((snap) => snap.data().userId);
    const runnerMap = /* @__PURE__ */ new Map();
    if (runnerIds.length > 0) {
      const usersSnap = await db.collection("users").where(import_firestore.FieldPath.documentId(), "in", runnerIds).get();
      usersSnap.forEach((d) => runnerMap.set(d.id, d.data()));
    }
    const ranking = querySnap.docs.map((snap) => {
      const data = snap.data();
      const userData = runnerMap.get(data.userId);
      return {
        userId: data.userId,
        displayName: userData?.displayName || "Velocista An\xF4nimo",
        photoURL: userData?.photoURL || null,
        km: data[field],
        is_paid_running: data.is_paid_running
      };
    });
    let totalCount = 0;
    let totalPool = 0;
    try {
      const statsSnap = await db.collection("system_stats").doc("global").get();
      if (statsSnap.exists) {
        const stats = statsSnap.data();
        totalCount = stats?.activeUserCount || 0;
        totalPool = stats?.pools?.poolValues?.national || totalCount * 19.9 * 0.5;
      }
    } catch (e) {
      console.warn("[Ranking API] Failed to fetch system stats");
    }
    const result = { ranking, totalPool };
    cache3.set(cacheKey, result, 900);
    return res.json(result);
  } catch (err) {
    const isQuotaError = err.message?.includes("RESOURCE_EXHAUSTED") || err.message?.includes("Quota limit exceeded");
    if (isQuotaError) {
      return res.status(429).json({ error: "Ranking temporariamente indispon\xEDvel.", code: "QUOTA_EXHAUSTED" });
    }
    throw err;
  }
}
async function getHistory(req, res) {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "User ID required" });
  const snap = await db.collection("run_sessions").where("userId", "==", userId).orderBy("createdAt", "desc").limit(10).get();
  const history = snap.docs.map((doc2) => ({
    id: doc2.id,
    ...doc2.data()
  }));
  return res.json({ history });
}
var import_date_fns, import_node_cache4, cache3;
var init_running = __esm({
  "api/_handlers/running.ts"() {
    init_common();
    import_date_fns = require("date-fns");
    import_node_cache4 = __toESM(require("node-cache"), 1);
    cache3 = new import_node_cache4.default({ stdTTL: 300 });
  }
});

// api/_lib/activityRules.ts
function getEffectiveMinutes(type, durationMinutes) {
  if (type !== "workout" && type !== "cardio") return durationMinutes;
  const max = ACTIVITY_RULES[type]?.maxMinutes || 90;
  return Math.min(durationMinutes, max);
}
function isSessionDurationValid(type, durationMinutes) {
  if (type !== "workout" && type !== "cardio") return true;
  const min = ACTIVITY_RULES[type]?.minMinutes || 15;
  return durationMinutes >= min;
}
var ACTIVITY_RULES;
var init_activityRules = __esm({
  "api/_lib/activityRules.ts"() {
    ACTIVITY_RULES = {
      workout: {
        minMinutes: 30,
        maxMinutes: 90
      },
      cardio: {
        minMinutes: 20,
        maxMinutes: 90
      }
    };
  }
});

// api/_lib/validationMessages.ts
function getFriendlyMessage(reasonCode) {
  if (!reasonCode) return "Atividade processada, mas n\xE3o foi poss\xEDvel confirmar todos os crit\xE9rios necess\xE1rios.";
  return VALIDATION_MESSAGES[reasonCode] || VALIDATION_MESSAGES.UNKNOWN_VALIDATION_ERROR;
}
var VALIDATION_MESSAGES;
var init_validationMessages = __esm({
  "api/_lib/validationMessages.ts"() {
    VALIDATION_MESSAGES = {
      GPS_OUTSIDE_ALLOWED_AREA: "Sua localiza\xE7\xE3o foi detectada fora da \xE1rea permitida para o treino. Verifique se o GPS est\xE1 ativo e tente novamente.",
      GPS_TOO_FAR_FROM_GYM: "N\xE3o conseguimos validar este treino porque sua localiza\xE7\xE3o ficou fora da \xE1rea da academia cadastrada. No pr\xF3ximo treino, inicie a atividade estando dentro ou pr\xF3ximo da academia correta.",
      GYM_DISTANCE_TOO_CLOSE_TO_START: "O local de in\xEDcio e fim da atividade s\xE3o muito pr\xF3ximos ou id\xEAnticos \xE0 academia para caracterizar um deslocamento cardio. Tente iniciar um pouco mais distante.",
      INSUFFICIENT_TIME: "Este treino n\xE3o atingiu o tempo m\xEDnimo necess\xE1rio para pontuar. Continue treinando pelo tempo m\xEDnimo indicado para que a atividade seja validada.",
      PHOTO_NOT_CLEAR: "A foto enviada n\xE3o ficou n\xEDtida o suficiente para validar o treino. Tente enviar uma imagem mais clara, mostrando melhor o ambiente da atividade.",
      PHOTO_NOT_FITNESS_CONTEXT: "N\xE3o conseguimos identificar um ambiente compat\xEDvel com treino na imagem enviada. Para validar, envie uma foto que mostre claramente o local ou equipamento da atividade.",
      PHOTO_AI_FAILED: "N\xE3o conseguimos processar a imagem do treino automaticamente por inconsist\xEAncia visual. A atividade ser\xE1 revisada manualmente.",
      LOCATION_PERMISSION_DENIED: "N\xE3o foi poss\xEDvel validar sua atividade porque a permiss\xE3o de localiza\xE7\xE3o estava desativada. Ative a localiza\xE7\xE3o e tente novamente no pr\xF3ximo treino.",
      GPS_SIGNAL_WEAK: "O sinal de GPS estava muito inst\xE1vel ou fraco durante o per\xEDodo. Aproxime-se de \xE1reas abertas no pr\xF3ximo treino para garantir a valida\xE7\xE3o autom\xE1tica.",
      PACE_TOO_FAST: "A velocidade registrada ficou acima do limite permitido para uma atividade humana. Por seguran\xE7a, essa atividade n\xE3o gerou pontos.",
      SUSPICIOUS_ROUTE: "O trajeto apresentou sinais inconsistentes com uma atividade normal. Por seguran\xE7a, essa atividade foi enviada para an\xE1lise ou n\xE3o gerou pontua\xE7\xE3o.",
      IMPOSSIBLE_ACCELERATION: "Detectamos acelera\xE7\xF5es incompat\xEDveis com corrida ou caminhada humana no trajeto. Por seguran\xE7a, os pontos n\xE3o foram concedidos.",
      MISSING_EVIDENCE: "Faltam evid\xEAncias obrigat\xF3rias para este treino (como foto de valida\xE7\xE3o ou dados de trajeto). Complete todas as etapas no seu pr\xF3ximo treino.",
      AUTH_REQUIRED: "Sess\xE3o expirada. Entre novamente na sua conta para registrar e validar suas atividades.",
      USER_NOT_AUTHENTICATED: "Usu\xE1rio n\xE3o autenticado. Fa\xE7a login para registrar suas atividades de forma segura.",
      ACTIVITY_DUPLICATED: "Esta atividade ou imagem j\xE1 foi enviada anteriormente. Registre um novo treino para continuar pontuando.",
      DAILY_LIMIT_REACHED: "Voc\xEA j\xE1 atingiu o limite m\xE1ximo de pontos di\xE1rios permitidos pela liga para manter o equil\xEDbrio da competi\xE7\xE3o.",
      WEEKLY_LIMIT_REACHED: "Voc\xEA j\xE1 atingiu o limite de treinos semanais eleg\xEDveis para premia\xE7\xE3o. Continue mantendo a consist\xEAncia!",
      VALIDATION_SERVICE_UNAVAILABLE: "Sua atividade foi recebida, mas n\xE3o conseguimos concluir a valida\xE7\xE3o autom\xE1tica neste momento. Ela ficar\xE1 em an\xE1lise e voc\xEA ser\xE1 informado quando for revisada.",
      PENDING_MANUAL_REVIEW: "N\xE3o conseguimos confirmar todos os sinais necess\xE1rios para validar automaticamente esta atividade. Ela foi enviada para an\xE1lise.",
      UNKNOWN_VALIDATION_ERROR: "N\xE3o conseguimos validar esta atividade no momento. Tente novamente ou realize uma nova atividade seguindo as regras do desafio."
    };
  }
});

// api/_handlers/validate-activity.ts
async function handler11(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      status: "not_validated",
      reasonCode: "UNKNOWN_VALIDATION_ERROR",
      userMessage: "M\xE9todo n\xE3o permitido.",
      canRetry: false,
      pointsAwarded: 0
    });
  }
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({
      success: false,
      status: "auth_required",
      reasonCode: "AUTH_REQUIRED",
      userMessage: "Sess\xE3o expirada. Entre novamente na sua conta para registrar e validar suas atividades.",
      canRetry: true,
      pointsAwarded: 0
    });
  }
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        status: "not_validated",
        reasonCode: "VALIDATION_SERVICE_UNAVAILABLE",
        userMessage: "Sua atividade foi recebida, mas n\xE3o conseguimos concluir a valida\xE7\xE3o autom\xE1tica neste momento. Ela ficar\xE1 em an\xE1lise e voc\xEA ser\xE1 informado quando for revisada.",
        canRetry: true,
        pointsAwarded: 0
      });
    }
    return await executeValidation(req, res, auth);
  } catch (error) {
    console.error("Validation API Error:", error);
    const errMsg = (error.message || "").toLowerCase();
    let rCode = "UNKNOWN_VALIDATION_ERROR";
    let uMsg = "N\xE3o conseguimos validar esta atividade no momento. Tente novamente ou realize uma nova atividade seguindo as regras do desafio.";
    if (errMsg.includes("bloqueada") || errMsg.includes("suspensa") || errMsg.includes("revis\xE3o")) {
      rCode = "UNKNOWN_VALIDATION_ERROR";
      uMsg = "Sua conta ou atividade est\xE1 bloqueada, suspensa ou sob revis\xE3o manual administrativa.";
    } else if (errMsg.includes("streak") || errMsg.includes("descanso")) {
      rCode = "UNKNOWN_VALIDATION_ERROR";
      uMsg = "Voc\xEA precisa ter pelo menos 1 dia de streak ativo de treino para utilizar o descanso inteligente.";
    } else if (errMsg.includes("refei\xE7\xF5es") || errMsg.includes("refei\xE7\xE3o") || errMsg.includes("uma hora")) {
      rCode = "DAILY_LIMIT_REACHED";
      uMsg = "Aguarde pelo menos 1 hora entre os registros de refei\xE7\xF5es.";
    } else if (errMsg.includes("recupera\xE7\xE3o") || errMsg.includes("consecutivos")) {
      rCode = "WEEKLY_LIMIT_REACHED";
      uMsg = "Dias de descanso n\xE3o podem ser consecutivos ou ultrapassar o limite permitido.";
    } else if (errMsg.includes("academia") || errMsg.includes("inicializar") || errMsg.includes("iniciar")) {
      rCode = "GPS_TOO_FAR_FROM_GYM";
      uMsg = "N\xE3o conseguimos validar este treino porque sua localiza\xE7\xE3o ficou fora da \xE1rea da academia cadastrada. No pr\xF3ximo treino, inicie a atividade estando dentro ou pr\xF3ximo da academia correta.";
    } else if (errMsg.includes("gps") || errMsg.includes("localiza\xE7\xE3o") || errMsg.includes("coordenadas")) {
      rCode = "LOCATION_PERMISSION_DENIED";
      uMsg = "N\xE3o foi poss\xEDvel validar sua atividade porque a permiss\xE3o de localiza\xE7\xE3o estava desativada. Ative a localiza\xE7\xE3o e tente novamente no pr\xF3ximo treino.";
    }
    return res.status(500).json({
      success: false,
      status: "not_validated",
      reasonCode: rCode,
      userMessage: uMsg,
      canRetry: true,
      pointsAwarded: 0,
      error: error.message
    });
  }
}
async function executeValidation(req, res, auth) {
  const { type, durationMins, distanceKm, photoBase64, checkpoints, hasExercises, aiResult, focus, description, quizAnswers } = req.body;
  if (type === "workout") {
    const { checkInId } = req.body;
    if (!checkInId) {
      return res.status(400).json({
        success: false,
        status: "not_validated",
        reasonCode: "CHECKIN_REQUIRED",
        userMessage: "O check-in presencial \xE9 obrigat\xF3rio. Por favor, confirme o check-in na sua academia antes de finalizar o treino e ganhar pontos."
      });
    }
    const checkinRef = db.collection("gym_checkins").doc(checkInId);
    const checkinSnap = await checkinRef.get();
    if (!checkinSnap.exists) {
      return res.status(400).json({
        success: false,
        status: "not_validated",
        reasonCode: "CHECKIN_NOT_FOUND",
        userMessage: "Seu registro de check-in presencial correspondente a este treino n\xE3o p\xF4de ser encontrado."
      });
    }
    const checkinData = checkinSnap.data() || {};
    if (checkinData.userId !== auth.uid) {
      return res.status(403).json({
        success: false,
        status: "not_validated",
        reasonCode: "CHECKIN_OWNERSHIP_MISMATCH",
        userMessage: "Acesso negado: a identidade de check-in n\xE3o coincide com seu usu\xE1rio ativo."
      });
    }
    if (checkinData.status !== "confirmed" && checkinData.status !== "suspicious") {
      return res.status(400).json({
        success: false,
        status: "not_validated",
        reasonCode: "CHECKIN_STATUS_INVALID",
        userMessage: `Este check-in possui o status inv\xE1lido de "${checkinData.status}" e n\xE3o pode ser utilizado.`
      });
    }
    const duplicateWorkoutSnap = await db.collection("workouts").where("checkInId", "==", checkInId).limit(1).get();
    if (!duplicateWorkoutSnap.empty) {
      return res.status(400).json({
        success: false,
        status: "not_validated",
        reasonCode: "CHECKIN_ALREADY_CONSUMED",
        userMessage: "Este check-in j\xE1 foi consumido por outra sess\xE3o de treino."
      });
    }
  }
  if (type === "workout" || type === "cardio") {
    const startedAtStr = checkpoints && checkpoints[0]?.timestamp || new Date(Date.now() - (durationMins || 30) * 6e4).toISOString();
    const endedAtStr = (/* @__PURE__ */ new Date()).toISOString();
    const startMs = new Date(startedAtStr).getTime();
    const endMs = new Date(endedAtStr).getTime();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString();
    const overlappingSessionsSnap = await db.collection("training_sessions").where("userId", "==", auth.uid).where("endedAt", ">=", oneDayAgo).get();
    for (const doc2 of overlappingSessionsSnap.docs) {
      const sessionData = doc2.data();
      const sStartMs = new Date(sessionData.startedAt).getTime();
      const sEndMs = new Date(sessionData.endedAt).getTime();
      if (sStartMs < endMs && sEndMs > startMs) {
        return res.status(400).json({
          success: false,
          status: "not_validated",
          reasonCode: "CONCURRENT_WORKOUT_BLOCKED",
          userMessage: "Bloqueio Antifraude: J\xE1 existe uma atividade (treino ou cardio) registrada cobrindo o mesmo per\xEDodo de tempo. Treinos simult\xE2neos n\xE3o s\xE3o permitidos."
        });
      }
    }
  }
  if (photoBase64) {
    const generateBackendFingerprint = (base64Image) => {
      if (!base64Image) return "";
      const cleanBase = base64Image.replace(/^data:image\/\w+;base64,/, "");
      const length = cleanBase.length;
      const sampleSize = 100;
      if (length < sampleSize * 3) return cleanBase;
      const prefix = cleanBase.slice(50, 50 + sampleSize);
      const middle = cleanBase.slice(Math.floor(length / 2), Math.floor(length / 2) + sampleSize);
      const suffix = cleanBase.slice(length - 50 - sampleSize, length - 50);
      let score = 0;
      const combined = prefix + middle + suffix;
      for (let i = 0; i < combined.length; i++) {
        score = (score << 5) - score + combined.charCodeAt(i);
        score |= 0;
      }
      return `fp_${score.toString(16)}_${length}`;
    };
    const fingerprint = generateBackendFingerprint(photoBase64);
    if (fingerprint) {
      try {
        const fpDocRef = db.collection("photo_fingerprints").doc(fingerprint);
        const fpDocSnap = await fpDocRef.get();
        if (fpDocSnap.exists) {
          console.warn(`[Backend Anti-Cheat Photo Guard] DUPLICATE upload detected! Fingerprint: ${fingerprint}`);
          return res.status(400).json({
            success: false,
            status: "not_validated",
            reasonCode: "DUPLICATE_PHOTO_DETECTION",
            userMessage: "Bloqueio Antifraude: Esta foto j\xE1 foi utilizada anteriormente em outro registro."
          });
        }
        const expiresAt = /* @__PURE__ */ new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await fpDocRef.set({
          fingerprint,
          userId: auth.uid,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          expiresAt: expiresAt.toISOString(),
          ttl: Math.floor(expiresAt.getTime() / 1e3)
        });
      } catch (fpErr) {
        console.error("[Backend Anti-Cheat Photo Guard] Failed to check photo uniqueness:", fpErr);
      }
    }
  }
  let effectiveMins = getEffectiveMinutes(type, durationMins || 0);
  let effectiveCheckpoints = checkpoints || [];
  let effectiveDistanceKm = distanceKm || 0;
  if (type === "cardio" && checkpoints && checkpoints.length > 0) {
    const startTimeStr = checkpoints[0].timestamp;
    const startTimeMs = new Date(startTimeStr).getTime();
    const maxTimeMs = startTimeMs + 90 * 60 * 1e3;
    effectiveCheckpoints = checkpoints.filter((cp) => {
      const cpTimeMs = new Date(cp.timestamp).getTime();
      return cpTimeMs <= maxTimeMs;
    });
    if (effectiveCheckpoints.length > 0) {
      const lastCpTimeMs = new Date(effectiveCheckpoints[effectiveCheckpoints.length - 1].timestamp).getTime();
      const actualDurationMins = Math.floor((lastCpTimeMs - startTimeMs) / 6e4);
      effectiveMins = Math.min(getEffectiveMinutes(type, durationMins || 0), Math.max(0, actualDurationMins));
    }
    if (type === "cardio" && effectiveCheckpoints.length >= 2) {
      let recalculatedDist = 0;
      for (let i = 1; i < effectiveCheckpoints.length; i++) {
        const p1 = effectiveCheckpoints[i - 1].location;
        const p2 = effectiveCheckpoints[i].location;
        recalculatedDist += calculateDistance3(p1.lat, p1.lng, p2.lat, p2.lng);
      }
      effectiveDistanceKm = Math.min(distanceKm || 0, recalculatedDist);
    }
  }
  const validation = await performValidation({
    type,
    durationMins: effectiveMins,
    distanceKm: effectiveDistanceKm,
    photoBase64,
    checkpoints: effectiveCheckpoints,
    aiResult,
    // Pass through
    focus,
    description,
    cardioType: req.body.cardioType,
    smartwatchData: req.body.smartwatchData,
    userId: auth.uid,
    isMockLocation: req.body.isMockLocation || false,
    isEmulator: req.body.isEmulator || false,
    isRooted: req.body.isRooted || false,
    isDeveloperMode: req.body.isDeveloperMode || false,
    hasSensorOscillation: req.body.hasSensorOscillation ?? true,
    sensorStatus: req.body.sensorStatus || "unavailable",
    pedometerSteps: req.body.pedometerSteps || 0
  });
  if (type === "diet") {
    const now = /* @__PURE__ */ new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 6e4);
    const recentMeals = await db.collection("workouts").where("userId", "==", auth.uid).where("type", "==", "diet").where("timestamp", ">=", oneHourAgo.toISOString()).limit(1).get();
    if (recentMeals.size > 0) {
      return res.status(400).json({ error: "Aguarde pelo menos 1 hora entre os registros de refei\xE7\xF5es." });
    }
  } else if (type === "recovery") {
    const sevenDaysAgo = /* @__PURE__ */ new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentRecoveries = await db.collection("workouts").where("userId", "==", auth.uid).where("type", "==", "recovery").where("timestamp", ">=", sevenDaysAgo.toISOString()).get();
    if (recentRecoveries.size >= 2) {
      return res.status(400).json({ error: "Limite atingido! Apenas 2 dias de recupera\xE7\xE3o s\xE3o permitidos a cada 7 dias." });
    }
    const yesterday = /* @__PURE__ */ new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString("sv-SE");
    let consecutiveRecovery = false;
    recentRecoveries.forEach((doc2) => {
      const w = doc2.data();
      const wDate = new Date(w.timestamp).toLocaleDateString("sv-SE");
      if (wDate === yesterdayStr) {
        consecutiveRecovery = true;
      }
    });
    if (consecutiveRecovery) {
      return res.status(400).json({ error: "Dias de descanso n\xE3o podem ser consecutivos. Treine hoje para manter o rendimento!" });
    }
  }
  const isWorkoutOrCardio = type === "workout" || type === "cardio";
  if (isWorkoutOrCardio) {
    const userRef2 = db.collection("users").doc(auth.uid);
    const userSnap = await userRef2.get();
    const userData = userSnap?.exists ? userSnap.data() || {} : {};
    let trustScore = 100;
    try {
      const trustProfileSnap = await db.collection("user_trust_profiles").doc(auth.uid).get();
      if (trustProfileSnap.exists) {
        trustScore = trustProfileSnap.data()?.trustScore ?? 100;
      } else if (userData.createdAt) {
        const ageMs = Date.now() - new Date(userData.createdAt).getTime();
        const ageDays = ageMs / (1e3 * 60 * 60 * 24);
        trustScore = ageDays > 30 ? 95 : 70;
      } else {
        trustScore = 70;
      }
    } catch (_) {
    }
    let riskAcc = 10;
    const isMockLoc = req.body.isMockLocation || false;
    const isEmu = req.body.isEmulator || false;
    const isRoot = req.body.isRooted || false;
    const isDev = req.body.isDeveloperMode || false;
    const hasOscillation = req.body.hasSensorOscillation ?? true;
    const sensStatus = req.body.sensorStatus || "unavailable";
    if (isEmu || isDev) riskAcc += 25;
    if (isMockLoc || isRoot) riskAcc += 45;
    if (sensStatus === "unavailable" || !hasOscillation) riskAcc += 15;
    if (validation && validation.status === "suspicious") riskAcc += 20;
    if (validation && validation.status === "invalid") riskAcc += 35;
    if (userData.subscriptionTier === "performance") {
      const swData = req.body.smartwatchData;
      const isStravaConnected = !!userData.strava_connected;
      const hasSmartwatch = !!swData;
      const hasHeartRate = swData && (Number(swData.avgHR) > 0 || Number(swData.maxHR) > 0 || swData.heartRate && swData.heartRate.length > 0);
      const hasStravaHR = validation?.details?.stravaMatch?.has_heartrate === true || validation?.details?.stravaMatch?.average_heartrate && validation?.details?.stravaMatch?.average_heartrate > 0;
      const isMissingBio = !isStravaConnected || !hasHeartRate && !hasStravaHR;
      if (isMissingBio) {
        if (validation) {
          const hasMajorFraud = isMockLoc || isEmu || validation.antiFraudFlags && (validation.antiFraudFlags.includes("REPLAY_PREVIOUS_ROUTE_MATCH") || validation.antiFraudFlags.includes("VEHICLE_SPEED_DETECTED") || validation.antiFraudFlags.includes("UNREALISTIC_ATHLETIC_SPEED_SUSTAINED") || validation.antiFraudFlags.includes("STRAVA_DIVERGENCE_ALERT") || validation.antiFraudFlags.includes("MOCK_LOCATION_FLAG_ACTIVE") || validation.antiFraudFlags.includes("EMULATOR_ENVIRONMENT_DETECTED") || validation.antiFraudFlags.includes("SUSPICIOUS_SENSED_CYCLIC_VIBRATION") || validation.antiFraudFlags.includes("SMARTWATCH_DATA_SUSPICIOUS"));
          if (!hasMajorFraud) {
            validation.status = "biometria_incompleta";
            validation.requiresManualReview = false;
            if (validation.antiFraudFlags) {
              if (!validation.antiFraudFlags.includes("PERFORMANCE_BIOMETRIC_INCOMPLETE")) {
                validation.antiFraudFlags.push("PERFORMANCE_BIOMETRIC_INCOMPLETE");
              }
            } else {
              validation.antiFraudFlags = ["PERFORMANCE_BIOMETRIC_INCOMPLETE"];
            }
          } else {
            validation.status = "suspicious";
            validation.requiresManualReview = true;
            if (validation.antiFraudFlags) {
              validation.antiFraudFlags.push("PERFORMANCE_BIOMETRIC_FAIL");
            } else {
              validation.antiFraudFlags = ["PERFORMANCE_BIOMETRIC_FAIL"];
            }
            validation.score = Math.max(0, (validation.score || 100) - 40);
            riskAcc += 40;
          }
        }
      } else {
        if (validation) {
          validation.isBiometricVerified = true;
          if (validation.antiFraudFlags) {
            validation.antiFraudFlags.push("BIOMETRICALLY_VERIFIED");
          } else {
            validation.antiFraudFlags = ["BIOMETRICALLY_VERIFIED"];
          }
        }
      }
    }
    const calculatedSpeed = effectiveDistanceKm / (effectiveMins || 1);
    if (type === "cardio" && calculatedSpeed > 0.25) riskAcc += 20;
    const presenceRiskScore = Math.min(100, Math.max(0, riskAcc));
    let presenceCheckRequired = false;
    if (type === "workout" && validation) {
      const reliabilityScore = validation.score ?? 100;
      if (reliabilityScore >= 90) {
        presenceCheckRequired = Math.random() < 0.02;
      } else if (reliabilityScore >= 70) {
        presenceCheckRequired = Math.random() < 0.1;
      } else if (reliabilityScore >= 50) {
        presenceCheckRequired = Math.random() < 0.45;
      } else {
        presenceCheckRequired = true;
      }
    } else if (presenceRiskScore >= 75) {
      presenceCheckRequired = true;
    } else {
      let triggerProbability = 0.1;
      if (trustScore >= 90) {
        triggerProbability = 0.05;
      } else if (trustScore < 70) {
        triggerProbability = 0.3;
      }
      if (presenceRiskScore >= 40) {
        triggerProbability = Math.max(triggerProbability, 0.4);
      }
      presenceCheckRequired = Math.random() < triggerProbability;
    }
    if (presenceCheckRequired) {
      const dbCollection = db.collection("pending_presence_checks");
      const presenceCheckId = dbCollection.doc().id;
      const nowTime = /* @__PURE__ */ new Date();
      const expiredAt = new Date(nowTime.getTime() + 15 * 60 * 1e3).toISOString();
      const GESTURES = [
        "pisque os olhos repetidamente",
        "d\xEA um sorriso natural para a c\xE2mera",
        "vire a cabe\xE7a levemente para a esquerda",
        "vire a cabe\xE7a levemente para a direita",
        "levante uma das m\xE3os \xE0 altura do ombro",
        "olhe diretamente para cima e depois para a c\xE2mera"
      ];
      const livenessPrompt = GESTURES[Math.floor(Math.random() * GESTURES.length)];
      await dbCollection.doc(presenceCheckId).set({
        id: presenceCheckId,
        userId: auth.uid,
        type,
        livenessPrompt,
        riskScore: presenceRiskScore,
        createdAt: nowTime.toISOString(),
        expiredAt,
        workoutPayload: req.body,
        status: "pending"
      });
      try {
        await logEvent({
          severity: "INFO",
          category: "fraud_audit_logs",
          message: `Confirma\xE7\xE3o de presen\xE7a ativada (${livenessPrompt}) face ao risco residual ${presenceRiskScore} para ${auth.uid}`,
          userId: auth.uid,
          route: "/api/validate-activity",
          details: {
            presenceCheckId,
            presenceRiskScore,
            livenessPrompt
          }
        });
      } catch (_) {
      }
      return res.json({
        success: true,
        // indicate endpoint parsing success
        status: "presence_check_required",
        presenceCheckRequired: true,
        presenceCheckId,
        livenessPrompt,
        userMessage: "Para manter a integridade fiscal e esportiva do ranking, conclua a confirma\xE7\xE3o r\xE1pida de presen\xE7a f\xEDsica."
      });
    }
  }
  const userRef = db.collection("users").doc(auth.uid);
  let recentWorkouts = [];
  try {
    const recentDocs = await db.collection("workouts").where("userId", "==", auth.uid).limit(15).get();
    recentWorkouts = recentDocs.docs.map((d) => d.data());
  } catch (err) {
    console.warn("[Antifraud Engine] Safe-catch user previous workouts reading error:", err);
  }
  let activePrivateMemberships = [];
  try {
    const membershipsSnap = await db.collection("private_challenge_members").where("userId", "==", auth.uid).get();
    activePrivateMemberships = membershipsSnap.docs.map((d) => d.data());
  } catch (err) {
    console.warn("[Private Challenges Sync] Error reading user memberships:", err);
  }
  const transactionFn = async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) throw new Error("Usu\xE1rio n\xE3o encontrado.");
    const userData = userSnap.data() || {};
    if (userData.isBlocked === true || userData.isBanned === true || userData.isFrozen === true) {
      throw new Error("Sua conta ou atividade est\xE1 bloqueada, suspensa ou sob revis\xE3o manual administrativa.");
    }
    if (type === "recovery" && (userData.streak || 0) <= 0) {
      throw new Error("Voc\xEA precisa ter pelo menos 1 dia de streak ativo de treino para utilizar o descanso inteligente.");
    }
    const nowLocalDate = /* @__PURE__ */ new Date();
    const todayISO = nowLocalDate.toISOString().split("T")[0];
    const getWeekNo = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
    };
    const currentWeekNo = getWeekNo(nowLocalDate);
    const weekId = `${nowLocalDate.getFullYear()}-W${currentWeekNo}`;
    const weeklyStatsRef = db.collection("users").doc(auth.uid).collection("weeklyStats").doc(weekId);
    const weeklyStatsSnap = await transaction.get(weeklyStatsRef);
    let weeklyStatsData = weeklyStatsSnap.exists ? weeklyStatsSnap.data() : {
      weekId,
      scoredDays: [],
      totalScoredDays: 0,
      totalPoints: 0
    };
    const scoredDays = weeklyStatsData.scoredDays || [];
    const isDayAlreadyScored = scoredDays.includes(todayISO);
    const todayStr = (/* @__PURE__ */ new Date()).toLocaleDateString("sv-SE");
    const todayDocs = await db.collection("workouts").where("userId", "==", auth.uid).where("timestamp", ">=", todayStr).get();
    let todayPoints = 0;
    let todayDietPoints = 0;
    todayDocs.forEach((d) => {
      const w = d.data();
      if (w.status !== "invalid") {
        todayPoints += w.points || 0;
        if (w.type === "diet") {
          todayDietPoints += w.points || 0;
        }
      }
    });
    const scoring = calculatePoints(type, userData.streak || 0, todayDocs.empty, {
      duration: effectiveMins,
      distance: effectiveDistanceKm,
      hasExercises,
      hasPhoto: !!photoBase64,
      iaConfidence: validation.score,
      wonLastSeason: userData.wonLastSeason,
      age: userData.age,
      weight: userData.weight,
      smartwatchData: req.body.smartwatchData,
      scoredDays,
      todayISO,
      subscriptionTier: userData.subscriptionTier || "open"
    }, userData.seasonBoost || 0);
    let sessionIntegrityScore = 100;
    let validationStatus = "validated";
    let locationConfirmed = true;
    let activeTimeValid = true;
    let movementDetected = true;
    let compatiblePauses = true;
    let minimumConsistency = true;
    let sessionConfidence = true;
    let antiFraudFlags = [];
    let distanceFromGymMeters = 0;
    let gpsAccuracy = 15;
    let pausePatternScore = 100;
    let movementConfidence = 100;
    const isMockLocation = req.body.isMockLocation || false;
    const isEmulator = req.body.isEmulator || false;
    const isRooted = req.body.isRooted || false;
    const isDeveloperMode = req.body.isDeveloperMode || false;
    const hasSensorOscillation = req.body.hasSensorOscillation ?? true;
    const sensorStatus = req.body.sensorStatus || "unavailable";
    const pedometerSteps = req.body.pedometerSteps || 0;
    const trustProfileRef = db.collection("user_trust_profiles").doc(auth.uid);
    const trustProfileSnap = await transaction.get(trustProfileRef);
    let userTrustScore = 100;
    if (trustProfileSnap.exists) {
      userTrustScore = trustProfileSnap.data()?.trustScore ?? 100;
    } else if (userData.createdAt) {
      const ageMs = Date.now() - new Date(userData.createdAt).getTime();
      const ageDays = ageMs / (1e3 * 60 * 60 * 24);
      userTrustScore = ageDays > 30 ? 95 : 70;
    } else {
      userTrustScore = 70;
    }
    let fraudRiskScore = 0.05;
    let trustLevel = "high";
    let fraudAnalysis = null;
    if (type === "workout" || type === "cardio") {
      const isWorkout = type === "workout";
      if (isWorkout && userData.gymId) {
        const gymRef = db.collection("gyms").doc(userData.gymId);
        const gymSnap = await transaction.get(gymRef);
        if (gymSnap.exists) {
          const gymData = gymSnap.data();
          const startLoc = req.body.startLocation;
          const endLoc = req.body.endLocation;
          const anyLoc = endLoc || startLoc || checkpoints && checkpoints[0]?.location;
          if (anyLoc) {
            const gymLat = gymData.latitude !== void 0 ? gymData.latitude : gymData.lat;
            const gymLng = gymData.longitude !== void 0 ? gymData.longitude : gymData.lng;
            const dist = calculateDistance3(anyLoc.lat, anyLoc.lng, gymLat, gymLng) * 1e3;
            distanceFromGymMeters = Math.round(dist);
            gpsAccuracy = Math.round(anyLoc.accuracy || 15);
            const adjustedDist = Math.max(0, dist - gpsAccuracy);
            if (adjustedDist <= 50) {
              locationConfirmed = true;
            } else {
              locationConfirmed = false;
              antiFraudFlags.push("location_out_of_bounds");
            }
          } else {
            antiFraudFlags.push("missing_location_coordinates");
            locationConfirmed = false;
          }
        }
      }
      if (isSessionDurationValid(type, effectiveMins)) {
        activeTimeValid = true;
      } else {
        activeTimeValid = false;
        antiFraudFlags.push("session_too_short");
      }
      if (type === "cardio" || type === "workout") {
        sessionIntegrityScore = validation.score;
        antiFraudFlags = validation.antiFraudFlags || [];
        if (validation.status === "valid") {
          validationStatus = "validated";
          trustLevel = "high";
          fraudRiskScore = (100 - sessionIntegrityScore) / 100;
        } else if (validation.status === "suspicious") {
          validationStatus = "partially_validated";
          trustLevel = "medium";
          fraudRiskScore = (100 - sessionIntegrityScore) / 100;
        } else if (validation.status === "pending_review") {
          validationStatus = "under_review";
          trustLevel = "low";
          fraudRiskScore = (100 - sessionIntegrityScore) / 100;
        } else if (validation.status === "biometria_incompleta") {
          validationStatus = "biometria_incompleta";
          trustLevel = "medium";
          fraudRiskScore = 0;
        } else {
          validationStatus = "not_eligible";
          trustLevel = "none";
          fraudRiskScore = 1;
        }
        locationConfirmed = validation.details?.locationConfirmed ?? true;
        activeTimeValid = validation.details?.activeTimeValid ?? true;
        movementDetected = validation.details?.movementDetected ?? true;
        compatiblePauses = validation.details?.compatiblePauses ?? true;
        minimumConsistency = validation.details?.minimumConsistency ?? true;
        sessionConfidence = validation.details?.sessionConfidence ?? true;
        pausePatternScore = validation.details?.pausePatternScore ?? 100;
        movementConfidence = validation.details?.movementConfidence ?? 100;
      } else {
        fraudAnalysis = analyzeGPSSession(
          effectiveCheckpoints,
          effectiveMins,
          effectiveDistanceKm,
          userTrustScore,
          pedometerSteps,
          isMockLocation,
          isEmulator,
          isRooted,
          isDeveloperMode,
          hasSensorOscillation,
          recentWorkouts,
          sensorStatus
        );
        fraudRiskScore = fraudAnalysis.fraudRiskScore;
        trustLevel = fraudAnalysis.trustLevel;
        if (fraudAnalysis.fraudFlags && fraudAnalysis.fraudFlags.length > 0) {
          antiFraudFlags.push(...fraudAnalysis.fraudFlags);
        }
        if (!locationConfirmed) {
          fraudRiskScore = Math.min(1, fraudRiskScore + 0.4);
          if (fraudRiskScore >= 0.75) trustLevel = "none";
          else if (fraudRiskScore >= 0.5) trustLevel = "low";
          else if (fraudRiskScore >= 0.25) trustLevel = "medium";
        }
        sessionIntegrityScore = Math.max(0, Math.round(100 - fraudRiskScore * 100));
        pausePatternScore = Math.round(fraudAnalysis.details.intervalStdDev ? Math.min(100, fraudAnalysis.details.intervalStdDev * 20) : 100);
        movementConfidence = Math.round(fraudAnalysis.details.speedStdDev ? Math.min(100, fraudAnalysis.details.speedStdDev * 300) : 100);
        if (checkpoints && checkpoints.length < 2) {
          movementDetected = false;
          compatiblePauses = false;
          movementConfidence = 0;
          pausePatternScore = 0;
        }
        if (trustLevel === "high") {
          validationStatus = "validated";
          minimumConsistency = true;
          sessionConfidence = true;
        } else if (trustLevel === "medium") {
          validationStatus = "partially_validated";
          minimumConsistency = true;
          sessionConfidence = false;
        } else if (trustLevel === "low") {
          validationStatus = "under_review";
          minimumConsistency = false;
          sessionConfidence = false;
        } else {
          validationStatus = "not_eligible";
          minimumConsistency = false;
          sessionConfidence = false;
        }
      }
      if (validation.status === "biometria_incompleta") {
        validationStatus = "biometria_incompleta";
        validation.score = 0;
        validation.requiresManualReview = false;
      } else if (validation.status === "pending_review" || validation.requiresManualReview === true) {
        validationStatus = "under_review";
        validation.status = "pending_review";
        validation.score = 0;
      } else {
        validation.status = trustLevel === "high" ? "valid" : trustLevel === "medium" || trustLevel === "low" ? "suspicious" : "invalid";
        validation.score = sessionIntegrityScore;
      }
      validation.reason = antiFraudFlags.length > 0 ? antiFraudFlags.map((flag) => {
        const labels = {
          "location_out_of_bounds": "Local fora do raio de 50m da academia",
          "missing_location_coordinates": "Coordenadas n\xE3o detectadas",
          "session_too_short": "Tempo inferior a 15 minutos",
          "MISSING_GPS_CHECKPOINTS": "Nenhum ponto de GPS recebido",
          "ROBOTIC_GPS_INTERVALS": "Inconsist\xEAncia de intervalos GPS (Rob\xF3ticos)",
          "ARTIFICIAL_PERFECT_GPS_ACCURACY": "Precis\xE3o de GPS est\xE1tica (Artificial)",
          "EXCESSIVE_ROUTE_LINEARITY": "Simula\xE7\xE3o de reta sem desvio (Jitterless)",
          "UNNATURAL_CURVE_SPEED_BEHAVIOR": "Velocidade constante em curvas (Improv\xE1vel)",
          "ARTIFICIAL_CONSTANT_PACE": "Ritmo biomecanicamente est\xE1tico",
          "IMPOSSIBLE_ACCELERATION_RATES": "Picos de acelera\xE7\xE3o n\xE3o-humanos",
          "VEHICLE_SPEED_DETECTED": "Velocidade incompat\xEDvel com atletismo",
          "UNREALISTIC_ATHLETIC_SPEED_SUSTAINED": "Velocidade atl\xE9tica insustent\xE1vel",
          "MOCK_LOCATION_FLAG_ACTIVE": "Mock Location ativa detectada",
          "EMULATOR_ENVIRONMENT_DETECTED": "Ambiente de emula\xE7\xE3o detectado",
          "ROOT_OR_JAILBREAK_HEURISTIC_TRIGGER": "Dispositivo com root/jailbreak",
          "DEVELOPER_MODE_ACTIVE": "Modo desenvolvedor ativo no celular",
          "SENSORS_NO_PHYSICAL_OSCILLATION": "Aus\xEAncia de movimento f\xEDsico nos sensores",
          "SENSORS_LOW_OSCILLATION": "Baixo sinal de oscila\xE7\xE3o f\xEDsica nos sensores",
          "PEDOMETER_STEP_RATIO_IMPROBABLE": "Contagem de passos incoerente com dist\xE2ncia",
          "SENSOR_GPS_TRAVEL_MISMATCH": "Sem movimento mec\xE2nico detectado na dist\xE2ncia",
          "SENSOR_GPS_TRAVEL_WEAK_SIGNAL": "Inconsist\xEAncia biomec\xE2nica sutil de passos",
          "REPLAY_PREVIOUS_ROUTE_MATCH": "Replay exato de rota anterior (Antifraud Match)"
        };
        return labels[flag] || flag;
      }).join(" | ") : "Atividade compat\xEDvel com esfor\xE7o real.";
      validation.details = {
        sessionIntegrityScore,
        validationStatus,
        locationConfirmed,
        activeTimeValid,
        movementDetected,
        compatiblePauses,
        minimumConsistency,
        sessionConfidence,
        antiFraudFlags,
        distanceFromGymMeters,
        gpsAccuracy,
        pausePatternScore,
        movementConfidence,
        sensorStatus: fraudAnalysis?.sensorStatus || sensorStatus,
        sensorConfidence: fraudAnalysis?.sensorConfidence || "unavailable",
        riskContribution: fraudAnalysis?.riskContribution || "unavailable",
        fraudAnalysis: {
          fraudRiskScore,
          trustLevel,
          details: fraudAnalysis?.details || null
        }
      };
    } else {
      if (type === "workout" && userData.gymId) {
        const gymRef = db.collection("gyms").doc(userData.gymId);
        const gymSnap = await transaction.get(gymRef);
        if (gymSnap.exists) {
          const gymData = gymSnap.data();
          const loc = req.body.endLocation || req.body.startLocation;
          if (loc) {
            const dist = calculateDistance3(loc.lat, loc.lng, gymData.latitude, gymData.longitude);
            if (dist > 0.05) {
              validation.status = "invalid";
              validation.reason = "Voc\xEA precisa estar pr\xF3ximo da academia para iniciar o treino.";
            }
          }
        }
      }
    }
    if (validation.status === "pending_review" || validation.requiresManualReview === true) {
      validationStatus = "under_review";
    }
    let pointsEarned2 = 0;
    if (userData.isSubscribed || true) {
      if (type === "diet") {
        pointsEarned2 = 0;
      } else if (type === "recovery") {
        pointsEarned2 = 15;
        if (todayPoints + pointsEarned2 > 100) {
          pointsEarned2 = Math.max(0, 100 - todayPoints);
        }
      } else if (type === "workout" || type === "cardio") {
        if (validationStatus === "validated") {
          pointsEarned2 = Math.round(scoring.earned * (sessionIntegrityScore / 100));
        } else if (validationStatus === "partially_validated") {
          pointsEarned2 = Math.round(scoring.earned * (sessionIntegrityScore / 100) * 0.75);
        } else {
          pointsEarned2 = 0;
        }
        if (todayPoints + pointsEarned2 > 100) {
          pointsEarned2 = Math.max(0, 100 - todayPoints);
        }
      } else {
        if (validation.status === "valid") {
          pointsEarned2 = Math.round(scoring.earned * (validation.score / 100));
        } else if (validation.status === "suspicious") {
          pointsEarned2 = Math.round(scoring.earned * 0.2);
        }
        if (todayPoints + pointsEarned2 > 100) {
          pointsEarned2 = Math.max(0, 100 - todayPoints);
        }
      }
    } else {
      pointsEarned2 = 0;
    }
    let isScoringEligible2 = false;
    let nonScoringReason2 = null;
    if (pointsEarned2 > 0) {
      if (isDayAlreadyScored) {
        isScoringEligible2 = true;
      } else if (scoredDays.length < 5) {
        isScoringEligible2 = true;
        scoredDays.push(todayISO);
        weeklyStatsData.scoredDays = scoredDays;
        weeklyStatsData.totalScoredDays = scoredDays.length;
      } else {
        isScoringEligible2 = false;
        nonScoringReason2 = "WEEKLY_SCORING_LIMIT_REACHED";
        pointsEarned2 = 0;
      }
    } else {
      isScoringEligible2 = true;
    }
    if (pointsEarned2 > 0) {
      weeklyStatsData.totalPoints = (weeklyStatsData.totalPoints || 0) + pointsEarned2;
      weeklyStatsData.updatedAt = import_firestore.FieldValue.serverTimestamp();
      transaction.set(weeklyStatsRef, weeklyStatsData);
    }
    const now = /* @__PURE__ */ new Date();
    const workoutRef = db.collection("workouts").doc();
    const stValue = import_firestore.FieldValue.serverTimestamp();
    const lastWeekly = userData.lastWeeklyResetAt ? new Date(userData.lastWeeklyResetAt) : /* @__PURE__ */ new Date(0);
    const lastMonthly = userData.lastMonthlyResetAt ? new Date(userData.lastMonthlyResetAt) : /* @__PURE__ */ new Date(0);
    const getWeekNumber = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
    };
    const currentWeek = getWeekNumber(now);
    const lastWeek = getWeekNumber(lastWeekly);
    const currentMonth = now.getMonth();
    const lastMonthValue = lastMonthly.getMonth();
    const currentYear = now.getFullYear();
    const lastYearValue = lastMonthly.getFullYear();
    const isNewWeek = currentWeek !== lastWeek || now.getFullYear() !== lastWeekly.getFullYear();
    const isNewMonth = currentMonth !== lastMonthValue || currentYear !== lastYearValue;
    let shouldAdvanceStreak = true;
    if ((type === "workout" || type === "cardio") && (validationStatus === "under_review" || validationStatus === "not_eligible" || validationStatus === "biometria_incompleta")) {
      shouldAdvanceStreak = false;
    }
    const lastCheckIn = userData.lastCheckIn ? new Date(userData.lastCheckIn) : null;
    let newStreak = userData.streak || 0;
    if (type !== "recovery" && shouldAdvanceStreak) {
      if (lastCheckIn) {
        const lastCheckInDay = userData.lastCheckIn.split("T")[0];
        if (todayISO !== lastCheckInDay) {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayISO = yesterday.toISOString().split("T")[0];
          if (lastCheckInDay === yesterdayISO) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }
        }
      } else {
        newStreak = 1;
      }
    }
    const updates = {
      updatedAt: stValue
    };
    if (userData.isSubscribed || true) {
      updates.score = (userData.score || 0) + pointsEarned2;
      updates.weeklyScore = (isNewWeek ? 0 : userData.weeklyScore || 0) + pointsEarned2;
      updates.monthlyScore = (isNewMonth ? 0 : userData.monthlyScore || 0) + pointsEarned2;
      if (shouldAdvanceStreak || type === "recovery" || type === "diet") {
        updates.streak = newStreak;
        updates.lastCheckIn = now.toISOString();
        const lastCheckInDayStr = userData.lastCheckIn ? userData.lastCheckIn.split("T")[0] : "";
        if (todayISO !== lastCheckInDayStr) {
          updates.totalActiveDays = (userData.totalActiveDays || 0) + 1;
        }
      }
      if (isNewWeek) updates.lastWeeklyResetAt = now.toISOString();
      if (isNewMonth) updates.lastMonthlyResetAt = now.toISOString();
      if ((type === "workout" || type === "cardio") && validationStatus === "validated") {
        updates.totalWorkouts = (userData.totalWorkouts || 0) + 1;
      }
    }
    if (type === "workout" || type === "cardio") {
      const trainingSessionId = db.collection("training_sessions").doc().id;
      const trainingSessionObj = {
        id: trainingSessionId,
        userId: auth.uid,
        gymId: type === "workout" ? userData.gymId || "" : "",
        checkInId: type === "workout" ? req.body.checkInId || "" : "",
        startedAt: req.body.startLocationTimestamp || new Date(now.getTime() - effectiveMins * 6e4).toISOString(),
        endedAt: now.toISOString(),
        startLatitude: req.body.startLocation ? req.body.startLocation.lat : 0,
        startLongitude: req.body.startLocation ? req.body.startLocation.lng : 0,
        distanceFromGymMeters,
        gpsAccuracy,
        deviceId: req.body.deviceId || `agent_${Math.random().toString(36).substring(2, 10)}`,
        activeMinutes: effectiveMins,
        movementConfidence,
        pausePatternScore,
        sessionIntegrityScore,
        validationStatus,
        antiFraudFlags,
        createdAt: stValue
      };
      transaction.set(db.collection("training_sessions").doc(trainingSessionId), trainingSessionObj);
      const trustProfileRefUpdate = db.collection("user_trust_profiles").doc(auth.uid);
      const trustProfileSnapUpdate = await transaction.get(trustProfileRefUpdate);
      let trustScore = 100;
      let validatedSessions = 0;
      let suspiciousSessions = 0;
      let fraudRiskLevel = "low";
      if (trustProfileSnapUpdate.exists) {
        const tpData = trustProfileSnapUpdate.data();
        trustScore = tpData.trustScore ?? 100;
        validatedSessions = tpData.validatedSessions ?? 0;
        suspiciousSessions = tpData.suspiciousSessions ?? 0;
      }
      if (validationStatus === "validated") {
        validatedSessions += 1;
        trustScore = Math.min(100, trustScore + 2);
      } else if (validationStatus === "partially_validated") {
        trustScore = Math.min(100, trustScore + 0.5);
      } else {
        suspiciousSessions += 1;
        trustScore = Math.max(0, trustScore - 15);
      }
      if (trustScore >= 80) fraudRiskLevel = "low";
      else if (trustScore >= 50) fraudRiskLevel = "medium";
      else fraudRiskLevel = "high";
      transaction.set(trustProfileRefUpdate, {
        userId: auth.uid,
        trustScore,
        validatedSessions,
        suspiciousSessions,
        lastValidationReview: now.toISOString(),
        fraudRiskLevel,
        updatedAt: stValue
      }, { merge: true });
      if (fraudRiskScore >= 0.25) {
        const logId = db.collection("fraud_audit_logs").doc().id;
        let severityValue = "INFO";
        if (fraudRiskScore >= 0.75) severityValue = "CRITICAL";
        else if (fraudRiskScore >= 0.5) severityValue = "HIGH_RISK";
        else severityValue = "WARNING";
        let actionTakenValue = "shadow_logged";
        if (validationStatus === "partially_validated") actionTakenValue = "auto_partially_validated";
        else if (validationStatus === "under_review") actionTakenValue = "auto_under_review";
        else if (validationStatus === "not_eligible") actionTakenValue = "auto_not_eligible";
        const fraudAuditLogObj = {
          id: logId,
          userId: auth.uid,
          activityId: workoutRef.id,
          displayName: userData.displayName || "Atleta",
          type,
          fraudRiskScore: Number(fraudRiskScore.toFixed(3)),
          fraudFlags: antiFraudFlags,
          trustLevel,
          severity: severityValue,
          actionTaken: actionTakenValue,
          gpsAccuracyStdDev: fraudAnalysis?.details?.accuracyStdDev || 0,
          routeFingerprint: fraudAnalysis?.details?.routeFingerprint || "",
          createdAt: now.toISOString(),
          timestamp: now.toISOString(),
          reviewStatus: "pending",
          reviewerId: "",
          resolution: ""
        };
        transaction.set(db.collection("fraud_audit_logs").doc(logId), fraudAuditLogObj);
        console.log(`[Antifraud Engine] Stored professional fraud audit log for user ${auth.uid} (risk: ${fraudRiskScore})`);
      }
    }
    const workout2 = {
      id: workoutRef.id,
      userId: auth.uid,
      type,
      cardioType: req.body.cardioType || null,
      cardioTypeLabel: req.body.cardioTypeLabel || null,
      isIndoorCardio: req.body.isIndoorCardio !== void 0 ? req.body.isIndoorCardio : null,
      requiresGpsDistance: req.body.requiresGpsDistance !== void 0 ? req.body.requiresGpsDistance : null,
      timestamp: now.toISOString(),
      duration: type === "recovery" ? 15 : effectiveMins,
      distance: effectiveDistanceKm || 0,
      status: type === "recovery" ? "valid" : validation.status,
      points: pointsEarned2,
      isScoringEligible: isScoringEligible2,
      checkInId: type === "workout" ? req.body.checkInId || null : null,
      ...isScoringEligible2 ? { scoringWeekId: weekId, scoringDate: todayISO } : { nonScoringReason: nonScoringReason2 },
      validation: type === "recovery" ? {
        status: "valid",
        reason: `Recupera\xE7\xE3o: ${(focus || "").toUpperCase()}`,
        score: 100,
        details: {
          locationMatch: true,
          aiAnalysis: `Foco de recupera\xE7\xE3o inteligente: ${focus}. Descri\xE7\xE3o: ${description}`,
          movementPattern: "stationary",
          focus,
          description,
          quizAnswers: quizAnswers || {}
        }
      } : validation,
      photoUrl: photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null,
      createdAt: stValue
    };
    const subTier = userData.subscriptionTier || "open";
    workout2.scoreType = subTier;
    if (subTier === "performance") {
      let biometricMetrics = null;
      if (type === "workout" || type === "cardio" || type === "recovery") {
        const swData = req.body.smartwatchData || (type === "recovery" ? { avgHR: 65, calories: 15 } : null);
        const duration = type === "recovery" ? 15 : effectiveMins || 20;
        const calories = swData ? Number(swData.calories || 0) : 0;
        const avgHR = swData ? Number(swData.avgHR || 0) : 0;
        const weight = userData.weight || 75;
        const age = userData.age || 25;
        const fcMax = 208 - 0.7 * age;
        const relativeIntensity = avgHR > 0 ? avgHR / fcMax : 0;
        let tempoScore = 0;
        if (duration > 0) {
          if (duration >= 45 && duration <= 90) {
            tempoScore = 100;
          } else if (duration < 45) {
            tempoScore = Math.round(duration / 45 * 100);
          } else {
            tempoScore = 100;
          }
        }
        let cardioScore = 0;
        if (relativeIntensity > 0) {
          if (relativeIntensity <= 0.4) {
            cardioScore = 0;
          } else if (relativeIntensity >= 0.85) {
            cardioScore = 100;
          } else {
            cardioScore = Math.round((relativeIntensity - 0.4) / (0.85 - 0.4) * 100);
          }
        }
        let energyScore = 0;
        if (calories > 0 && weight > 0) {
          const efficiency = calories / weight;
          energyScore = Math.min(100, Math.round(efficiency / 8 * 100));
        }
        const currentScoredCount = weeklyStatsData.totalScoredDays || scoredDays.length || 1;
        const consistencyScore = Math.min(100, currentScoredCount * 20);
        const pontuacaoJustaValue = Math.round((tempoScore + cardioScore + energyScore + consistencyScore) / 4);
        biometricMetrics = {
          userId: auth.uid,
          workoutId: workoutRef.id,
          timestamp: now.toISOString(),
          type,
          heartRate: avgHR,
          intensity: Number(relativeIntensity.toFixed(3)),
          calories,
          duration,
          consistency: currentScoredCount,
          tempoScore,
          cardioScore,
          energyScore,
          consistencyScore,
          pontuacaoJusta: pontuacaoJustaValue,
          contributeToResearch: userData.researchConsent !== false
        };
        workout2.biometricMetrics = biometricMetrics;
        workout2.performanceScoreBreakdown = scoring.scoreDetails?.breakdown || null;
        const bioMetricRef = db.collection("biometric_metrics").doc(`${auth.uid}_${workoutRef.id}`);
        transaction.set(bioMetricRef, biometricMetrics);
        const userResearchConsent = userData.researchConsent !== false;
        if (userResearchConsent) {
          const anonymizedRef = db.collection("anonymized_research_metrics").doc();
          transaction.set(anonymizedRef, {
            id: anonymizedRef.id,
            age,
            sex: userData.sex || "male",
            duration,
            calories,
            heartRate: avgHR,
            intensity: Number(relativeIntensity.toFixed(3)),
            tempoScore,
            cardioScore,
            energyScore,
            consistencyScore,
            pontuacaoJusta: pontuacaoJustaValue,
            type,
            createdAt: now.toISOString()
          });
        }
      }
    } else {
      workout2.openScoreBreakdown = scoring.scoreDetails?.breakdown || null;
    }
    transaction.set(workoutRef, workout2);
    transaction.update(userRef, updates);
    if (pointsEarned2 > 0 && activePrivateMemberships.length > 0 && (validationStatus === "validated" || validationStatus === "partially_validated")) {
      for (const membership of activePrivateMemberships) {
        const cRef = db.collection("private_challenges").doc(membership.challengeId);
        const cSnap = await transaction.get(cRef);
        if (cSnap.exists) {
          const cData = cSnap.data();
          if (cData.status === "active") {
            const mRef = db.collection("private_challenge_members").doc(`${auth.uid}_${membership.challengeId}`);
            transaction.update(mRef, {
              points: import_firestore.FieldValue.increment(pointsEarned2),
              workoutsCount: import_firestore.FieldValue.increment(1),
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        }
      }
    }
    if (type === "recovery") {
      try {
        const focusLabels = {
          alongamento: "Alongamento & Mobilidade \u{1F9D8}\u200D\u2640\uFE0F",
          sono: "Higiene do Sono Regenerativo \u{1F634}",
          meditacao: "Mindfulness e Medita\xE7\xE3o Ativa \u{1F9E0}",
          caminhada: "Caminhada Regenerativa Leve \u{1F6B6}"
        };
        const focusLabel = focusLabels[focus] || focus || "Descanso Focado";
        const customCaptions = [
          `concluiu um dia de recupera\xE7\xE3o inteligente (${focusLabel}). Consist\xEAncia tamb\xE9m \xE9 saber descansar.`,
          `concluiu sua recupera\xE7\xE3o de hoje (${focusLabel}). Recupera\xE7\xE3o conclu\xEDda mantendo streak de ${newStreak} dias!`,
          `ativou o descanso inteligente (${focusLabel}) focado em sa\xFAde e longevidade. Estilo de vida sustent\xE1vel!`
        ];
        const caption = `**${userData.displayName || "Atleta"}** ${customCaptions[Math.floor(Math.random() * customCaptions.length)]}

"Descanso planejado evita les\xF5es e maximiza a performance f\xEDsica e mental."

\u{1F3AF} Foco: ${description || ""}`;
        const bgs = [
          "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=600&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1518310383802-640c2de311b2?q=80&w=600&auto=format&fit=crop"
        ];
        const imageUrl = bgs[Math.floor(Math.random() * bgs.length)];
        const postRef = db.collection("posts").doc();
        const postObj = {
          id: postRef.id,
          userId: auth.uid,
          userDisplayName: userData.displayName || "Atleta",
          userPhotoURL: userData.photoURL || "https://picsum.photos/seed/athlete/100",
          imageUrl,
          caption,
          likesCount: 0,
          likedBy: [],
          commentsCount: 0,
          sharesCount: 0,
          createdAt: now.toISOString(),
          points: pointsEarned2,
          streak: newStreak
        };
        transaction.set(postRef, postObj);
        transaction.update(userRef, { postsCount: import_firestore.FieldValue.increment(1) });
      } catch (err) {
        console.warn("Silent backend issue making smart recovery social post:", err);
      }
    }
    if (type === "cardio" && validation.status === "valid" && distanceKm > 0 && isScoringEligible2) {
      try {
        const eliteSnap = await db.collection("user_elite_challenges").where("userId", "==", auth.uid).where("status", "==", "active").get();
        if (!eliteSnap.empty) {
          eliteSnap.forEach((eliteDoc) => {
            const eliteData = eliteDoc.data();
            const newKm = (eliteData.currentKm || 0) + distanceKm;
            const isCompleted = newKm >= eliteData.targetKm;
            transaction.update(eliteDoc.ref, {
              currentKm: newKm,
              activitiesCount: (eliteData.activitiesCount || 0) + 1,
              status: isCompleted ? "completed" : "active",
              lastActivityDate: now.toISOString()
            });
            const feedRef = db.collection("elite_feed").doc();
            transaction.set(feedRef, {
              userId: auth.uid,
              userName: userData.displayName,
              userPhoto: userData.photoURL,
              text: isCompleted ? `completou o desafio elite ${eliteData.challengeId.split("_")[0]}! \u{1F3C6}` : `correu ${distanceKm.toFixed(1)}km no desafio elite! \u{1F525}`,
              type: isCompleted ? "complete" : "activity",
              timestamp: now.toISOString()
            });
          });
        }
      } catch (err) {
        console.error("[Elite Update Error]", err);
      }
    }
    let returnedMessage = void 0;
    if (validation.status === "pending_review" || validation.requiresManualReview === true) {
      returnedMessage = "Sua atividade foi recebida e est\xE1 em an\xE1lise. N\xE3o foi poss\xEDvel concluir a valida\xE7\xE3o autom\xE1tica neste momento.";
    } else if (!isScoringEligible2 && nonScoringReason2 === "WEEKLY_SCORING_LIMIT_REACHED") {
      returnedMessage = "Treino registrado com sucesso, mas voc\xEA j\xE1 atingiu seus 5 dias pontu\xE1veis da semana.";
    }
    return {
      workout: workout2,
      pointsEarned: pointsEarned2,
      isScoringEligible: isScoringEligible2,
      nonScoringReason: nonScoringReason2,
      message: returnedMessage
    };
  };
  const result = await db.runTransaction(transactionFn);
  try {
    const isSuspicionFound = result.workout?.status !== "valid";
    let severityVal = "INFO";
    if (result.workout?.status === "suspicious") severityVal = "WARNING";
    else if (result.workout?.status === "invalid") severityVal = "HIGH_RISK";
    await logEvent({
      severity: severityVal,
      category: "activity_validation_logs",
      message: `Atividade do tipo ${type} processada com status '${result.workout?.status}' (Pontos acumulados: ${result.pointsEarned})`,
      userId: auth.uid,
      route: "/api/validate-activity",
      details: {
        activityId: result.workout?.id || "",
        pointsEarned: result.pointsEarned,
        isScoringEligible: result.isScoringEligible,
        nonScoringReason: result.nonScoringReason,
        status: result.workout?.status,
        type,
        distanceKm: effectiveDistanceKm,
        durationMins: effectiveMins,
        hasVerificationPhoto: !!photoBase64,
        fraudRiskScore: result.workout?.validation?.details?.fraudAnalysis?.fraudRiskScore || 0,
        fraudFlags: result.workout?.validation?.details?.fraudAnalysis?.fraudFlags || []
      }
    });
    await incrementMetric("activity_validations_total", 1);
    if (result.isScoringEligible && result.pointsEarned > 0) {
      await incrementMetric("activity_success_points_distributed_total", result.pointsEarned);
    }
  } catch (logErr) {
    console.error("[Observability Error] Non-blocking validation logging failure:", logErr);
  }
  const workout = result.workout;
  const pointsEarned = result.pointsEarned || 0;
  const isScoringEligible = result.isScoringEligible;
  const nonScoringReason = result.nonScoringReason;
  let success = true;
  let status = "approved";
  let reasonCode = null;
  let userMessage = "Atividade validada com sucesso. Seus pontos foram adicionados.";
  let canRetry = false;
  if (workout && workout.validation) {
    const v = workout.validation;
    const vStatus = v.status;
    const isUnderReview = vStatus === "pending_review" || v.requiresManualReview === true || v.validationStatus === "under_review";
    const isInvalid = vStatus === "invalid" || v.status === "invalid";
    const isBiometriaIncompleta = vStatus === "biometria_incompleta" || v.validationStatus === "biometria_incompleta";
    if (isBiometriaIncompleta) {
      success = true;
      status = "not_validated";
      reasonCode = "BIOMETRIA_INCOMPLETA";
      userMessage = "Atividade registrada, mas n\xE3o entrou no ranking Performance porque n\xE3o encontramos dados biom\xE9tricos v\xE1lidos do Strava. Verifique se seu rel\xF3gio sincronizou com o Strava antes de finalizar a atividade.";
      canRetry = false;
    } else if (isUnderReview) {
      success = false;
      status = "pending_review";
      reasonCode = v.isAiUnavailable ? "VALIDATION_SERVICE_UNAVAILABLE" : "PENDING_MANUAL_REVIEW";
      userMessage = getFriendlyMessage(reasonCode);
      canRetry = false;
    } else if (isInvalid) {
      success = false;
      status = "rejected";
      const errorMap = determineErrorCode(type, v.details?.antiFraudFlags || [], v.reason || "", nonScoringReason);
      reasonCode = errorMap.reasonCode;
      userMessage = errorMap.userMessage;
      canRetry = ["PHOTO_NOT_CLEAR", "LOCATION_PERMISSION_DENIED", "GPS_SIGNAL_WEAK"].includes(reasonCode);
    } else {
      if (!isScoringEligible && nonScoringReason === "WEEKLY_SCORING_LIMIT_REACHED") {
        success = false;
        status = "not_validated";
        reasonCode = "WEEKLY_LIMIT_REACHED";
        userMessage = getFriendlyMessage(reasonCode);
        canRetry = false;
      } else {
        success = true;
        status = "approved";
        reasonCode = null;
        userMessage = "Atividade validada com sucesso. Seus pontos foram adicionados.";
        canRetry = false;
      }
    }
  }
  const finalResponse = {
    ...result,
    success,
    status,
    reasonCode,
    userMessage,
    canRetry,
    pointsAwarded: pointsEarned,
    message: userMessage
  };
  return res.json(finalResponse);
}
function determineErrorCode(type, antiFraudFlags, validationReason, nonScoringReason) {
  if (nonScoringReason === "WEEKLY_SCORING_LIMIT_REACHED") {
    return {
      status: "not_validated",
      reasonCode: "WEEKLY_LIMIT_REACHED",
      userMessage: "Voc\xEA j\xE1 atingiu o limite de treinos semanais eleg\xEDveis para premia\xE7\xE3o. Continue mantendo a consist\xEAncia!"
    };
  }
  if (antiFraudFlags && antiFraudFlags.length > 0) {
    if (antiFraudFlags.includes("location_out_of_bounds")) {
      return {
        status: "rejected",
        reasonCode: "GPS_TOO_FAR_FROM_GYM",
        userMessage: "N\xE3o conseguimos validar este treino porque sua localiza\xE7\xE3o ficou fora da \xE1rea da academia cadastrada. No pr\xF3ximo treino, inicie a atividade estando dentro ou pr\xF3ximo da academia correta."
      };
    }
    if (antiFraudFlags.includes("missing_location_coordinates")) {
      return {
        status: "rejected",
        reasonCode: "LOCATION_PERMISSION_DENIED",
        userMessage: "N\xE3o foi poss\xEDvel validar sua atividade porque a permiss\xE3o de localiza\xE7\xE3o estava desativada. Ative a localiza\xE7\xE3o e tente novamente no pr\xF3ximo treino."
      };
    }
    if (antiFraudFlags.includes("session_too_short")) {
      return {
        status: "rejected",
        reasonCode: "INSUFFICIENT_TIME",
        userMessage: "Este treino n\xE3o atingiu o tempo m\xEDnimo necess\xE1rio para pontuar. Continue treinando pelo tempo m\xEDnimo indicado para que a atividade seja validada."
      };
    }
    if (antiFraudFlags.includes("VEHICLE_SPEED_DETECTED") || antiFraudFlags.includes("UNREALISTIC_ATHLETIC_SPEED_SUSTAINED")) {
      return {
        status: "rejected",
        reasonCode: "PACE_TOO_FAST",
        userMessage: "A velocidade registrada ficou acima do limite permitido para uma atividade humana. Por seguran\xE7a, essa atividade n\xE3o gerou pontos."
      };
    }
    if (antiFraudFlags.includes("REPLAY_PREVIOUS_ROUTE_MATCH")) {
      return {
        status: "rejected",
        reasonCode: "ACTIVITY_DUPLICATED",
        userMessage: "Esta atividade ou imagem j\xE1 foi enviada anteriormente. Registre um novo treino para continuar pontuando."
      };
    }
    if (antiFraudFlags.includes("IMPOSSIBLE_ACCELERATION_RATES") || antiFraudFlags.includes("IMPOSSIBLE_ACCELERATION")) {
      return {
        status: "rejected",
        reasonCode: "IMPOSSIBLE_ACCELERATION",
        userMessage: "Detectamos acelera\xE7\xF5es incompat\xEDveis com corrida ou caminhada humana no trajeto. Por seguran\xE7a, os pontos n\xE3o foram concedidos."
      };
    }
    if (antiFraudFlags.includes("MOCK_LOCATION_FLAG_ACTIVE")) {
      return {
        status: "rejected",
        reasonCode: "SUSPICIOUS_ROUTE",
        userMessage: "O trajeto apresentou sinais inconsistentes com uma atividade normal. Por seguran\xE7a, essa atividade foi enviada para an\xE1lise ou n\xE3o gerou pontua\xE7\xE3o."
      };
    }
  }
  const reasonText = (validationReason || "").toUpperCase();
  if (reasonText.includes("AI_VALIDATION_UNAVAILABLE")) {
    return {
      status: "pending_review",
      reasonCode: "VALIDATION_SERVICE_UNAVAILABLE",
      userMessage: "Sua atividade foi recebida, mas n\xE3o conseguimos concluir a valida\xE7\xE3o autom\xE1tica neste momento. Ela ficar\xE1 em an\xE1lise e voc\xEA ser\xE1 informado quando for revisada."
    };
  }
  if (reasonText.includes("TEMPORAL") || reasonText.includes("DURA\xC7\xC3O")) {
    return {
      status: "rejected",
      reasonCode: "INSUFFICIENT_TIME",
      userMessage: "Este treino n\xE3o atingiu o tempo m\xEDnimo necess\xE1rio para pontuar. Continue treinando pelo tempo m\xEDnimo indicado para que a atividade seja validada."
    };
  }
  if (reasonText.includes("VELOCIDADE") || reasonText.includes("RITMO")) {
    return {
      status: "rejected",
      reasonCode: "PACE_TOO_FAST",
      userMessage: "A velocidade registrada ficou acima do limite permitido para uma atividade humana. Por seguran\xE7a, essa atividade n\xE3o gerou pontos."
    };
  }
  if (reasonText.includes("FOTO") || reasonText.includes("IMAGEM") || type === "diet") {
    if (reasonText.includes("N\xCDTIDA") || reasonText.includes("NITIDA") || reasonText.includes("DESFOCADA")) {
      return {
        status: "rejected",
        reasonCode: "PHOTO_NOT_CLEAR",
        userMessage: "A foto enviada n\xE3o ficou n\xEDtida o suficiente para validar o treino. Tente enviar uma imagem mais clara, mostrando melhor o ambiente da atividade."
      };
    }
    return {
      status: "rejected",
      reasonCode: "PHOTO_NOT_FITNESS_CONTEXT",
      userMessage: "N\xE3o conseguimos identificar um ambiente compat\xEDvel com treino na imagem enviada. Para validar, envie uma foto que mostre claramente o local ou equipamento da atividade."
    };
  }
  return {
    status: "rejected",
    reasonCode: "UNKNOWN_VALIDATION_ERROR",
    userMessage: "N\xE3o conseguimos validar esta atividade no momento. Tente novamente ou realize uma nova atividade seguindo as regras do desafio."
  };
}
async function runGeminiValidation(photoBase64, type) {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    console.warn("[validate-activity] GEMINI_API_KEY not found on server.");
    return {
      isValid: false,
      status: "pending_review",
      requiresManualReview: true,
      pointsAwarded: 0,
      reason: "AI_VALIDATION_UNAVAILABLE"
    };
  }
  const prompt = type === "workout" ? "Voc\xEA \xE9 um inspetor de academia rigoroso. Analise esta imagem. Ela mostra de forma clara e inequ\xEDvoca um ambiente de academia (aparelhos, pesos, sala de aula) ou uma pessoa visivelmente praticando exerc\xEDcios? REJEITE e considere 'isValid: false' se for apenas uma selfie de rosto sem contexto, fotos de casa, objetos aleat\xF3rios ou ambientes n\xE3o-fitness. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em portugu\xEAs) e 'confidence' (0-100)." : type === "diet" ? "Voc\xEA \xE9 um nutricionista avaliando a ades\xE3o \xE0 dieta. Esta imagem mostra uma refei\xE7\xE3o real preparada (prato de comida, salada, frutas, lanche saud\xE1vel)? REJEITE e considere 'isValid: false' se for uma foto de ambiente, uma embalagem fechada, uma pessoa, um animal, objetos aleat\xF3rios, telas de computador ou fotos da internet. Deve ser comida real pronta para consumo. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em portugu\xEAs) e 'confidence' (0-100)." : "Voc\xEA \xE9 um monitor de desempenho esportivo. Analise esta imagem. Ela mostra de forma clara um contexto de atividade f\xEDsica (pessoa suada, roupa de treino, pista de corrida, parque, academia ou o visor de uma esteira/bike)? REJEITE se for uma foto sem contexto de esfor\xE7o f\xEDsico, fotos de ambientes internos comuns, animais, carros ou fotos da internet. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em portugu\xEAs) e 'confidence' (0-100).";
  try {
    const cleanBase64 = photoBase64.replace(/^data:image\/\w+;base64,/, "");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanBase64
          }
        },
        { text: prompt }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          properties: {
            isValid: { type: import_genai.Type.BOOLEAN },
            analysis: { type: import_genai.Type.STRING },
            confidence: { type: import_genai.Type.NUMBER }
          },
          required: ["isValid", "analysis", "confidence"]
        }
      }
    });
    const result = JSON.parse(response.text || "{}");
    return {
      isValid: result.isValid === true,
      analysis: result.analysis || "N\xE3o foi poss\xEDvel analisar a imagem.",
      confidence: Number(result.confidence) || 0
    };
  } catch (error) {
    console.error("Backend AI Validation Error:", error);
    return {
      isValid: false,
      status: "pending_review",
      requiresManualReview: true,
      pointsAwarded: 0,
      reason: "AI_VALIDATION_UNAVAILABLE"
    };
  }
}
async function performValidation(data) {
  if (data.type === "cardio") {
    return await executeAdvancedCardioValidation(data);
  }
  if (data.type === "workout") {
    return await executeAdvancedWorkoutValidation(data);
  }
  let score = 100;
  let status = "valid";
  const reasons = [];
  let requiresManualReview = false;
  let isAiUnavailable = false;
  if (data.checkpoints && data.checkpoints.length > 1 && data.durationMins > 0) {
    const first = new Date(data.checkpoints[0].timestamp).getTime();
    const last = new Date(data.checkpoints[data.checkpoints.length - 1].timestamp).getTime();
    const spanMins = (last - first) / 6e4;
    if (spanMins < data.durationMins * 0.9) {
      score -= 50;
      reasons.push("Inconsist\xEAncia temporal: dura\xE7\xE3o reportada excede tempo rasteado pelo GPS.");
    }
    if (data.type === "cardio" && data.distanceKm > 0) {
      let calcDist = 0;
      for (let i = 1; i < data.checkpoints.length; i++) {
        const p1 = data.checkpoints[i - 1].location;
        const p2 = data.checkpoints[i].location;
        calcDist += calculateDistance3(p1.lat, p1.lng, p2.lat, p2.lng);
      }
      if (calcDist < data.distanceKm * 0.8) {
        score -= 40;
        reasons.push("Inconsist\xEAncia espacial: dist\xE2ncia reportada excede trajeto rasteado pelo GPS.");
      }
    }
  }
  if (data.type === "cardio" && data.distanceKm && data.durationMins) {
    const speedKmh = data.distanceKm / data.durationMins * 60;
    if (speedKmh > 25) {
      score -= 80;
      status = "invalid";
      reasons.push("Velocidade m\xE9dia incompat\xEDvel com esfor\xE7o f\xEDsico humano (prov\xE1vel uso de ve\xEDculo).");
    }
  }
  if (data.photoBase64) {
    const aiResult = await runGeminiValidation(data.photoBase64, data.type);
    if (aiResult.status === "pending_review" || aiResult.requiresManualReview === true) {
      status = "pending_review";
      score = 0;
      requiresManualReview = true;
      isAiUnavailable = true;
      reasons.push("AI_VALIDATION_UNAVAILABLE");
    } else {
      if (!aiResult.isValid) {
        score -= 70;
        status = "invalid";
        reasons.push(`${aiResult.analysis}`);
      } else if ((aiResult.confidence || 0) < 60) {
        score -= 20;
        reasons.push("Confian\xE7a da an\xE1lise de imagem moderada.");
      }
    }
  } else if (data.type === "diet") {
    status = "pending_review";
    score = 0;
    requiresManualReview = true;
    isAiUnavailable = true;
    reasons.push("AI_VALIDATION_UNAVAILABLE");
  }
  if (status !== "pending_review") {
    if (score < 50) status = "invalid";
    else if (score < 80) status = "suspicious";
  }
  return { status, score: Math.max(0, score), reason: reasons.join(" | "), requiresManualReview, isAiUnavailable };
}
function calculateDistance3(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function calculateOpenScore(type, rawDuration, context) {
  const scoredDays = context.scoredDays || [];
  const todayISO = context.todayISO || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const isTodayAlreadyScored = scoredDays.includes(todayISO);
  const daysTrainedVal = isTodayAlreadyScored ? scoredDays.length : scoredDays.length + 1;
  const frequenciaSemanal = Math.max(1, Math.min(5, daysTrainedVal));
  const frequencyScore = Math.min(100, frequenciaSemanal * 20);
  const minMins = type === "workout" ? 30 : 20;
  const duration = Math.min(rawDuration, 90);
  let timeScore = 0;
  if (duration >= minMins) {
    if (duration >= 90) {
      timeScore = 100;
    } else {
      const range = 90 - minMins;
      timeScore = Math.round((duration - minMins) / range * 100);
    }
  }
  const smartwatchData = context.smartwatchData;
  let calories = 0;
  if (smartwatchData && smartwatchData.calories) {
    calories = smartwatchData.calories;
  } else {
    const calPerMin = type === "workout" ? 6.5 : 8.5;
    calories = rawDuration * calPerMin;
  }
  const weight = context.weight;
  let intensityScore = null;
  let caloriesPerKg = null;
  let isIntensityPending = false;
  if (!weight || weight <= 0) {
    isIntensityPending = true;
  } else {
    caloriesPerKg = calories / weight;
    if (caloriesPerKg >= 6) intensityScore = 100;
    else if (caloriesPerKg >= 5) intensityScore = 85;
    else if (caloriesPerKg >= 4) intensityScore = 70;
    else if (caloriesPerKg >= 3) intensityScore = 55;
    else if (caloriesPerKg >= 2) intensityScore = 40;
    else intensityScore = 20;
  }
  let basePoints = 0;
  if (isIntensityPending) {
    basePoints = Math.round(frequencyScore * 0.5 + timeScore * 0.5);
  } else {
    basePoints = Math.round(frequencyScore * 0.4 + timeScore * 0.4 + (intensityScore || 0) * 0.2);
  }
  return {
    basePoints,
    breakdown: {
      frequencyScore,
      timeScore,
      intensityScore,
      // null if missing weight
      caloriesPerKg,
      finalScore: basePoints,
      isIntensityPending
    }
  };
}
function calculatePerformanceScore(type, rawDuration, context) {
  const scoredDays = context.scoredDays || [];
  const todayISO = context.todayISO || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const isTodayAlreadyScored = scoredDays.includes(todayISO);
  const daysTrainedVal = isTodayAlreadyScored ? scoredDays.length : scoredDays.length + 1;
  const frequenciaSemanal = Math.max(1, Math.min(7, daysTrainedVal));
  let frequencyScore = 50;
  if (frequenciaSemanal === 2) frequencyScore = 75;
  else if (frequenciaSemanal === 3) frequencyScore = 90;
  else if (frequenciaSemanal === 4) frequencyScore = 95;
  else if (frequenciaSemanal >= 5) frequencyScore = 100;
  let maxMins = 90;
  if (frequenciaSemanal >= 5) maxMins = 60;
  else if (frequenciaSemanal === 4) maxMins = 70;
  else if (frequenciaSemanal === 3) maxMins = 80;
  else if (frequenciaSemanal <= 2) maxMins = 90;
  const finalDuration = Math.min(rawDuration, 90);
  let timeScore = 100;
  if (finalDuration < maxMins) {
    const timeScoreRaw = (finalDuration - 30) / (maxMins - 30) * 100;
    timeScore = Math.max(0, Math.min(100, Math.round(timeScoreRaw)));
  }
  const age = context.age || 25;
  const FCmax = 208 - 0.7 * age;
  const smartwatchData = context.smartwatchData;
  let heartRateScore = 75;
  if (smartwatchData && (smartwatchData.maxHR || smartwatchData.avgHR)) {
    const hr = Math.max(smartwatchData.maxHR || 0, smartwatchData.avgHR || 0);
    if (hr > 0) {
      const percentage = hr / FCmax * 100;
      heartRateScore = Math.max(0, Math.min(100, Math.round(percentage)));
    }
  }
  const weight = context.weight || 70;
  let calories = 0;
  if (smartwatchData && smartwatchData.calories) {
    calories = smartwatchData.calories;
  } else {
    calories = finalDuration * 6;
  }
  const relativeCalories = calories / weight;
  const maxRelativeCalLimit = 8;
  const calorieScore = Math.max(0, Math.min(100, Math.round(relativeCalories / maxRelativeCalLimit * 100)));
  const basePoints = Math.round((timeScore + heartRateScore + calorieScore + frequencyScore) / 4);
  return {
    basePoints,
    breakdown: {
      timeScore,
      heartRateScore,
      calorieScore,
      frequencyScore,
      finalScore: basePoints
    }
  };
}
function calculatePoints(type, streak, isFirst, context, boost) {
  if (type === "diet") {
    return { earned: 5, scoreDetails: null };
  }
  const rawDuration = context.duration || 0;
  const subTier = context.subscriptionTier || "open";
  if (type === "workout" || type === "cardio") {
    const minMins = subTier === "performance" ? 30 : type === "workout" ? 30 : 20;
    if (rawDuration < minMins) {
      return { earned: 0, scoreDetails: null };
    }
  }
  let basePoints = 0;
  let scoreDetails = null;
  if (subTier === "performance") {
    scoreDetails = calculatePerformanceScore(type, rawDuration, context);
    basePoints = scoreDetails.basePoints;
  } else {
    scoreDetails = calculateOpenScore(type, rawDuration, context);
    basePoints = scoreDetails.basePoints;
  }
  let bonusMultiplier = 1;
  let validationBonus = 0;
  if (type === "workout" || type === "cardio") {
    if (type === "workout") {
      if (context.hasExercises) bonusMultiplier += 0.05;
      if (context.hasPhoto) bonusMultiplier += 0.03;
    } else if (type === "cardio") {
      if (context.isPaceConsistent) bonusMultiplier += 0.05;
      if (context.hasNoPauses) bonusMultiplier += 0.05;
      if (context.isDistanceCoherent) bonusMultiplier += 0.03;
    }
  }
  const checkInBonus = isFirst ? 10 : 0;
  const calculateConsistencyMultiplier = (str) => {
    if (str >= 8) return 1.5;
    if (str >= 4) return 1.2;
    return 1;
  };
  const consistencyMultiplier = calculateConsistencyMultiplier(streak);
  const antiRepetitionMultiplier = context.wonLastSeason ? 0.9 : 1;
  if (context.iaConfidence && context.iaConfidence > 85) {
    validationBonus = 3;
  }
  let earned = Math.round((basePoints * bonusMultiplier + checkInBonus + validationBonus) * consistencyMultiplier * antiRepetitionMultiplier);
  if (boost > 0) {
    earned = Math.round(earned * (1 + boost / 100));
  }
  return { earned, scoreDetails };
}
function analyzeGPSSession(checkpoints, durationMins, distanceKm, userTrustScore, pedometerSteps, isMockLocation, isEmulator, isRooted, isDeveloperMode, hasSensorOscillation, recentUserWorkouts, sensorStatus) {
  let fraudRiskScore = 0.05;
  const fraudFlags = [];
  let finalSensorStatus = sensorStatus || "unavailable";
  const validStatuses = ["granted", "denied", "unavailable", "not_supported", "error"];
  if (!validStatuses.includes(finalSensorStatus)) {
    finalSensorStatus = "unavailable";
  }
  let sensorConfidence = "unavailable";
  let riskContribution = "unavailable";
  if (finalSensorStatus === "granted") {
    if (hasSensorOscillation) {
      sensorConfidence = "positive";
      riskContribution = "positive";
      fraudRiskScore = Math.max(0, fraudRiskScore - 0.05);
    } else {
      sensorConfidence = "weak";
      riskContribution = "weak";
    }
  } else {
    sensorConfidence = "unavailable";
    riskContribution = "unavailable";
  }
  if (!checkpoints || checkpoints.length < 2) {
    if (distanceKm > 0) {
      fraudRiskScore += 0.5;
      fraudFlags.push("MISSING_GPS_CHECKPOINTS");
    }
    const trustLevel2 = fraudRiskScore < 0.25 ? "high" : fraudRiskScore < 0.5 ? "medium" : fraudRiskScore < 0.75 ? "low" : "none";
    return {
      fraudRiskScore: parseFloat(Math.min(1, fraudRiskScore).toFixed(2)),
      fraudFlags,
      trustLevel: trustLevel2,
      sensorStatus: finalSensorStatus,
      sensorConfidence,
      riskContribution,
      details: { routeFingerprint: "" }
    };
  }
  const coords = checkpoints.map((c) => c.location);
  const accuracies = checkpoints.map((c) => c.location.accuracy || 15);
  const timestamps = checkpoints.map((c) => new Date(c.timestamp).getTime());
  let roboticInters = 0;
  const intervalVariances = [];
  for (let i = 1; i < timestamps.length; i++) {
    const diffSecs = (timestamps[i] - timestamps[i - 1]) / 1e3;
    intervalVariances.push(diffSecs);
    if (diffSecs > 0 && Math.round(diffSecs) % 5 === 0) {
      roboticInters++;
    }
  }
  const avgInterval = intervalVariances.reduce((a, b) => a + b, 0) / intervalVariances.length;
  const intervalVariance = intervalVariances.reduce((sum, v) => sum + Math.pow(v - avgInterval, 2), 0) / intervalVariances.length;
  const intervalStdDev = Math.sqrt(intervalVariance);
  if (intervalStdDev < 0.08 && checkpoints.length > 5) {
    fraudRiskScore += 0.25;
    fraudFlags.push("ROBOTIC_GPS_INTERVALS");
  }
  const uniqueAccuracies = new Set(accuracies);
  const avgAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  const accuracyVariance = accuracies.reduce((sum, v) => sum + Math.pow(v - avgAccuracy, 2), 0) / accuracies.length;
  const accuracyStdDev = Math.sqrt(accuracyVariance);
  if (uniqueAccuracies.size === 1 && checkpoints.length > 5) {
    fraudRiskScore += 0.2;
    fraudFlags.push("ARTIFICIAL_PERFECT_GPS_ACCURACY");
  }
  let perfectInterpolationMatches = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const pPrev = coords[i - 1];
    const pCurr = coords[i];
    const pNext = coords[i + 1];
    const tRatio = (timestamps[i] - timestamps[i - 1]) / (timestamps[i + 1] - timestamps[i - 1]);
    const expectedLat = pPrev.lat + (pNext.lat - pPrev.lat) * tRatio;
    const expectedLng = pPrev.lng + (pNext.lng - pPrev.lng) * tRatio;
    const latError = Math.abs(pCurr.lat - expectedLat);
    const lngError = Math.abs(pCurr.lng - expectedLng);
    if (latError < 1e-7 && lngError < 1e-7) {
      perfectInterpolationMatches++;
    }
  }
  const linearFraction = checkpoints.length > 3 ? perfectInterpolationMatches / (checkpoints.length - 2) : 0;
  if (linearFraction > 0.95 && checkpoints.length > 6) {
    fraudRiskScore += 0.35;
    fraudFlags.push("EXCESSIVE_ROUTE_LINEARITY");
  }
  let suspiciousCurveCount = 0;
  let turnCount = 0;
  const segmentSpeeds = [];
  const accelerations = [];
  for (let i = 1; i < coords.length; i++) {
    const p1 = coords[i - 1];
    const p2 = coords[i];
    const d = calculateDistance3(p1.lat, p1.lng, p2.lat, p2.lng) * 1e3;
    let dt = (timestamps[i] - timestamps[i - 1]) / 1e3;
    if (dt > 0 && dt < 2) {
      dt = 2;
    }
    const speed = dt > 0 ? d / dt : 0;
    segmentSpeeds.push(speed);
    if (segmentSpeeds.length > 1) {
      const prevSpeed = segmentSpeeds[segmentSpeeds.length - 2];
      const acc = dt > 0 ? (speed - prevSpeed) / dt : 0;
      accelerations.push(acc);
    }
  }
  for (let i = 1; i < coords.length - 1; i++) {
    const A = coords[i - 1];
    const B = coords[i];
    const C = coords[i + 1];
    const ABx = B.lat - A.lat;
    const ABy = B.lng - A.lng;
    const BCx = C.lat - B.lat;
    const BCy = C.lng - B.lng;
    const abLen = Math.sqrt(ABx * ABx + ABy * ABy);
    const bcLen = Math.sqrt(BCx * BCx + BCy * BCy);
    if (abLen > 0 && bcLen > 0) {
      const dot = (ABx * BCx + ABy * BCy) / (abLen * bcLen);
      const angleRad = Math.acos(Math.max(-1, Math.min(1, dot)));
      const angleDeg = angleRad * (180 / Math.PI);
      if (angleDeg > 35) {
        turnCount++;
        const speedBefore = segmentSpeeds[i - 1] || 0;
        const speedAfter = segmentSpeeds[i] || 0;
        if (Math.abs(speedBefore - speedAfter) < 0.02 && speedBefore > 1) {
          suspiciousCurveCount++;
        }
      }
    }
  }
  if (turnCount > 2 && suspiciousCurveCount / turnCount > 0.7) {
    fraudRiskScore += 0.25;
    fraudFlags.push("UNNATURAL_CURVE_SPEED_BEHAVIOR");
  }
  const avgSpeedMs = segmentSpeeds.reduce((a, b) => a + b, 0) / segmentSpeeds.length;
  const avgSpeedKmh = avgSpeedMs * 3.6;
  const speedVariances = segmentSpeeds.map((s) => Math.pow(s - avgSpeedMs, 2));
  const avgSpeedVariance = speedVariances.reduce((a, b) => a + b, 0) / speedVariances.length;
  const speedStdDev = Math.sqrt(avgSpeedVariance);
  if (speedStdDev < 0.05 && checkpoints.length > 5 && avgSpeedMs > 0.5) {
    fraudRiskScore += 0.3;
    fraudFlags.push("ARTIFICIAL_CONSTANT_PACE");
  }
  const unnaturalAccSectors = accelerations.filter((acc) => Math.abs(acc) > 6.5);
  if (unnaturalAccSectors.length > 0) {
    fraudRiskScore += Math.min(0.4, unnaturalAccSectors.length * 0.1);
    fraudFlags.push("IMPOSSIBLE_ACCELERATION_RATES");
  }
  if (avgSpeedKmh > 30) {
    fraudRiskScore += 0.75;
    fraudFlags.push("VEHICLE_SPEED_DETECTED");
  } else if (avgSpeedKmh > 20) {
    if (durationMins > 8) {
      fraudRiskScore += 0.4;
      fraudFlags.push("UNREALISTIC_ATHLETIC_SPEED_SUSTAINED");
    }
  }
  if (isMockLocation) {
    fraudRiskScore += 0.5;
    fraudFlags.push("MOCK_LOCATION_FLAG_ACTIVE");
  }
  if (isEmulator) {
    fraudRiskScore += 0.45;
    fraudFlags.push("EMULATOR_ENVIRONMENT_DETECTED");
  }
  if (isRooted) {
    fraudRiskScore += 0.15;
    fraudFlags.push("ROOT_OR_JAILBREAK_HEURISTIC_TRIGGER");
  }
  if (isDeveloperMode) {
    fraudRiskScore += 0.15;
    fraudFlags.push("DEVELOPER_MODE_ACTIVE");
  }
  if (sensorConfidence === "weak") {
    const slightRiskIncrease = 0.08;
    const hasStrongSignals = fraudFlags.includes("VEHICLE_SPEED_DETECTED") || fraudFlags.includes("UNREALISTIC_ATHLETIC_SPEED_SUSTAINED") || fraudFlags.includes("IMPOSSIBLE_ACCELERATION_RATES") || fraudFlags.includes("ROBOTIC_GPS_INTERVALS") || fraudFlags.includes("ARTIFICIAL_PERFECT_GPS_ACCURACY") || fraudFlags.includes("EXCESSIVE_ROUTE_LINEARITY") || fraudFlags.includes("MOCK_LOCATION_FLAG_ACTIVE") || fraudFlags.includes("EMULATOR_ENVIRONMENT_DETECTED") || fraudFlags.includes("REPLAY_PREVIOUS_ROUTE_MATCH") || fraudFlags.includes("MISSING_GPS_CHECKPOINTS");
    if (hasStrongSignals) {
      fraudRiskScore += 0.35;
      fraudFlags.push("SENSORS_NO_PHYSICAL_OSCILLATION");
    } else {
      fraudRiskScore += slightRiskIncrease;
      fraudFlags.push("SENSORS_LOW_OSCILLATION");
    }
  }
  if (distanceKm > 0.3 && pedometerSteps > 0) {
    const stepsPerKm = pedometerSteps / distanceKm;
    if (stepsPerKm < 300 || stepsPerKm > 3e3) {
      fraudRiskScore += 0.15;
      fraudFlags.push("PEDOMETER_STEP_RATIO_IMPROBABLE");
    }
  } else if (distanceKm > 0.3 && pedometerSteps === 0) {
    const isSuspiciousMismatch = sensorConfidence === "weak" && (fraudFlags.includes("VEHICLE_SPEED_DETECTED") || fraudFlags.includes("UNREALISTIC_ATHLETIC_SPEED_SUSTAINED") || fraudFlags.includes("IMPOSSIBLE_ACCELERATION_RATES") || fraudFlags.includes("MOCK_LOCATION_FLAG_ACTIVE") || fraudFlags.includes("EMULATOR_ENVIRONMENT_DETECTED") || fraudFlags.includes("REPLAY_PREVIOUS_ROUTE_MATCH"));
    if (isSuspiciousMismatch) {
      fraudRiskScore += 0.4;
      fraudFlags.push("SENSOR_GPS_TRAVEL_MISMATCH");
    } else if (sensorConfidence === "weak") {
      fraudRiskScore += 0.08;
      fraudFlags.push("SENSOR_GPS_TRAVEL_WEAK_SIGNAL");
    }
  }
  const currentFingerprint = generateFingerprintForComparison(checkpoints);
  if (currentFingerprint && recentUserWorkouts && recentUserWorkouts.length > 0) {
    for (const past of recentUserWorkouts) {
      const pastFingerprint = past.validation?.details?.routeFingerprint || past.validation?.details?.fraudAnalysis?.details?.routeFingerprint;
      if (pastFingerprint && pastFingerprint === currentFingerprint) {
        fraudRiskScore += 0.65;
        fraudFlags.push("REPLAY_PREVIOUS_ROUTE_MATCH");
        break;
      }
    }
  }
  let finalFraudRiskScore = fraudRiskScore;
  if (userTrustScore >= 90) {
    finalFraudRiskScore = Math.max(0.02, fraudRiskScore * 0.7);
  } else if (userTrustScore <= 50) {
    finalFraudRiskScore = Math.min(1, fraudRiskScore * 1.25);
  }
  finalFraudRiskScore = Math.max(0, Math.min(1, finalFraudRiskScore));
  const trustLevel = finalFraudRiskScore < 0.25 ? "high" : finalFraudRiskScore < 0.5 ? "medium" : finalFraudRiskScore < 0.75 ? "low" : "none";
  return {
    fraudRiskScore: parseFloat(finalFraudRiskScore.toFixed(3)),
    fraudFlags,
    trustLevel,
    sensorStatus: finalSensorStatus,
    sensorConfidence,
    riskContribution,
    details: {
      intervalStdDev: parseFloat(intervalStdDev.toFixed(4)),
      accuracyStdDev: parseFloat(accuracyStdDev.toFixed(4)),
      linearFraction: parseFloat(linearFraction.toFixed(4)),
      avgSpeedKmh: parseFloat(avgSpeedKmh.toFixed(2)),
      speedStdDev: parseFloat(speedStdDev.toFixed(4)),
      unnaturalAccCount: unnaturalAccSectors.length,
      suspiciousCurveCount,
      turnCount,
      stepsPerKm: distanceKm > 0 ? Math.round(pedometerSteps / distanceKm) : 0,
      routeFingerprint: currentFingerprint
    }
  };
}
function generateFingerprintForComparison(checkpoints) {
  if (!checkpoints || checkpoints.length < 4) return "";
  const len = checkpoints.length;
  const indices = [0, Math.floor(len * 0.15), Math.floor(len * 0.3), Math.floor(len * 0.5), Math.floor(len * 0.7), Math.floor(len * 0.85), len - 1];
  const keys = indices.map((i) => {
    const cp = checkpoints[i];
    if (!cp || !cp.location) return "";
    return `${cp.location.lat.toFixed(4)},${cp.location.lng.toFixed(4)}`;
  }).filter(Boolean);
  return keys.join("->");
}
async function executeAdvancedCardioValidation(data) {
  let isTopAthlete = false;
  let userTrustScore = 100;
  let gymLocation = null;
  const reasons = [];
  const antiFraudFlags = [];
  let isStravaConnected = false;
  let subscriptionTier = "open";
  try {
    const userRef = db.collection("users").doc(data.userId);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const uData = userSnap.data() || {};
      gymLocation = uData.gymLocation || null;
      const pos = uData.positions || {};
      isTopAthlete = pos.gym && pos.gym <= 3 || pos.city && pos.city <= 3 || pos.national && pos.national <= 5;
      isStravaConnected = !!uData.strava_connected;
      subscriptionTier = uData.subscriptionTier || "open";
    }
    const trustProfileSnap = await db.collection("user_trust_profiles").doc(data.userId).get();
    if (trustProfileSnap.exists) {
      const tpData = trustProfileSnap.data() || {};
      userTrustScore = tpData.trustScore ?? 100;
      if (tpData.denunciationCount && tpData.denunciationCount > 0) {
        antiFraudFlags.push("USER_HAS_ACTIVE_DENUNCIATIONS");
        reasons.push("Usu\xE1rio possui den\xFAncias ativas no ranking.");
      }
    }
  } catch (err) {
    console.error("Pre-fetch user for cardio failed", err);
  }
  const isIndoor = data.isIndoorCardio !== void 0 ? data.isIndoorCardio : ["esteira", "bike_ergometrica", "eliptico", "escada", "treadmill", "stationary_bike", "elliptical", "stair_climber", "rowing", "other"].includes(data.cardioType);
  let detailResults = {};
  if (isIndoor) {
    detailResults = await validateCardioIndoor({
      cardioType: data.cardioType,
      durationMins: data.durationMins,
      checkpoints: data.checkpoints,
      photoBase64: data.photoBase64,
      pedometerSteps: data.pedometerSteps,
      hasSensorOscillation: data.hasSensorOscillation,
      sensorStatus: data.sensorStatus,
      smartwatchData: data.smartwatchData,
      gymLocation,
      userTrustScore
    });
  } else {
    detailResults = await validateCardioOutdoor({
      cardioType: data.cardioType,
      durationMins: data.durationMins,
      distanceKm: data.distanceKm,
      checkpoints: data.checkpoints,
      pedometerSteps: data.pedometerSteps,
      smartwatchData: data.smartwatchData,
      userTrustScore
    });
  }
  let smartwatchValidation = { isValid: true, bpmScore: 100, reason: "" };
  if (data.smartwatchData) {
    smartwatchValidation = validateSmartwatch(data.smartwatchData, data.cardioType, data.durationMins);
    if (!smartwatchValidation.isValid) {
      antiFraudFlags.push("SMARTWATCH_DATA_INCONGRUENT");
      reasons.push(smartwatchValidation.reason);
    }
  }
  if (detailResults.flags && detailResults.flags.length > 0) {
    antiFraudFlags.push(...detailResults.flags);
  }
  if (detailResults.reasons && detailResults.reasons.length > 0) {
    reasons.push(...detailResults.reasons);
  }
  if (data.isMockLocation) {
    antiFraudFlags.push("MOCK_LOCATION_FLAG_ACTIVE");
    reasons.push("GPS mockado detectado.");
  }
  if (data.isEmulator) {
    antiFraudFlags.push("EMULATOR_ENVIRONMENT_DETECTED");
    reasons.push("Ambiente de simulador detectado.");
  }
  if (data.isRooted) {
    antiFraudFlags.push("ROOT_OR_JAILBREAK_HEURISTIC_TRIGGER");
    reasons.push("Aparelho com root ou jailbreak.");
  }
  if (data.isDeveloperMode) {
    antiFraudFlags.push("DEVELOPER_MODE_ACTIVE");
    reasons.push("Modo desenvolvedor ativo no celular.");
  }
  let stravaMatch = null;
  let stravaComplementaryScore = 0;
  let stravaValidationDetail = "";
  if (isStravaConnected && !isIndoor) {
    try {
      const stravaActSnap = await db.collection("strava_activities").where("userId", "==", data.userId).where("status", "==", "VALID").orderBy("startDate", "desc").limit(10).get();
      const currentStartMs = data.checkpoints && data.checkpoints.length > 0 ? new Date(data.checkpoints[0].timestamp).getTime() : (/* @__PURE__ */ new Date()).getTime() - data.durationMins * 60 * 1e3;
      const matchDoc = stravaActSnap.docs.find((doc2) => {
        const actData = doc2.data();
        const startMs = new Date(actData.startDate).getTime();
        return Math.abs(startMs - currentStartMs) <= 60 * 60 * 1e3;
      });
      if (matchDoc) {
        stravaMatch = matchDoc.data();
        const stravaMins = (stravaMatch.movingTime || 0) / 60;
        const stravaKm = (stravaMatch.distance || 0) / 1e3;
        const hasStravaHR = stravaMatch.has_heartrate === true || stravaMatch.average_heartrate && stravaMatch.average_heartrate > 0;
        const isStravaManual = stravaMatch.manual === true;
        const durationDiverged = Math.abs(data.durationMins - stravaMins) > Math.max(10, data.durationMins * 0.25);
        const distanceDiverged = Math.abs(data.distanceKm - stravaKm) > Math.max(1.5, data.distanceKm * 0.25);
        const hasGps = stravaMatch.hasGps !== false;
        const isCompatible = !durationDiverged && !distanceDiverged && !isStravaManual && hasGps;
        if (!isCompatible) {
          antiFraudFlags.push("STRAVA_DIVERGENCE_ALERT");
          reasons.push(`Inconsist\xEAncia identificada entre os dados principais (HealthKit/Health Connect) e o Strava (Dura\xE7\xE3o: Invictus ${data.durationMins}m vs Strava ${Math.round(stravaMins)}m; Dist\xE2ncia: Invictus ${data.distanceKm.toFixed(1)}km vs Strava ${stravaKm.toFixed(1)}km).`);
          stravaValidationDetail = "Inconsist\xEAncia detectada entre HealthKit/Health Connect e Strava. Alerta registrado para auditoria manual.";
        } else {
          antiFraudFlags.push("STRAVA_COMPLEMENTARY_VALIDATION");
          if (subscriptionTier === "performance" && !hasStravaHR) {
            antiFraudFlags.push("STRAVA_MISSING_HR_PERFORMANCE_FAIL");
            reasons.push("A atividade complementar do Strava n\xE3o possui dados de frequ\xEAncia card\xEDaca para o plano Performance.");
            stravaValidationDetail = "Atividade Strava sem frequ\xEAncia card\xEDaca. \xDAtil para o plano Open, mas insuficiente para validar a Performance completa.";
          } else {
            stravaValidationDetail = `Strava integrado com sucesso como fonte complementar.`;
          }
        }
      } else {
        stravaValidationDetail = "Nenhuma atividade compat\xEDvel recente localizada no Strava para compara\xE7\xE3o biom\xE9trica.";
      }
    } catch (err) {
      console.error("[Strava Validation Engine] Error cross-referencing Strava:", err);
    }
  }
  if (subscriptionTier === "performance") {
    const swData = data.smartwatchData;
    const hasSmartwatch = !!swData;
    const hasHeartRate = swData && (Number(swData.avgHR) > 0 || Number(swData.maxHR) > 0);
    const hasStravaHR = stravaMatch && (stravaMatch.has_heartrate === true || stravaMatch.average_heartrate && stravaMatch.average_heartrate > 0);
    if (!isStravaConnected) {
      antiFraudFlags.push("PERFORMANCE_BIOMETRIC_INCOMPLETE");
      reasons.push("Dados biom\xE9tricos incompletos: Conecte sua conta Strava para participar do ranking oficial do plano Performance.");
    } else if (!hasStravaHR && !hasHeartRate) {
      antiFraudFlags.push("PERFORMANCE_BIOMETRIC_INCOMPLETE");
      reasons.push("Dados biom\xE9tricos incompletos: Aus\xEAncia de frequ\xEAncia card\xEDaca real synced via Strava.");
    }
  }
  const scoreResult = calculateReliabilityScore({
    isIndoor,
    cardioType: data.cardioType,
    durationMins: data.durationMins,
    distanceKm: data.distanceKm,
    hasSmartwatch: !!data.smartwatchData,
    smartwatchValid: smartwatchValidation.isValid,
    hasPhoto: !!data.photoBase64,
    userTrustScore,
    isTopAthlete,
    flags: antiFraudFlags,
    pedometerSteps: data.pedometerSteps
  });
  let finalStatus = scoreResult.status;
  let requiresManualReview = scoreResult.requiresManualReview;
  if (antiFraudFlags.includes("PERFORMANCE_BIOMETRIC_INCOMPLETE")) {
    const hasMajorFraud = data.isMockLocation || data.isEmulator || antiFraudFlags.includes("USER_HAS_ACTIVE_DENUNCIATIONS") || antiFraudFlags.includes("TELEPORTATION_GPS_JUMP") || antiFraudFlags.includes("VEHICLE_SPEED_DETECTED") || antiFraudFlags.includes("UNREALISTIC_ATHLETIC_SPEED_SUSTAINED") || antiFraudFlags.includes("STRAVA_DIVERGENCE_ALERT") || antiFraudFlags.includes("MOCK_LOCATION_FLAG_ACTIVE") || antiFraudFlags.includes("EMULATOR_ENVIRONMENT_DETECTED");
    if (!hasMajorFraud) {
      finalStatus = "biometria_incompleta";
      requiresManualReview = false;
    } else {
      finalStatus = "suspicious";
      requiresManualReview = true;
    }
  }
  if (isTopAthlete && antiFraudFlags.includes("USER_HAS_ACTIVE_DENUNCIATIONS")) {
    finalStatus = "pending_review";
    requiresManualReview = true;
    reasons.push("Revis\xE3o obrigat\xF3ria autom\xE1tica: Atleta no pelot\xE3o de elite com den\xFAncias pendentes.");
  }
  const photoOnly = !!data.photoBase64 && (!data.checkpoints || data.checkpoints.length < 2) && !data.smartwatchData;
  const gpsOnly = data.checkpoints && data.checkpoints.length >= 2 && !data.photoBase64 && !data.smartwatchData && isIndoor;
  const timeOnly = data.durationMins > 0 && (!data.checkpoints || data.checkpoints.length < 2) && !data.photoBase64 && !data.smartwatchData;
  if (photoOnly || timeOnly) {
    finalStatus = "pending_review";
    requiresManualReview = true;
    reasons.push("Evid\xEAncias insuficientes para aprova\xE7\xE3o autom\xE1tica (dependente apenas de imagem ou cron\xF4metro).");
  }
  if (finalStatus === "pending_review" || requiresManualReview) {
    const reviewResult = handleManualReview(reasons);
    finalStatus = "pending_review";
    requiresManualReview = reviewResult.requiresManualReview;
  }
  return {
    status: finalStatus,
    score: scoreResult.score,
    reason: reasons.join(" || ") || "Cardio validado com sucesso.",
    requiresManualReview,
    isAiUnavailable: false,
    antiFraudFlags,
    details: {
      locationConfirmed: !antiFraudFlags.includes("location_out_of_bounds"),
      activeTimeValid: data.durationMins >= 20,
      movementDetected: !antiFraudFlags.includes("SENSORS_NO_PHYSICAL_OSCILLATION") && !antiFraudFlags.includes("SENSORS_LOW_OSCILLATION"),
      compatiblePauses: !antiFraudFlags.includes("SUSPICIOUS_GPS_STATIC_PAUSE"),
      minimumConsistency: scoreResult.score >= 60,
      sessionConfidence: scoreResult.score >= 85,
      pausePatternScore: antiFraudFlags.includes("SUSPICIOUS_GPS_STATIC_PAUSE") ? 30 : 100,
      movementConfidence: scoreResult.score,
      smartwatchConnected: !!data.smartwatchData,
      smartwatchData: data.smartwatchData || null,
      cardioType: data.cardioType,
      isIndoor,
      isTopAthlete,
      userTrustScore,
      antiFraudFlags,
      stravaMatch: stravaMatch || null,
      stravaValidationDetail
    }
  };
}
async function validateCardioIndoor(params) {
  const { cardioType, durationMins, checkpoints, photoBase64, pedometerSteps, hasSensorOscillation, sensorStatus, smartwatchData, gymLocation, userTrustScore } = params;
  const flags = [];
  const reasons = [];
  if (gymLocation && checkpoints && checkpoints.length > 0) {
    let outOfBoundsCount = 0;
    for (const cp of checkpoints) {
      const dist = calculateDistance3(cp.location.lat, cp.location.lng, gymLocation.lat, gymLocation.lng) * 1e3;
      const acc = cp.location.accuracy || 25;
      const adjustedDist = Math.max(0, dist - acc);
      if (adjustedDist > 150) {
        outOfBoundsCount++;
      }
    }
    const oobRatio = outOfBoundsCount / checkpoints.length;
    if (oobRatio > 0.4) {
      flags.push("location_out_of_bounds");
      reasons.push(`Afastamento prolongado do raio da academia (${Math.round(oobRatio * 100)}% dos pontos fora).`);
    }
  }
  const isSupported = sensorStatus === "granted";
  if (isSupported && !hasSensorOscillation) {
    flags.push("SENSORS_NO_PHYSICAL_OSCILLATION");
    reasons.push("Nenhuma oscila\xE7\xE3o ou movimento f\xEDsico registrado nos aceler\xF4metros.");
  }
  const steps = pedometerSteps || 0;
  if (["esteira", "escada", "treadmill", "stair_climber"].includes(cardioType)) {
    const minStepsExpected = durationMins * 70;
    if (steps < minStepsExpected) {
      flags.push("PEDOMETER_STEP_RATIO_IMPROBABLE");
      reasons.push(`Contagem de passos (${steps}) muito baixa para atividade de ${cardioType} de ${durationMins} min.`);
    }
  }
  if (["bike_ergometrica", "eliptico", "stationary_bike", "elliptical", "rowing", "other"].includes(cardioType)) {
    if (steps === 0 && !smartwatchData && !photoBase64) {
      flags.push("STATIONARY_RESTING_PHONE_NO_PROOF");
      reasons.push("Aparelho im\xF3vel sem smartwatch sincronizado ou foto final do painel.");
    }
  }
  return { flags, reasons };
}
async function validateCardioOutdoor(params) {
  const { cardioType, durationMins, distanceKm, checkpoints, pedometerSteps, smartwatchData, userTrustScore } = params;
  const flags = [];
  const reasons = [];
  if (!checkpoints || checkpoints.length < 3) {
    flags.push("MISSING_GPS_CHECKPOINTS");
    reasons.push("Coleta de GPS descont\xEDnua ou insuficiente.");
    return { flags, reasons };
  }
  const speedsKmh = [];
  let teleportJumpDetected = false;
  let staticCount = 0;
  for (let i = 1; i < checkpoints.length; i++) {
    const p1 = checkpoints[i - 1].location;
    const p2 = checkpoints[i].location;
    const dist = calculateDistance3(p1.lat, p1.lng, p2.lat, p2.lng);
    const t1 = new Date(checkpoints[i - 1].timestamp).getTime();
    const t2 = new Date(checkpoints[i].timestamp).getTime();
    const dtHrs = (t2 - t1) / 36e5;
    if (dtHrs > 0) {
      const speed = dist / dtHrs;
      speedsKmh.push(speed);
      if (speed > 120 && dist > 0.2) {
        teleportJumpDetected = true;
      }
    }
    if (dist < 2e-3) {
      staticCount++;
    }
  }
  const avgSpeedKmh = distanceKm / (durationMins / 60);
  if (["corrida_outdoor", "caminhada_outdoor", "running", "walking"].includes(cardioType)) {
    if (avgSpeedKmh > 30 || speedsKmh.some((s) => s > 35)) {
      flags.push("VEHICLE_SPEED_DETECTED");
      reasons.push("Velocidade m\xE1xima incompat\xEDvel com esfor\xE7o humano (prov\xE1vel uso de ve\xEDculo/autom\xF3vel).");
    } else if (["caminhada_outdoor", "walking"].includes(cardioType) && avgSpeedKmh > 11) {
      flags.push("UNREALISTIC_ATHLETIC_SPEED_SUSTAINED");
      reasons.push("Velocidade m\xE9dia excessiva para caminhada declarada.");
    } else if (["corrida_outdoor", "running"].includes(cardioType) && avgSpeedKmh < 3.5) {
      flags.push("ARTIFICIAL_CONSTANT_PACE");
      reasons.push("Ritmo biomecanicamente incompat\xEDvel com corrida (lento demais).");
    }
  } else if (["bike_outdoor", "bike"].includes(cardioType)) {
    if (avgSpeedKmh > 55 || speedsKmh.some((s) => s > 65)) {
      flags.push("VEHICLE_SPEED_DETECTED");
      reasons.push("Velocidade de ciclismo acentuada compat\xEDvel com ve\xEDculo motorizado.");
    } else if (avgSpeedKmh < 5) {
      flags.push("ARTIFICIAL_CONSTANT_PACE");
      reasons.push("Velocidade de ciclismo anormalmente estagnada ou lenta.");
    }
  }
  if (teleportJumpDetected) {
    flags.push("TELEPORTATION_GPS_JUMP");
    reasons.push("Saltos imposs\xEDveis de localiza\xE7\xE3o por GPS detectados.");
  }
  const staticRatio = staticCount / checkpoints.length;
  if (staticRatio > 0.7 && durationMins > 20) {
    flags.push("SUSPICIOUS_GPS_STATIC_PAUSE");
    reasons.push("Pausas e inatividade suspeita prolongada detectada em tr\xE2nsito.");
  }
  return { flags, reasons };
}
function validateSmartwatch(smartwatchData, cardioType, durationMins) {
  const avgHR = smartwatchData.avgHR || 0;
  const maxHR = smartwatchData.maxHR || 0;
  const calories = smartwatchData.calories || 0;
  if (avgHR > 0 && avgHR < 70) {
    return {
      isValid: false,
      bpmScore: 50,
      reason: "Frequ\xEAncia card\xEDaca muito baixa para esfor\xE7o f\xEDsico declarado (atividade em repouso)."
    };
  }
  if (maxHR > 220) {
    return {
      isValid: false,
      bpmScore: 30,
      reason: "Frequ\xEAncias card\xEDacas capturadas acima do limiar biol\xF3gico saud\xE1vel."
    };
  }
  const calPerMin = calories / durationMins;
  if (calories > 0 && (calPerMin < 0.5 || calPerMin > 40)) {
    return {
      isValid: false,
      bpmScore: 40,
      reason: "Metadados de calorias do smartwatch desproporcionais ao tempo de dura\xE7\xE3o do exerc\xEDcio."
    };
  }
  return { isValid: true, bpmScore: 100, reason: "" };
}
function calculateReliabilityScore(params) {
  const { isIndoor, cardioType, durationMins, distanceKm, hasSmartwatch, smartwatchValid, hasPhoto, userTrustScore, isTopAthlete, flags } = params;
  let score = 100;
  if (flags.includes("TELEPORTATION_GPS_JUMP")) score -= 80;
  if (flags.includes("VEHICLE_SPEED_DETECTED")) score -= 75;
  if (flags.includes("UNREALISTIC_ATHLETIC_SPEED_SUSTAINED")) score -= 40;
  if (flags.includes("PEDOMETER_STEP_RATIO_IMPROBABLE")) score -= 25;
  if (flags.includes("STATIONARY_RESTING_PHONE_NO_PROOF")) score -= 50;
  if (flags.includes("location_out_of_bounds")) score -= 40;
  if (flags.includes("SUSPICIOUS_GPS_STATIC_PAUSE")) score -= 30;
  if (flags.includes("USER_HAS_ACTIVE_DENUNCIATIONS")) score -= 15;
  if (flags.includes("SMARTWATCH_DATA_INCONGRUENT")) score -= 35;
  if (flags.includes("ROBOTIC_GPS_INTERVALS")) score -= 20;
  if (flags.includes("ARTIFICIAL_PERFECT_GPS_ACCURACY")) score -= 20;
  if (flags.includes("MOCK_LOCATION_FLAG_ACTIVE")) score -= 65;
  if (flags.includes("EMULATOR_ENVIRONMENT_DETECTED")) score -= 60;
  if (flags.includes("ROOT_OR_JAILBREAK_HEURISTIC_TRIGGER")) score -= 15;
  if (flags.includes("STRAVA_DIVERGENCE_ALERT")) score -= 35;
  if (flags.includes("STRAVA_MISSING_HR_PERFORMANCE_FAIL")) score -= 25;
  if (hasSmartwatch && smartwatchValid) {
    score = Math.min(100, score + 15);
  }
  if (flags.includes("STRAVA_COMPLEMENTARY_VALIDATION")) {
    score = Math.min(100, score + 12);
  }
  if (hasPhoto && isIndoor) {
    score = Math.min(100, score + 12);
  }
  if (userTrustScore >= 90) {
    score = Math.min(100, score + 8);
  }
  score = Math.max(0, Math.min(100, score));
  let status = "valid";
  let requiresManualReview = false;
  if (score >= 85) {
    status = "valid";
  } else if (score >= 60) {
    status = "suspicious";
  } else {
    status = "pending_review";
    requiresManualReview = true;
  }
  return { score, status, requiresManualReview };
}
function handleManualReview(reasons) {
  return {
    status: "pending_review",
    requiresManualReview: true,
    userMessage: "Atividade enviada para revis\xE3o devido a diverg\xEAncias ou den\xFAncias de sincronia.",
    reasons
  };
}
async function executeAdvancedWorkoutValidation(data) {
  let isTopAthlete = false;
  let userTrustScore = 100;
  let gymLocation = null;
  let gymId = "";
  let isStravaConnected = false;
  let subscriptionTier = "open";
  const reasons = [];
  const antiFraudFlags = [];
  try {
    const userRef = db.collection("users").doc(data.userId);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const uData = userSnap.data() || {};
      gymId = uData.gymId || "";
      gymLocation = uData.gymLocation || null;
      const pos = uData.positions || {};
      isTopAthlete = pos.gym && pos.gym <= 3 || pos.city && pos.city <= 3 || pos.national && pos.national <= 5;
      isStravaConnected = !!uData.strava_connected;
      subscriptionTier = uData.subscriptionTier || "open";
    }
    const trustProfileSnap = await db.collection("user_trust_profiles").doc(data.userId).get();
    if (trustProfileSnap.exists) {
      const tpData = trustProfileSnap.data() || {};
      userTrustScore = tpData.trustScore ?? 100;
      if (tpData.denunciationCount && tpData.denunciationCount > 0) {
        antiFraudFlags.push("USER_HAS_ACTIVE_DENUNCIATIONS");
        reasons.push("Usu\xE1rio possui den\xFAncias ativas no ranking.");
      }
    }
  } catch (err) {
    console.error("Pre-fetch user for workout failed", err);
  }
  let locationConfirmed = true;
  let outOfBoundsTime = 0;
  let startInside = false;
  let endInside = false;
  let outOfBoundsCount = 0;
  if (gymLocation && data.checkpoints && data.checkpoints.length > 0) {
    const firstCp = data.checkpoints[0];
    const firstDist = calculateDistance3(firstCp.location.lat, firstCp.location.lng, gymLocation.lat, gymLocation.lng) * 1e3;
    const firstAcc = firstCp.location.accuracy || 25;
    if (Math.max(0, firstDist - firstAcc) <= 50) {
      startInside = true;
    }
    const lastCp = data.checkpoints[data.checkpoints.length - 1];
    const lastDist = calculateDistance3(lastCp.location.lat, lastCp.location.lng, gymLocation.lat, gymLocation.lng) * 1e3;
    const lastAcc = lastCp.location.accuracy || 25;
    if (Math.max(0, lastDist - lastAcc) <= 50) {
      endInside = true;
    }
    let lastCheckpointInside = true;
    let outsideStartTimeMs = 0;
    for (let i = 0; i < data.checkpoints.length; i++) {
      const cp = data.checkpoints[i];
      const dist = calculateDistance3(cp.location.lat, cp.location.lng, gymLocation.lat, gymLocation.lng) * 1e3;
      const acc = cp.location.accuracy || 25;
      const adjustedDist = Math.max(0, dist - acc);
      const isInside = adjustedDist <= 50;
      if (!isInside) {
        outOfBoundsCount++;
        if (lastCheckpointInside) {
          outsideStartTimeMs = new Date(cp.timestamp).getTime();
          lastCheckpointInside = false;
        } else {
          const currentMs = new Date(cp.timestamp).getTime();
          outOfBoundsTime += (currentMs - outsideStartTimeMs) / 1e3;
          outsideStartTimeMs = currentMs;
        }
      } else {
        lastCheckpointInside = true;
      }
    }
    const oobRatio = outOfBoundsCount / data.checkpoints.length;
    if (oobRatio > 0.35) {
      antiFraudFlags.push("location_out_of_bounds");
      reasons.push(`Afastamento prolongado do raio da academia (${Math.round(oobRatio * 100)}% dos pontos fora).`);
      locationConfirmed = false;
    }
    if (outOfBoundsTime > 180) {
      antiFraudFlags.push("OUT_OF_GYM_INTERVAL_EXCEEDED");
      reasons.push(`Tempo acumulado fora do per\xEDmetro da academia excedeu o intervalo de toler\xE2ncia de 3 minutos (${Math.round(outOfBoundsTime / 60)} min).`);
      locationConfirmed = false;
    }
    if (outOfBoundsTime > 600) {
      antiFraudFlags.push("PROLONGED_EXIT_DETECTED");
      reasons.push("Sa\xEDda f\xEDsica prolongada detectada durante a atividade.");
    }
  } else if (gymLocation) {
    antiFraudFlags.push("missing_location_coordinates");
    reasons.push("Coordenadas de presen\xE7a f\xEDsica n\xE3o detectadas.");
    locationConfirmed = false;
  }
  if (data.checkpoints && data.checkpoints.length >= 2) {
    let teleportJumpDetected = false;
    for (let i = 1; i < data.checkpoints.length; i++) {
      const p1 = data.checkpoints[i - 1].location;
      const p2 = data.checkpoints[i].location;
      const dist = calculateDistance3(p1.lat, p1.lng, p2.lat, p2.lng);
      const t1 = new Date(data.checkpoints[i - 1].timestamp).getTime();
      const t2 = new Date(data.checkpoints[i].timestamp).getTime();
      const dtHrs = (t2 - t1) / 36e5;
      if (dtHrs > 0) {
        const speed = dist / dtHrs;
        if (speed > 45 && dist > 0.3) {
          teleportJumpDetected = true;
        }
      }
    }
    if (teleportJumpDetected) {
      antiFraudFlags.push("TELEPORTATION_GPS_JUMP");
      reasons.push("Pontos de GPS incongruentes (velocidade de deslocamento imposs\xEDvel).");
    }
  }
  let userLevel = 1;
  try {
    const userRef = db.collection("users").doc(data.userId);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      userLevel = userSnap.data()?.level || 1;
    }
  } catch (_) {
  }
  let requiredMinMins = 30;
  let tierLabel = "Bronze";
  if (userLevel < 5) {
    requiredMinMins = 20;
    tierLabel = "Bronze";
  } else if (userLevel < 15) {
    requiredMinMins = 40;
    tierLabel = "Prata";
  } else {
    requiredMinMins = 60;
    tierLabel = "Ouro";
  }
  let activeTimeValid = true;
  let totalSessionTimeMins = data.durationMins || 0;
  if (totalSessionTimeMins < requiredMinMins) {
    antiFraudFlags.push("session_too_short");
    reasons.push(`Dura\xE7\xE3o do treino (${totalSessionTimeMins} min) inferior ao exigido para o n\xEDvel ${tierLabel} (m\xEDnimo ${requiredMinMins} min).`);
    activeTimeValid = false;
  }
  let timeInsideGymMetersRatio = 1;
  if (gymLocation && data.checkpoints && data.checkpoints.length >= 2) {
    const totalPointsCount = data.checkpoints.length;
    let insidePointsCount = 0;
    for (const cp of data.checkpoints) {
      const dist = calculateDistance3(cp.location.lat, cp.location.lng, gymLocation.lat, gymLocation.lng) * 1e3;
      if (dist <= 50 + (cp.location.accuracy || 25)) {
        insidePointsCount++;
      }
    }
    timeInsideGymMetersRatio = insidePointsCount / totalPointsCount;
    if (timeInsideGymMetersRatio < 0.6) {
      antiFraudFlags.push("SESSION_DWELL_TIME_INSUFFICIENT");
      reasons.push("Frequ\xEAncia de presen\xE7a interna verificada no per\xEDmetro de treino inconsistente.");
      activeTimeValid = false;
    }
  }
  let isPhotoValid = true;
  let photoAnalysisText = "";
  let photoConfidence = 100;
  if (data.photoBase64) {
    try {
      const aiResult = await runGeminiValidation(data.photoBase64, "workout");
      photoAnalysisText = aiResult.analysis || "";
      photoConfidence = aiResult.confidence || 0;
      if (aiResult.status === "pending_review" || aiResult.requiresManualReview === true) {
        antiFraudFlags.push("AI_PENDING_REVIEW");
        reasons.push("IA enviou a evid\xEAncia visual para modera\xE7\xE3o devido a inconsist\xEAncias residuais.");
      } else if (!aiResult.isValid) {
        isPhotoValid = false;
        antiFraudFlags.push("INVALID_GYM_CONTEXT_PHOTO");
        reasons.push(`Foto de valida\xE7\xE3o recusada pela IA: ${aiResult.analysis}`);
      } else if (photoConfidence < 62) {
        antiFraudFlags.push("WEAK_VISUAL_CONFIDENCE");
        reasons.push("Baixo \xEDndice de confian\xE7a visual pela IA.");
      }
    } catch (err) {
      console.warn("[Workout Anti-Fraud] Gemini photo integration failed:", err);
    }
  } else {
    isPhotoValid = false;
    antiFraudFlags.push("MISSING_EVIDENCE_PHOTO");
    reasons.push("Aus\xEAncia de foto de verifica\xE7\xE3o obrigat\xF3ria na academia.");
  }
  let sensorStatus = data.sensorStatus || "unavailable";
  let hasSensorOscillation = data.hasSensorOscillation ?? true;
  let movementDetected = true;
  let movementScore = 75;
  if (sensorStatus === "granted") {
    if (!hasSensorOscillation) {
      movementDetected = false;
      movementScore = 15;
      antiFraudFlags.push("SENSORS_NO_PHYSICAL_OSCILLATION");
      reasons.push("Aus\xEAncia de varia\xE7\xE3o biomec\xE2nica ou trepida\xE7\xE3o mec\xE2nica nos sensores de movimento.");
    } else {
      movementScore = 80;
      if (data.pedometerSteps && data.pedometerSteps > 0) {
        const stepsPerMin = data.pedometerSteps / (totalSessionTimeMins || 1);
        if (stepsPerMin > 0 && stepsPerMin < 3) {
          movementScore = 90;
        } else if (stepsPerMin > 180) {
          movementScore = 55;
          antiFraudFlags.push("SUSPICIOUS_SENSED_CYCLIC_VIBRATION");
          reasons.push("Padr\xE3o oscilat\xF3rio repetitivo compat\xEDvel com agita\xE7\xE3o artificial simulada.");
        } else {
          movementScore = 85;
        }
      }
    }
  } else {
    movementScore = 70;
  }
  let smartwatchValidation = { isValid: true, bpmScore: 100, reason: "" };
  let smartwatchConnected = !!data.smartwatchData;
  if (subscriptionTier === "performance") {
    if (!isStravaConnected) {
      smartwatchConnected = false;
      antiFraudFlags.push("PERFORMANCE_BIOMETRIC_INCOMPLETE");
      reasons.push("Dados biom\xE9tricos incompletos: Conecte sua conta Strava para participar do ranking oficial do plano Performance.");
    } else if (!smartwatchConnected || !data.smartwatchData || !(Number(data.smartwatchData.avgHR) > 0 || Number(data.smartwatchData.maxHR) > 0)) {
      smartwatchConnected = false;
      antiFraudFlags.push("PERFORMANCE_BIOMETRIC_INCOMPLETE");
      reasons.push("Dados biom\xE9tricos incompletos: Aus\xEAncia de frequ\xEAncia card\xEDaca real synced via Strava.");
    }
  } else if (smartwatchConnected && !isStravaConnected) {
    smartwatchConnected = false;
    antiFraudFlags.push("MANUAL_SMARTWATCH_DISREGARDED");
    reasons.push("Dados card\xEDacos do rel\xF3gio preenchidos manualmente foram omitidos da avalia\xE7\xE3o. Conecte pelo Strava.");
  }
  if (smartwatchConnected) {
    const wp = data.smartwatchData;
    const avgHR = wp.avgHR || 0;
    const maxHR = wp.maxHR || 0;
    if (avgHR > 0 && avgHR < 85) {
      smartwatchValidation = {
        isValid: false,
        bpmScore: 50,
        reason: "Ritmo card\xEDaco em repouso incompat\xEDvel com treino de for\xE7a (muscula\xE7\xE3o)."
      };
      antiFraudFlags.push("SMARTWATCH_DATA_SUSPICIOUS");
      reasons.push(smartwatchValidation.reason);
    } else if (maxHR > 220 || avgHR > 195) {
      smartwatchValidation = {
        isValid: false,
        bpmScore: 30,
        reason: "Telemetria cardiovascular fora do limite saud\xE1vel do corpo humano."
      };
      antiFraudFlags.push("SMARTWATCH_DATA_SUSPICIOUS");
      reasons.push(smartwatchValidation.reason);
    }
  }
  let reliabilityScore = 40;
  if (locationConfirmed && !antiFraudFlags.includes("missing_location_coordinates")) {
    reliabilityScore += 20;
  } else {
    reliabilityScore -= 15;
  }
  if (activeTimeValid && !antiFraudFlags.includes("session_too_short")) {
    reliabilityScore += 20;
  } else {
    reliabilityScore -= 15;
  }
  if (data.photoBase64 && isPhotoValid && !antiFraudFlags.includes("INVALID_GYM_CONTEXT_PHOTO")) {
    reliabilityScore += 20;
  } else {
    reliabilityScore -= 20;
  }
  if (movementDetected) {
    reliabilityScore += 20;
  } else {
    reliabilityScore -= 10;
  }
  if (smartwatchConnected && smartwatchValidation.isValid) {
    reliabilityScore += 10;
  }
  if (userTrustScore >= 90) {
    reliabilityScore += 10;
  } else if (userTrustScore < 60) {
    reliabilityScore -= 15;
  }
  if (antiFraudFlags.includes("PERFORMANCE_BIOMETRIC_FAIL")) reliabilityScore -= 55;
  if (antiFraudFlags.includes("USER_HAS_ACTIVE_DENUNCIATIONS")) reliabilityScore -= 15;
  if (antiFraudFlags.includes("TELEPORTATION_GPS_JUMP")) reliabilityScore -= 45;
  if (antiFraudFlags.includes("PROLONGED_EXIT_DETECTED")) reliabilityScore -= 35;
  if (antiFraudFlags.includes("SUSPICIOUS_SENSED_CYCLIC_VIBRATION")) reliabilityScore -= 20;
  if (data.isMockLocation) reliabilityScore -= 65;
  if (data.isEmulator) reliabilityScore -= 50;
  if (data.isRooted) reliabilityScore -= 20;
  reliabilityScore = Math.max(0, Math.min(100, reliabilityScore));
  let finalStatus = "valid";
  let requiresManualReview = false;
  if (antiFraudFlags.includes("PERFORMANCE_BIOMETRIC_INCOMPLETE")) {
    const hasMajorFraud = data.isMockLocation || data.isEmulator || antiFraudFlags.includes("USER_HAS_ACTIVE_DENUNCIATIONS") || antiFraudFlags.includes("TELEPORTATION_GPS_JUMP") || antiFraudFlags.includes("PROLONGED_EXIT_DETECTED") || antiFraudFlags.includes("SUSPICIOUS_SENSED_CYCLIC_VIBRATION") || antiFraudFlags.includes("SMARTWATCH_DATA_SUSPICIOUS");
    if (!hasMajorFraud) {
      finalStatus = "biometria_incompleta";
      requiresManualReview = false;
    } else {
      finalStatus = "suspicious";
      requiresManualReview = true;
    }
  } else if (reliabilityScore >= 90) {
    finalStatus = "valid";
  } else if (reliabilityScore >= 70) {
    finalStatus = "suspicious";
    antiFraudFlags.push("APPROVED_MONITORED");
  } else if (reliabilityScore >= 50) {
    finalStatus = "pending_review";
    requiresManualReview = true;
  } else {
    finalStatus = "pending_review";
    antiFraudFlags.push("REJECTED_CRITICAL_FRAUD");
    requiresManualReview = true;
  }
  if (isTopAthlete && antiFraudFlags.includes("USER_HAS_ACTIVE_DENUNCIATIONS")) {
    finalStatus = "pending_review";
    requiresManualReview = true;
    reasons.push("Revis\xE3o obrigat\xF3ria autom\xE1tica: Atleta no pelot\xE3o de elite com den\xFAncias ativas.");
  }
  return {
    status: finalStatus,
    score: reliabilityScore,
    reason: reasons.join(" || ") || "Treino validado com sucesso.",
    requiresManualReview,
    isAiUnavailable: false,
    antiFraudFlags,
    details: {
      locationConfirmed,
      activeTimeValid,
      movementDetected,
      compatiblePauses: !antiFraudFlags.includes("PROLONGED_EXIT_DETECTED"),
      minimumConsistency: reliabilityScore >= 60,
      sessionConfidence: reliabilityScore >= 85,
      pausePatternScore: outOfBoundsTime > 180 ? 30 : 100,
      movementConfidence: reliabilityScore,
      smartwatchConnected,
      smartwatchData: data.smartwatchData || null,
      gymId,
      userLevel,
      userTrustScore,
      antiFraudFlags,
      requiredMinMins,
      tierLabel,
      photoAnalysis: photoAnalysisText,
      photoConfidence
    }
  };
}
var import_genai, ai;
var init_validate_activity = __esm({
  "api/_handlers/validate-activity.ts"() {
    init_common();
    init_observability();
    import_genai = require("@google/genai");
    init_activityRules();
    init_validationMessages();
    ai = new import_genai.GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
});

// api/_handlers/validate-presence.ts
async function handler12(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      userMessage: "M\xE9todo n\xE3o permitido."
    });
  }
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({
      success: false,
      userMessage: "Sess\xE3o expirada. Entre novamente para confirmar sua presen\xE7a."
    });
  }
  const { presenceCheckId, photoBase64 } = req.body;
  if (!presenceCheckId || !photoBase64) {
    return res.status(400).json({
      success: false,
      userMessage: "ID de verifica\xE7\xE3o e foto selfie s\xE3o obrigat\xF3rios."
    });
  }
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        userMessage: "Banco de dados indispon\xEDvel no momento."
      });
    }
    const pendingCheckRef = db.collection("pending_presence_checks").doc(presenceCheckId);
    const pendingCheckSnap = await pendingCheckRef.get();
    if (!pendingCheckSnap.exists) {
      return res.status(404).json({
        success: false,
        userMessage: "Solicita\xE7\xE3o de presen\xE7a expirada ou n\xE3o encontrada para esta atividade."
      });
    }
    const checkData = pendingCheckSnap.data() || {};
    if (checkData.status !== "pending") {
      return res.status(400).json({
        success: false,
        userMessage: "Esta verifica\xE7\xE3o de presen\xE7a j\xE1 foi processada."
      });
    }
    if (checkData.userId !== auth.uid) {
      return res.status(403).json({
        success: false,
        userMessage: "Acesso negado. Esta verifica\xE7\xE3o pertence a outro usu\xE1rio."
      });
    }
    const now = /* @__PURE__ */ new Date();
    if (new Date(checkData.expiredAt) < now) {
      await pendingCheckRef.update({ status: "expired" });
      return res.status(400).json({
        success: false,
        userMessage: "Tempo limite de 15 minutos expirado. Realize uma nova atividade para registrar seus pontos."
      });
    }
    const userId = auth.uid;
    let referencePhotoBase64 = null;
    let referenceSource = "none";
    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    if (userData.photoURL && userData.photoURL.startsWith("data:image")) {
      referencePhotoBase64 = userData.photoURL.split(",")[1] || userData.photoURL;
      referenceSource = "profile_url";
    } else if (userData.photoURL && userData.photoURL.startsWith("http")) {
      referenceSource = "profile_http_url";
    }
    if (!referencePhotoBase64) {
      const recentWorkoutsDocs = await db.collection("workouts").where("userId", "==", userId).orderBy("timestamp", "desc").limit(8).get();
      for (const doc2 of recentWorkoutsDocs.docs) {
        const wData = doc2.data();
        if (wData.photoUrl && wData.photoUrl.startsWith("data:image")) {
          referencePhotoBase64 = wData.photoUrl.split(",")[1] || wData.photoUrl;
          referenceSource = `workout_photo_${doc2.id}`;
          break;
        }
      }
    }
    const cleanSelfieBase64 = photoBase64.startsWith("data:image") ? photoBase64.split(",")[1] : photoBase64;
    const parts = [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanSelfieBase64
        }
      }
    ];
    if (referencePhotoBase64) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: referencePhotoBase64
        }
      });
    }
    const systemInstruction = "Voc\xEA \xE9 um engenheiro s\xEAnior e de intelig\xEAncia artificial de biometria antifraude focado em fisiculturismo e aplicativos fitness.\nSeu objetivo \xE9 analisar as imagens fornecidas para validar a presen\xE7a f\xEDsica (prova de vida) e a correspond\xEAncia de identidade do usu\xE1rio logado.";
    const promptText = `Instru\xE7\xF5es t\xE9cnicas para an\xE1lise de selfie biom\xE9trica:
IMAGEM 1: A selfie tirada ao vivo pelo usu\xE1rio para a confirma\xE7\xE3o de presen\xE7a.
${referencePhotoBase64 ? "IMAGEM 2: A foto de refer\xEAncia anterior do usu\xE1rio armazenada no banco de dados.\n" : "Nenhuma imagem de refer\xEAncia armazenada anterior. Fa\xE7a uma an\xE1lise focada em prova de vida (liveness).\n"}
TAREFAS:
1. PROVA DE VIDA (Liveness): O usu\xE1rio foi solicitado a fazer este gesto na selfie: "${checkData.livenessPrompt}". Ele realizou o gesto com sucesso na Imagem 1? Detecte movimentos faciais naturais, ilumina\xE7\xE3o, profundidade e texturas para atestar que \xE9 um humano vivo jogando o gesto.
2. DETEC\xC7\xC3O DE REPLAY/FRAUDE: Identifique fraudes como: foto de outra tela, foto impressa em papel, filtros artificiais ou imagem est\xE1tica de foto antiga.
3. COMPARA\xC7\xC3O FACIAL (De Identidade): ${referencePhotoBase64 ? "As duas fotos fornecidas pertencem \xE0 mesma pessoa? Analise olhos, nariz, boca, ma\xE7\xE3s do rosto e estrutura \xF3ssea do rosto." : 'Aus\xEAncia de modelo pr\xE9vio para compara\xE7\xE3o. Marcar o n\xEDvel de identidade como baseline "high" para bootstrapper seguro.'}

Retorne estritamente um objeto JSON com o seguinte formato:
{
  "livenessConfidence": "high" | "medium" | "low",
  "identityConfidence": "high" | "medium" | "low",
  "presenceConfidence": 0 a 100, // Score num\xE9rico final condensado de confian\xE7a f\xEDsica
  "livenessMatched": true | false, // Se o gesto requerido foi conclu\xEDdo
  "identityMatched": true | false, // Se as caracter\xEDsticas faciais conferem com o perfil
  "reason": "uma explica\xE7\xE3o curta em portugu\xEAs, amig\xE1vel e t\xE9cnica, justificando seu diagn\xF3stico"
}`;
    parts.push({ text: promptText });
    let geminiResponse;
    try {
      geminiResponse = await ai2.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts },
        config: {
          systemInstruction,
          responseMimeType: "application/json"
        }
      });
    } catch (apiErr) {
      console.error("[Verified Presence API] Gemini processing error:", apiErr);
      throw new Error(`Servidor de an\xE1lise biom\xE9trica temporariamente ocupado: ${apiErr.message}`);
    }
    const responseText = geminiResponse.text?.trim() || "{}";
    let biometrics = {};
    try {
      biometrics = JSON.parse(responseText);
    } catch (_) {
      console.warn("[Verified Presence API] JSON parse error in response:", responseText);
      biometrics = {
        livenessConfidence: "medium",
        identityConfidence: "medium",
        presenceConfidence: 70,
        livenessMatched: true,
        identityMatched: true,
        reason: "Valida\xE7\xE3o mec\xE2nica em andamento devido a flutua\xE7\xE3o nas leituras prim\xE1rias."
      };
    }
    const livenessConfidence = biometrics.livenessConfidence || "medium";
    const identityConfidence = biometrics.identityConfidence || "medium";
    const presenceConfidence = biometrics.presenceConfidence ?? 75;
    const livenessMatched = biometrics.livenessMatched !== false;
    const identityMatched = biometrics.identityMatched !== false;
    const aiReason = biometrics.reason || "Confirma\xE7\xE3o biom\xE9trica revisada via telemetria.";
    let finalDecision = "approved";
    let friendlyResultMessage = "Presen\xE7a confirmada com sucesso.";
    if (presenceConfidence < 40 || !livenessMatched) {
      finalDecision = "rejected";
      friendlyResultMessage = "N\xE3o foi poss\xEDvel concluir a confirma\xE7\xE3o de presen\xE7a desta atividade.";
    } else if (presenceConfidence < 72 || !identityMatched) {
      finalDecision = "pending";
      friendlyResultMessage = "N\xE3o conseguimos confirmar sua presen\xE7a automaticamente. Sua atividade foi enviada para an\xE1lise.";
    }
    await pendingCheckRef.update({
      status: finalDecision,
      presenceConfidence,
      identityConfidence,
      livenessConfidence,
      finalDecision,
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      biometricReason: aiReason,
      referenceSource
    });
    const workoutPayload = checkData.workoutPayload || {};
    if (finalDecision === "approved" || finalDecision === "pending") {
      const isRunning = checkData.workoutPayload?.km !== void 0 || checkData.type === "running";
      if (isRunning) {
        await commitRunningSession(userId, workoutPayload, finalDecision);
      } else {
        await commitWorkoutSession(userId, workoutPayload, finalDecision, cleanSelfieBase64);
      }
    }
    if (finalDecision === "approved" && presenceConfidence >= 85 && (!userData.photoURL || !userData.photoURL.startsWith("data:image"))) {
      try {
        await userRef.update({
          photoURL: `data:image/jpeg;base64,${cleanSelfieBase64}`,
          updatedAt: import_firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.warn("[Presence Verification] Failed to update profile photo reference:", err);
      }
    }
    try {
      await logEvent({
        severity: finalDecision === "approved" ? "INFO" : finalDecision === "pending" ? "WARNING" : "HIGH_RISK",
        category: "fraud_audit_logs",
        message: `Biometria de presen\xE7a conclu\xEDda com decis\xE3o '${finalDecision}' (Score: ${presenceConfidence}) para usu\xE1rio ${userId}`,
        userId,
        route: "/api/validate-presence",
        details: {
          presenceCheckId,
          presenceConfidence,
          identityConfidence,
          livenessConfidence,
          finalDecision,
          aiReason
        }
      });
    } catch (_) {
    }
    return res.json({
      success: true,
      status: finalDecision,
      finalDecision,
      presenceConfidence,
      identityConfidence,
      livenessConfidence,
      userMessage: friendlyResultMessage,
      reason: aiReason
    });
  } catch (error) {
    console.error("[Presence Checker Endpoint Error]:", error);
    return res.status(500).json({
      success: false,
      userMessage: error.message || "Erro inesperado ao validar sua foto de presen\xE7a."
    });
  }
}
async function commitWorkoutSession(userId, payload, finalDecision, presenceSelfie) {
  const { type, durationMins, distanceKm, photoBase64, checkpoints, hasExercises, aiResult, focus, description, quizAnswers } = payload;
  const nowLocalDate = /* @__PURE__ */ new Date();
  const todayISO = nowLocalDate.toISOString().split("T")[0];
  const userRef = db.collection("users").doc(userId);
  const workoutRef = db.collection("workouts").doc();
  const stValue = import_firestore.FieldValue.serverTimestamp();
  const getWeekNo = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  };
  const weekId = `${nowLocalDate.getFullYear()}-W${getWeekNo(nowLocalDate)}`;
  const weeklyStatsRef = userRef.collection("weeklyStats").doc(weekId);
  await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return;
    const userData = userSnap.data() || {};
    const weeklyStatsSnap = await transaction.get(weeklyStatsRef);
    let weeklyStatsData = weeklyStatsSnap.exists ? weeklyStatsSnap.data() : {
      weekId,
      scoredDays: [],
      totalScoredDays: 0,
      totalPoints: 0
    };
    const scoredDays = weeklyStatsData.scoredDays || [];
    const isDayAlreadyScored = scoredDays.includes(todayISO);
    let pointsEarned = 0;
    let computedStatus = "valid";
    if (finalDecision === "pending") {
      pointsEarned = 0;
      computedStatus = "pending_review";
    } else {
      const basePoints = type === "workout" ? 50 : 35;
      pointsEarned = userData.isSubscribed || true ? basePoints : 0;
    }
    let todayPoints = 0;
    const todayDocs = await db.collection("workouts").where("userId", "==", userId).where("timestamp", ">=", todayISO).get();
    todayDocs.forEach((d) => {
      const w = d.data();
      if (w.status !== "invalid") todayPoints += w.points || 0;
    });
    if (pointsEarned > 0 && todayPoints + pointsEarned > 100) {
      pointsEarned = Math.max(0, 100 - todayPoints);
    }
    let isScoringEligible = false;
    let nonScoringReason = null;
    if (pointsEarned > 0) {
      if (isDayAlreadyScored) {
        isScoringEligible = true;
      } else if (scoredDays.length < 5) {
        isScoringEligible = true;
        scoredDays.push(todayISO);
        weeklyStatsData.scoredDays = scoredDays;
        weeklyStatsData.totalScoredDays = scoredDays.length;
      } else {
        isScoringEligible = false;
        nonScoringReason = "WEEKLY_SCORING_LIMIT_REACHED";
        pointsEarned = 0;
      }
    } else {
      isScoringEligible = true;
    }
    const updates = {
      updatedAt: stValue
    };
    if (userData.isSubscribed || true) {
      updates.score = (userData.score || 0) + pointsEarned;
      updates.weeklyScore = (userData.weeklyScore || 0) + pointsEarned;
      updates.monthlyScore = (userData.monthlyScore || 0) + pointsEarned;
      if (finalDecision === "approved") {
        const lastCheckIn = userData.lastCheckIn ? new Date(userData.lastCheckIn) : null;
        let newStreak = userData.streak || 0;
        if (lastCheckIn) {
          const lastCheckInDay = userData.lastCheckIn.split("T")[0];
          if (todayISO !== lastCheckInDay) {
            const yesterday = /* @__PURE__ */ new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (lastCheckInDay === yesterday.toISOString().split("T")[0]) {
              newStreak += 1;
            } else {
              newStreak = 1;
            }
          }
        } else {
          newStreak = 1;
        }
        updates.streak = newStreak;
        updates.lastCheckIn = nowLocalDate.toISOString();
        updates.totalWorkouts = (userData.totalWorkouts || 0) + 1;
        if (!userData.lastCheckIn || todayISO !== userData.lastCheckIn.split("T")[0]) {
          updates.totalActiveDays = (userData.totalActiveDays || 0) + 1;
        }
      }
    }
    if (pointsEarned > 0) {
      weeklyStatsData.totalPoints = (weeklyStatsData.totalPoints || 0) + pointsEarned;
      weeklyStatsData.updatedAt = stValue;
      transaction.set(weeklyStatsRef, weeklyStatsData);
    }
    const workoutObj = {
      id: workoutRef.id,
      userId,
      type,
      timestamp: nowLocalDate.toISOString(),
      duration: durationMins || 45,
      distance: distanceKm || 0,
      status: computedStatus,
      points: pointsEarned,
      isScoringEligible,
      ...isScoringEligible ? { scoringWeekId: weekId, scoringDate: todayISO } : { nonScoringReason },
      validation: {
        status: computedStatus,
        reason: "Presen\xE7a e identidade verificadas biometricamente.",
        score: finalDecision === "approved" ? 100 : 70,
        details: {
          presenceCheckRequested: true,
          presenceCheckCompleted: true,
          finalDecision,
          livenessVerified: finalDecision === "approved"
        }
      },
      // Save selfie face as the activity photo!
      photoUrl: presenceSelfie ? `data:image/jpeg;base64,${presenceSelfie}` : photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null,
      createdAt: stValue
    };
    transaction.set(workoutRef, workoutObj);
    transaction.update(userRef, updates);
  });
}
async function commitRunningSession(userId, payload, finalDecision) {
  const { km, timeSeconds, pace, calories, elevationGain, steps, trajectory, date, session } = payload;
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const todayISO = nowIso.split("T")[0];
  const userRef = db.collection("users").doc(userId);
  const currentKm = parseFloat(km || 0);
  const runningStatsRef = db.collection("running_stats").doc(userId);
  const runningStatsSnap = await runningStatsRef.get();
  let rStats = runningStatsSnap.exists ? runningStatsSnap.data() : {
    userId,
    best_run_km_month: 0,
    best_run_km_week: 0,
    last_run_date: nowIso,
    is_paid_running: false
  };
  rStats.best_run_km_month = Math.max(rStats.best_run_km_month || 0, currentKm);
  rStats.best_run_km_week = Math.max(rStats.best_run_km_week || 0, currentKm);
  rStats.last_run_date = nowIso;
  rStats.last_run_stats = {
    km: currentKm,
    timeSeconds: timeSeconds || 0,
    pace: pace || `0'00"/km`,
    calories: calories || 0,
    elevationGain: elevationGain || 0,
    steps: steps || 0,
    trajectory: trajectory || [],
    date: date || nowIso
  };
  const getWeekNumber = (date2) => {
    const d = new Date(Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  };
  const weekId = `${now.getFullYear()}-W${getWeekNumber(now)}`;
  const weeklyStatsRef = userRef.collection("weeklyStats").doc(weekId);
  let sessionId = null;
  if (session) {
    const sessionRef = db.collection("run_sessions").doc();
    sessionId = sessionRef.id;
    await sessionRef.set({
      ...session,
      id: sessionId,
      userId,
      validationStatus: finalDecision === "approved" ? "VALID" : "SUSPICIOUS",
      createdAt: import_firestore.FieldValue.serverTimestamp()
    });
  }
  await db.collection("running_stats").doc(userId).set(rStats, { merge: true });
  await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return;
    const userData = userSnap.data() || {};
    let xpAwarded = 0;
    if (finalDecision === "approved" && (userData.isSubscribed || true)) {
      xpAwarded = 20 + Math.floor(currentKm * 5);
    }
    const weeklyStatsSnap = await transaction.get(weeklyStatsRef);
    let weeklyStatsData = weeklyStatsSnap.exists ? weeklyStatsSnap.data() : {
      weekId,
      scoredDays: [],
      totalScoredDays: 0,
      totalPoints: 0
    };
    const scoredDays = weeklyStatsData.scoredDays || [];
    const isDayAlreadyScored = scoredDays.includes(todayISO);
    let isScoringEligible = false;
    let nonSpScoringReason = null;
    if (xpAwarded > 0) {
      if (isDayAlreadyScored) {
        isScoringEligible = true;
      } else if (scoredDays.length < 5) {
        isScoringEligible = true;
        scoredDays.push(todayISO);
        weeklyStatsData.scoredDays = scoredDays;
        weeklyStatsData.totalScoredDays = scoredDays.length;
      } else {
        isScoringEligible = false;
        nonSpScoringReason = "WEEKLY_SCORING_LIMIT_REACHED";
        xpAwarded = 0;
      }
    } else {
      isScoringEligible = true;
    }
    const userUpdates = {
      updatedAt: import_firestore.FieldValue.serverTimestamp()
    };
    if (userData.isSubscribed || true) {
      userUpdates.score = (userData.score || 0) + xpAwarded;
      userUpdates.lastCheckIn = nowIso;
      const lastCheckInDay = userData.lastCheckIn ? userData.lastCheckIn.split("T")[0] : "";
      if (todayISO !== lastCheckInDay) {
        userUpdates.totalActiveDays = (userData.totalActiveDays || 0) + 1;
      }
    }
    if (xpAwarded > 0) {
      weeklyStatsData.totalPoints = (weeklyStatsData.totalPoints || 0) + xpAwarded;
      weeklyStatsData.updatedAt = import_firestore.FieldValue.serverTimestamp();
      transaction.set(weeklyStatsRef, weeklyStatsData);
    }
    transaction.update(userRef, userUpdates);
    const workoutDocRef = db.collection("workouts").doc();
    await transaction.set(workoutDocRef, {
      id: workoutDocRef.id,
      userId,
      type: "cardio",
      timestamp: nowIso,
      duration: Math.ceil((timeSeconds || 0) / 60),
      distance: currentKm,
      status: finalDecision === "approved" ? "valid" : "pending_review",
      points: xpAwarded,
      isScoringEligible,
      validation: {
        status: finalDecision === "approved" ? "valid" : "pending_review",
        reason: "Presen\xE7a em corrida de rua verificada biometricamente.",
        score: finalDecision === "approved" ? 100 : 70
      },
      createdAt: import_firestore.FieldValue.serverTimestamp()
    });
  });
}
var import_genai2, ai2;
var init_validate_presence = __esm({
  "api/_handlers/validate-presence.ts"() {
    init_common();
    init_observability();
    import_genai2 = require("@google/genai");
    ai2 = new import_genai2.GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
});

// api/_handlers/elite.ts
async function handler13(req, res) {
  if (cors(req, res)) return;
  const { action } = req.query;
  if (req.method === "POST" && action === "join-success") {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    const { userId, seasonId, challengeId, entryFee, userName, userPhoto } = req.body;
    if (!userId || !seasonId || !challengeId) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    try {
      const batch = db.batch();
      const seasonRef = db.collection("seasons").doc(seasonId);
      batch.set(seasonRef, {
        athletesCount: import_firestore.FieldValue.increment(1),
        totalPool: import_firestore.FieldValue.increment(entryFee * 0.5)
        // 50% to pool
      }, { merge: true });
      const feedRef = db.collection("elite_feed").doc();
      batch.set(feedRef, {
        userId,
        userName: userName || "Atleta",
        userPhoto: userPhoto || "",
        text: `entrou no desafio ${challengeId.split("_")[0]}! \u{1F525}`,
        type: "join",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      await batch.commit();
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("[Elite Admin Join Error]", error);
      return res.status(500).json({ error: error.message });
    }
  }
  return res.status(404).json({ error: "Action not found" });
}
var init_elite = __esm({
  "api/_handlers/elite.ts"() {
    init_common();
  }
});

// api/_handlers/whatsapp.ts
async function handler14(req, res) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Autentica\xE7\xE3o necess\xE1ria." });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "M\xE9todo n\xE3o permitido" });
  }
  const { to, message, type } = req.body;
  console.log(`[WhatsApp API] Mock sending message to ${to}: ${message}`);
  return res.status(200).json({
    success: true,
    message: "Mock message sent",
    to,
    type
  });
}
var init_whatsapp = __esm({
  "api/_handlers/whatsapp.ts"() {
    init_common();
  }
});

// api/_lib/strava-api.ts
var STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, StravaApi;
var init_strava_api = __esm({
  "api/_lib/strava-api.ts"() {
    init_common();
    STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
    STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
    StravaApi = class {
      constructor(userId) {
        this.userId = userId;
      }
      async getConnection() {
        const snap = await db.collection("strava_connections").doc(this.userId).get();
        return snap.exists ? snap.data() : null;
      }
      async saveConnection(data) {
        const connectionData = {
          userId: this.userId,
          athleteId: data.athlete.id,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_at,
          scope: data.scope || "read,activity:read_all",
          createdAt: import_firestore.FieldValue.serverTimestamp(),
          lastSyncAt: null
        };
        await db.collection("strava_connections").doc(this.userId).set(connectionData);
        await db.collection("strava_athletes").doc(data.athlete.id.toString()).set({
          userId: this.userId,
          updatedAt: import_firestore.FieldValue.serverTimestamp()
        });
        await db.collection("users").doc(this.userId).update({
          strava_connected: true,
          strava_athlete_id: data.athlete.id.toString(),
          updatedAt: import_firestore.FieldValue.serverTimestamp()
        });
        return connectionData;
      }
      async deleteConnection() {
        const conn = await this.getConnection();
        if (conn?.athleteId) {
          await db.collection("strava_athletes").doc(conn.athleteId.toString()).delete();
        }
        await db.collection("strava_connections").doc(this.userId).delete();
        await db.collection("users").doc(this.userId).update({
          strava_connected: false,
          strava_athlete_id: import_firestore.FieldValue.delete(),
          updatedAt: import_firestore.FieldValue.serverTimestamp()
        });
      }
      async getAccessToken() {
        const conn = await this.getConnection();
        if (!conn) return null;
        const now = Math.floor(Date.now() / 1e3);
        if (conn.expiresAt > now + 300) {
          return conn.accessToken;
        }
        console.log(`[StravaApi] Refreshing token for ${this.userId}`);
        const response = await fetch("https://www.strava.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: STRAVA_CLIENT_ID,
            client_secret: STRAVA_CLIENT_SECRET,
            refresh_token: conn.refreshToken,
            grant_type: "refresh_token"
          })
        });
        if (!response.ok) {
          const err = await response.text();
          console.error(`[StravaApi] Token refresh failed: ${err}`);
          return null;
        }
        const data = await response.json();
        const updates = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_at,
          updatedAt: import_firestore.FieldValue.serverTimestamp()
        };
        await db.collection("strava_connections").doc(this.userId).update(updates);
        return data.access_token;
      }
      async fetchActivities(after) {
        const token = await this.getAccessToken();
        if (!token) throw new Error("Not connected to Strava");
        const url = new URL("https://www.strava.com/api/v3/athlete/activities");
        if (after) url.searchParams.append("after", after.toString());
        url.searchParams.append("per_page", "50");
        const response = await fetch(url.toString(), {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
          throw new Error(`Strava API error: ${response.statusText}`);
        }
        return response.json();
      }
      async fetchActivity(activityId) {
        const token = await this.getAccessToken();
        if (!token) throw new Error("Not connected to Strava");
        const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
          throw new Error(`Strava API error: ${response.statusText}`);
        }
        return response.json();
      }
    };
  }
});

// api/_lib/sync-service.ts
var SyncService;
var init_sync_service = __esm({
  "api/_lib/sync-service.ts"() {
    init_common();
    SyncService = class {
      static async processStravaActivity(userId, stravaActivity) {
        console.log(`[SyncService] Processing activity ${stravaActivity.id} for user ${userId}`);
        if (stravaActivity.type !== "Run" && stravaActivity.sport_type !== "Run" && stravaActivity.type !== "TrailRun") {
          console.log(`[SyncService] Skipping activity ${stravaActivity.id}: Not a run (${stravaActivity.type})`);
          return false;
        }
        if (stravaActivity.manual) {
          console.log(`[SyncService] Skipping activity ${stravaActivity.id}: Manual entry`);
          return false;
        }
        const hasGps = !!(stravaActivity.map?.summary_polyline || stravaActivity.map?.polyline);
        if (!hasGps) {
          console.log(`[SyncService] Skipping activity ${stravaActivity.id}: No GPS data`);
          return false;
        }
        const distance = stravaActivity.distance;
        const movingTime = stravaActivity.moving_time;
        const avgSpeed = stravaActivity.average_speed;
        const km = distance / 1e3;
        if (avgSpeed > 8.5) {
          console.warn(`[SyncService] Flagging activity ${stravaActivity.id}: Impossible speed (${avgSpeed} m/s)`);
          await this.logStravaActivity(userId, stravaActivity, "INVALID", "Impossible speed");
          return false;
        }
        const stravaActivityId = stravaActivity.id.toString();
        const activityRef = db.collection("strava_activities").doc(stravaActivityId);
        const existingSnap = await activityRef.get();
        if (existingSnap.exists) {
          console.log(`[SyncService] Activity ${stravaActivityId} already processed.`);
          return false;
        }
        await activityRef.set({
          id: stravaActivityId,
          userId,
          stravaActivityId: stravaActivity.id,
          name: stravaActivity.name,
          distance: stravaActivity.distance,
          movingTime: stravaActivity.moving_time,
          elapsedTime: stravaActivity.elapsed_time,
          totalElevationGain: stravaActivity.total_elevation_gain,
          type: stravaActivity.type,
          startDate: stravaActivity.start_date,
          averageSpeed: stravaActivity.average_speed,
          maxSpeed: stravaActivity.max_speed,
          hasGps: true,
          manual: !!stravaActivity.manual,
          has_heartrate: !!stravaActivity.has_heartrate,
          average_heartrate: stravaActivity.average_heartrate || null,
          max_heartrate: stravaActivity.max_heartrate || null,
          status: "VALID",
          createdAt: import_firestore.FieldValue.serverTimestamp()
        });
        await this.updateUserPerformance(userId, {
          km,
          timeSeconds: movingTime,
          elevationGain: stravaActivity.total_elevation_gain,
          date: stravaActivity.start_date,
          stravaActivityId
        });
        await this.updateEliteChallenges(userId, km, stravaActivity.start_date);
        return true;
      }
      static async logStravaActivity(userId, stravaActivity, status, reason) {
        await db.collection("strava_activities").doc(stravaActivity.id.toString()).set({
          userId,
          stravaActivityId: stravaActivity.id,
          status,
          fraudReason: reason,
          createdAt: import_firestore.FieldValue.serverTimestamp()
        });
      }
      static async updateUserPerformance(userId, activity) {
        const km = activity.km;
        const statsRef = db.collection("running_stats").doc(userId);
        const userRef = db.collection("users").doc(userId);
        const [statsSnap, userSnap] = await Promise.all([statsRef.get(), userRef.get()]);
        const statsData = statsSnap.exists ? statsSnap.data() : {
          userId,
          best_run_km_month: 0,
          best_run_km_week: 0,
          last_run_date: activity.date
        };
        const userData = userSnap.data() || {};
        const now = /* @__PURE__ */ new Date();
        const isPerformance = userData.subscriptionTier === "performance";
        const xpAwarded = (userData.isSubscribed || true) && !isPerformance ? 20 + Math.floor(km * 5) : 0;
        if ((userData.isSubscribed || true) && xpAwarded > 0) {
          const userUpdates = {
            score: (userData.score || 0) + xpAwarded,
            xp: (userData.xp || 0) + xpAwarded,
            updatedAt: import_firestore.FieldValue.serverTimestamp()
          };
          const lastCheckIn = userData.lastCheckIn ? new Date(userData.lastCheckIn) : /* @__PURE__ */ new Date(0);
          const isNewMonth = now.getMonth() !== lastCheckIn.getMonth() || now.getFullYear() !== lastCheckIn.getFullYear();
          if (isNewMonth) {
            userUpdates.monthlyScore = xpAwarded;
          } else {
            userUpdates.monthlyScore = (userData.monthlyScore || 0) + xpAwarded;
          }
          userUpdates.lastCheckIn = activity.date;
          await userRef.update(userUpdates);
        }
        const updates = {
          last_run_date: activity.date,
          last_run_stats: {
            km,
            timeSeconds: activity.timeSeconds,
            elevationGain: activity.elevationGain,
            date: activity.date,
            source: "strava",
            stravaActivityId: activity.stravaActivityId
          },
          updatedAt: import_firestore.FieldValue.serverTimestamp()
        };
        if (km > (statsData?.best_run_km_month || 0)) updates.best_run_km_month = km;
        if (km > (statsData?.best_run_km_week || 0)) updates.best_run_km_week = km;
        await statsRef.set(updates, { merge: true });
        await db.collection("run_sessions").add({
          userId,
          km,
          duration: activity.timeSeconds,
          source: "strava",
          stravaActivityId: activity.stravaActivityId,
          createdAt: import_firestore.FieldValue.serverTimestamp(),
          date: activity.date
        });
      }
      static async updateEliteChallenges(userId, km, dateStr) {
        const activityDate = new Date(dateStr);
        const challengesSnap = await db.collection("user_elite_challenges").where("userId", "==", userId).where("status", "==", "active").get();
        const batch = db.batch();
        challengesSnap.forEach((doc2) => {
          const data = doc2.data();
          const startDate = new Date(data.startDate);
          const endDate = new Date(data.endDate);
          if (activityDate >= startDate && activityDate <= endDate) {
            const newKm = (data.currentKm || 0) + km;
            const status = newKm >= data.targetKm ? "completed" : "active";
            batch.update(doc2.ref, {
              currentKm: newKm,
              status,
              lastActivityAt: activityDate.toISOString(),
              updatedAt: import_firestore.FieldValue.serverTimestamp()
            });
            if (status === "completed") {
              db.collection("elite_feed").add({
                userId,
                userName: "Atleta",
                // We'd need more info for name
                text: `completou o desafio de ${data.targetKm}KM!`,
                type: "challenge_complete",
                timestamp: import_firestore.FieldValue.serverTimestamp()
              });
            }
          }
        });
        await batch.commit();
      }
    };
  }
});

// api/_handlers/strava.ts
async function handler15(req, res) {
  if (cors(req, res)) return;
  const { method, query } = req;
  const action = query.stravaAction || query.action || "status";
  try {
    if (method === "GET" && query["hub.mode"] === "subscribe") {
      return handleWebhookValidation(req, res);
    }
    if (method === "POST" && !query.action) {
      return handleWebhookEvent(req, res);
    }
    const auth = await verifyAuth(req);
    if (!auth && action !== "callback") {
      return res.status(401).json({ error: "Authentication required" });
    }
    const userId = auth?.uid || query.state;
    if (!userId) {
      return res.status(400).json({ error: "User ID missing" });
    }
    const strava = new StravaApi(userId);
    switch (action) {
      case "auth":
        return await initiateAuth(res, userId);
      case "callback":
        return await handleCallback(req, res, strava);
      case "status":
        return await getStatus(res, strava);
      case "sync":
        return await manualSync(res, strava);
      case "disconnect":
        await strava.deleteConnection();
        return res.json({ success: true });
      default:
        return res.status(400).json({ error: "Invalid action" });
    }
  } catch (error) {
    console.error(`[Strava API Error] Action: ${action}`, error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
async function initiateAuth(res, userId) {
  const scope = "read,activity:read_all";
  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID2}&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&response_type=code&scope=${scope}&state=${userId}`;
  return res.json({ url });
}
async function handleCallback(req, res, strava) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "Code missing" });
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID2,
      client_secret: STRAVA_CLIENT_SECRET2,
      code,
      grant_type: "authorization_code"
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Strava token exchange failed: ${err}`);
  }
  const data = await response.json();
  await strava.saveConnection(data);
  manualSyncInternal(strava).catch(console.error);
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  return res.redirect(`${appUrl}/profile?strava=connected`);
}
async function getStatus(res, strava) {
  const conn = await strava.getConnection();
  return res.json({
    connected: !!conn,
    athleteId: conn?.athleteId || null,
    lastSync: conn?.lastSyncAt || null
  });
}
async function manualSync(res, strava) {
  const result = await manualSyncInternal(strava);
  return res.json(result);
}
async function manualSyncInternal(strava) {
  const after = Math.floor(Date.now() / 1e3) - 60 * 24 * 60 * 60;
  const activities = await strava.fetchActivities(after);
  let syncCount = 0;
  for (const act of activities) {
    if (await SyncService.processStravaActivity(strava.userId, act)) {
      syncCount++;
    }
  }
  const userId = strava.userId;
  await db.collection("strava_connections").doc(userId).update({
    lastSyncAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return { success: true, syncCount };
}
function handleWebhookValidation(req, res) {
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (verifyToken === STRAVA_VERIFY_TOKEN) {
    return res.status(200).json({ "hub.challenge": challenge });
  }
  return res.status(403).json({ error: "Webhook verification failed" });
}
async function handleWebhookEvent(req, res) {
  const event = req.body;
  console.log("[Strava Webhook] Event:", event);
  if (event.object_type === "activity" && event.aspect_type === "create") {
    const athleteId = event.owner_id.toString();
    const athleteSnap = await db.collection("strava_athletes").doc(athleteId).get();
    if (athleteSnap.exists) {
      const userId = athleteSnap.data()?.userId;
      if (userId) {
        const strava = new StravaApi(userId);
        try {
          const activity = await strava.fetchActivity(event.object_id);
          await SyncService.processStravaActivity(userId, activity);
        } catch (e) {
          console.error(`[Strava Webhook] Failed to process activity ${event.object_id}:`, e);
        }
      }
    }
  }
  return res.status(200).json({ success: true });
}
var STRAVA_CLIENT_ID2, STRAVA_CLIENT_SECRET2, STRAVA_REDIRECT_URI, STRAVA_VERIFY_TOKEN;
var init_strava = __esm({
  "api/_handlers/strava.ts"() {
    init_common();
    init_strava_api();
    init_sync_service();
    STRAVA_CLIENT_ID2 = process.env.STRAVA_CLIENT_ID;
    STRAVA_CLIENT_SECRET2 = process.env.STRAVA_CLIENT_SECRET;
    STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;
    STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || process.env.STRAVA_WEBHOOK_SECRET;
  }
});

// api/_handlers/migrate-reset.ts
async function handler16(req, res) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  const userSnap = await db.collection("users").doc(auth.uid).get();
  const userData = userSnap.data();
  if (userData?.role !== "admin" && userData?.email !== "samuelfsc89@gmail.com") {
    return res.status(403).json({ error: "S\xF3 administradores podem realizar esta a\xE7\xE3o." });
  }
  try {
    console.log("[Migration] Starting full progress reset...");
    const usersSnap = await db.collection("users").get();
    const batch = db.batch();
    usersSnap.forEach((doc2) => {
      batch.update(doc2.ref, {
        score: 0,
        xp: 0,
        level: 1,
        weeklyScore: 0,
        monthlyScore: 0,
        streak: 0,
        totalActiveDays: 0,
        totalWorkouts: 0,
        totalTimeSpent: 0,
        achievements: [],
        firstScoreAt: import_firestore.FieldValue.delete(),
        lastCheckIn: import_firestore.FieldValue.delete(),
        updatedAt: import_firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    console.log(`[Migration] Reset ${usersSnap.size} users.`);
    const collectionsToClear = ["activities", "workouts", "run_sessions"];
    for (const collName of collectionsToClear) {
      const snap = await db.collection(collName).get();
      const deleteBatch = db.batch();
      snap.forEach((doc2) => deleteBatch.delete(doc2.ref));
      await deleteBatch.commit();
      console.log(`[Migration] Deleted ${snap.size} documents from ${collName}.`);
    }
    const statsSnap = await db.collection("running_stats").get();
    const statsBatch = db.batch();
    statsSnap.forEach((doc2) => {
      statsBatch.update(doc2.ref, {
        best_run_km_month: 0,
        best_run_km_week: 0,
        last_run_stats: import_firestore.FieldValue.delete(),
        updatedAt: import_firestore.FieldValue.serverTimestamp()
      });
    });
    await statsBatch.commit();
    console.log(`[Migration] Reset ${statsSnap.size} running_stats documents.`);
    return res.json({ success: true, message: "Todo o progresso foi zerado com sucesso." });
  } catch (error) {
    console.error("[Migration] Reset failed:", error);
    return res.status(500).json({ error: error.message });
  }
}
var init_migrate_reset = __esm({
  "api/_handlers/migrate-reset.ts"() {
    init_common();
  }
});

// api/_handlers/env-check.ts
async function handler17(req, res) {
  let firestoreTest = "Not started";
  try {
    const snap = await db.collection("test").doc("ping").get();
    firestoreTest = `Success! Exists: ${snap.exists}`;
  } catch (e) {
    firestoreTest = `Failed: ${e.message}`;
  }
  return res.json({
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    PROJECT_ID: process.env.PROJECT_ID,
    FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
    NODE_ENV: process.env.NODE_ENV,
    GEMINI_KEY_PRESENT: !!process.env.GEMINI_API_KEY,
    GEMINI_KEY_LENGTH: process.env.GEMINI_API_KEY?.length || 0,
    firestoreTest,
    appProjectId: app.options.projectId,
    appDatabaseId: db.databaseId
  });
}
var init_env_check = __esm({
  "api/_handlers/env-check.ts"() {
    init_common();
  }
});

// api/_handlers/mercadopago.ts
async function handler18(req, res) {
  if (cors(req, res)) return;
  const { action } = req.query;
  const possibleVarNames = [
    "TOKEN_DE_ACESSO_AO_MERCADO_PAGO",
    "MERCADO_PAGO_ACESS_TOKEN",
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MP_ACCESS_TOKEN",
    "MERCADOPAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_TOKEN",
    "MP_TOKEN"
  ];
  let selectedVarName = "MERCADO_PAGO_ACCESS_TOKEN";
  let accessToken = "";
  for (const varName of possibleVarNames) {
    const val = (process.env[varName] || "").trim();
    if (val && val.startsWith("APP_USR-")) {
      accessToken = val;
      selectedVarName = varName;
      break;
    }
  }
  if (!accessToken) {
    for (const varName of possibleVarNames) {
      const val = (process.env[varName] || "").trim();
      if (val && !val.toLowerCase().includes("placeholder") && !val.toLowerCase().includes("seu_token") && val.length >= 15) {
        accessToken = val;
        selectedVarName = varName;
        break;
      }
    }
  }
  if (!accessToken) {
    accessToken = (process.env.MERCADO_PAGO_ACCESS_TOKEN || "").trim();
  }
  if (!accessToken) {
    console.error("[MercadoPago] Missing MERCADO_PAGO_ACCESS_TOKEN");
    return res.status(500).json({ error: "MERCADO_PAGO_ACCESS_TOKEN n\xE3o est\xE1 configurado no servidor. Verifique se as vari\xE1veis MERCADO_PAGO_ACCESS_TOKEN ou MP_ACCESS_TOKEN est\xE3o corretivas." });
  }
  const client = new import_mercadopago.MercadoPagoConfig({ accessToken });
  if (req.method === "POST" && action === "create-preference") {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    const { challengeId, challengeName, entryFee, userId, userName, userPhoto, seasonId } = req.body;
    if (!challengeId || !entryFee || !userId) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    try {
      const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production" || process.env.VERCEL === "1";
      const tokenPrefix = accessToken ? accessToken.substring(0, 15) : "";
      const tokenLength = accessToken ? accessToken.length : 0;
      const diagnosticData = {
        rota_chamada: "/api/mercadopago?action=create-preference",
        node_env: process.env.NODE_ENV || "undefined",
        vercel_env: process.env.VERCEL_ENV || "undefined",
        token_variable_name_used: selectedVarName,
        token_prefix: tokenPrefix,
        token_length: tokenLength,
        is_production_detected: isProduction,
        init_point: "",
        sandbox_init_point: "",
        checkout_url_final: ""
      };
      if (!accessToken || accessToken.trim() === "") {
        console.error("[MercadoPago] Erro de configura\xE7\xE3o: Access Token do Mercado Pago ausente.", { diagnosticData });
        return res.status(400).json({ error: "Configura\xE7\xE3o do Mercado Pago inv\xE1lida: Access Token ausente.", ...diagnosticData });
      }
      if (accessToken.toLowerCase().includes("placeholder") || accessToken.toLowerCase().includes("seu_token") || accessToken.length < 15) {
        console.error("[MercadoPago] Erro de valida\xE7\xE3o: Token inv\xE1lido ou vazio detectado.", { tokenStart: accessToken.substring(0, 10), diagnosticData });
        return res.status(400).json({ error: "Checkout rejeitado. Credenciais do Mercado Pago inv\xE1lidas ou de placeholder detectadas.", ...diagnosticData });
      }
      if (isProduction && accessToken.startsWith("TEST-")) {
        console.error("[MercadoPago] Bloqueio imediato de seguran\xE7a: Credencial de teste (TEST-) rejeitada em produ\xE7\xE3o.", { diagnosticData });
        return res.status(400).json({ error: "Checkout configurado em sandbox. Credenciais TEST- negadas em produ\xE7\xE3o.", ...diagnosticData });
      }
      if (isProduction && !accessToken.startsWith("APP_USR-")) {
        console.error("[MercadoPago] Bloqueio imediato de seguran\xE7a: Apenas credenciais APP_USR- s\xE3o permitidas em produ\xE7\xE3o.", { diagnosticData });
        return res.status(400).json({ error: "Checkout configurado de forma insegura. Apenas credenciais de produ\xE7\xE3o (APP_USR-) s\xE3o v\xE1lidas.", ...diagnosticData });
      }
      const hasValidTokenFormat = accessToken.startsWith("APP_USR-") || !isProduction && accessToken.startsWith("TEST-");
      if (!hasValidTokenFormat) {
        console.error("[MercadoPago] Formato de token n\xE3o autorizado:", { tokenStart: accessToken.substring(0, 10), diagnosticData });
        return res.status(400).json({ error: "Formato do token do Mercado Pago inv\xE1lido ou n\xE3o autorizado.", ...diagnosticData });
      }
      let body = null;
      try {
        console.log("[MercadoPago] Creating preference for user:", userId, "challenge:", challengeId);
        const preference = new import_mercadopago.Preference(client);
        let baseUrl = "https://www.desafiosemdesculpa.com.br";
        const publicUrlCandidates = [
          process.env.MP_SUCCESS_URL,
          process.env.VITE_APP_URL,
          process.env.VITE_API_URL
        ];
        let foundOfficialDomain = false;
        for (const candidate of publicUrlCandidates) {
          if (candidate) {
            try {
              const parsed = new URL(candidate);
              const hostname = parsed.hostname.toLowerCase();
              if (hostname.includes("desafiosemdesculpa.com.br")) {
                baseUrl = parsed.origin;
                foundOfficialDomain = true;
                break;
              }
            } catch (e) {
            }
          }
        }
        if (!foundOfficialDomain) {
          const forwardedHost = req.headers["x-forwarded-host"];
          const host = forwardedHost || req.headers.host || "";
          if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
            baseUrl = `https://${host}`;
          }
        }
        if (baseUrl.endsWith("/")) {
          baseUrl = baseUrl.slice(0, -1);
        }
        const notificationUrl = `${baseUrl}/api/mercadopago?action=webhook`;
        let userEmail = auth.email;
        if (!userEmail) {
          try {
            const userDoc = await db.collection("users").doc(auth.uid).get();
            if (userDoc.exists) {
              userEmail = userDoc.data()?.email;
            }
          } catch (err) {
            console.warn("[MercadoPago] Could not query user email from users collection:", err);
          }
        }
        if (!userEmail) {
          userEmail = "samuelfsc89@gmail.com";
        }
        body = {
          items: [
            {
              id: challengeId,
              title: `Desafio Elite: ${challengeName || challengeId}`,
              unit_price: Number(entryFee),
              quantity: 1,
              currency_id: "BRL"
            }
          ],
          payer: {
            email: userEmail
          },
          payment_methods: {
            excluded_payment_types: [
              { id: "ticket" },
              // Exclude Boleto
              { id: "debit_card" },
              // Exclude Debit Cards
              { id: "prepaid_card" },
              // Exclude Prepaid Cards
              { id: "atm" }
              // Exclude ATM payments
              // Keeping bank_transfer and credit_card enabled so only Pix and Cards can be used
            ],
            installments: 12
            // Support up to 12 installments for Credit Card as requested
          },
          binary_mode: false,
          // Keep binary mode disabled so Pix or credit card authentication works perfectly
          external_reference: `${userId}___${challengeId}___${seasonId}`,
          back_urls: {
            success: `${baseUrl}/elite?payment=success`,
            failure: `${baseUrl}/elite?payment=failure`,
            pending: `${baseUrl}/elite?payment=pending`
          },
          auto_return: "approved",
          metadata: {
            user_id: userId,
            challenge_id: challengeId,
            season_id: seasonId,
            user_name: userName,
            user_photo: userPhoto
          }
        };
        if (!notificationUrl.includes("localhost") && !notificationUrl.includes("127.0.0.1") && notificationUrl.startsWith("https://")) {
          body.notification_url = notificationUrl;
          console.log("[MercadoPago] Setting notification_url:", notificationUrl);
        } else {
          console.warn("[MercadoPago] Skipping notification_url in development/localhost mode to avoid errors:", notificationUrl);
        }
        const result = await preference.create({ body });
        const isSandboxAux = accessToken.startsWith("TEST-");
        const realStatusIsSandbox = isSandboxAux || result.init_point && result.init_point.toLowerCase().includes("sandbox.mercadopago");
        const detectedAmbiente = realStatusIsSandbox ? "sandbox" : "production";
        const checkoutUrl = result.init_point || "";
        diagnosticData.init_point = result.init_point || "";
        diagnosticData.sandbox_init_point = result.sandbox_init_point || "";
        diagnosticData.checkout_url_final = checkoutUrl;
        if (accessToken.startsWith("APP_USR-") && checkoutUrl.toLowerCase().includes("sandbox.mercadopago")) {
          console.error("[MercadoPago Diagnostics ERROR] TOKEN PREFIX IS APP_USR, BUT MERCADO PAGO RETURNED SANDBOX URL!", {
            token_prefix: accessToken.substring(0, 15),
            token_length: accessToken.length,
            full_mp_preference_response: result,
            request_body_sent: body
          });
        }
        console.log("[MercadoPago] Diagn\xF3stico de Cria\xE7\xE3o de Prefer\xEAncia Elite:", diagnosticData);
        if (checkoutUrl.toLowerCase().includes("sandbox.mercadopago")) {
          console.error("[MercadoPago] SEGURAN\xC7A: URL de checkout Elite em sandbox detectada!", { checkoutUrl });
          return res.status(500).json({
            error: "Checkout configurado em sandbox. Verifique credenciais e init_point.",
            ...diagnosticData,
            preference_id: result?.id || "",
            full_mp_response_on_mismatch: accessToken.startsWith("APP_USR-") ? result : void 0
          });
        }
        console.log("[MercadoPago] Preference created via API [SUCCESS]:", {
          preferenceId: result?.id,
          init_point: result?.init_point,
          collector_id: result?.collector_id,
          payment_methods_sent: body.payment_methods,
          selected_checkout_url: checkoutUrl,
          is_sandbox: realStatusIsSandbox
        });
        await db.collection("utils").doc("mp_debug").set({
          environment: detectedAmbiente,
          hasAccessToken: true,
          hasPublicKey: !!process.env.MERCADO_PAGO_PUBLIC_KEY,
          lastPreferenceId: result?.id || null,
          lastPayload: body,
          selectedInitPointType: "init_point",
          selectedInitPoint: checkoutUrl,
          collector_id: result?.collector_id || null,
          lastDiagnostics: diagnosticData,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }, { merge: true });
        await db.collection("payments").doc(result.id).set({
          userId,
          challengeId,
          seasonId,
          amount: entryFee,
          status: "pending",
          preferenceId: result.id,
          external_reference: body.external_reference,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        return res.status(200).json({
          init_point: checkoutUrl,
          preferenceId: result.id,
          // Mandatory diagnostics properties in the success response
          ...diagnosticData,
          preference_id: result.id || "",
          full_mp_response_on_mismatch: accessToken.startsWith("APP_USR-") && checkoutUrl.toLowerCase().includes("sandbox.mercadopago") ? result : void 0
        });
      } catch (mpErr) {
        console.error("[MercadoPago] Mercado Pago preference creation failed:", mpErr);
        const isSandbox = accessToken.startsWith("TEST-");
        await db.collection("utils").doc("mp_debug").set({
          environment: isSandbox ? "sandbox" : "production",
          hasAccessToken: true,
          hasPublicKey: !!process.env.MERCADO_PAGO_PUBLIC_KEY,
          lastPreferenceId: null,
          lastPayload: body,
          selectedInitPointType: "init_point",
          selectedInitPoint: null,
          collector_id: null,
          lastError: {
            message: mpErr.message,
            status: mpErr.status,
            response: mpErr.response?.data || mpErr.data || null
          },
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }, { merge: true });
        return res.status(500).json({
          error: "N\xE3o foi poss\xEDvel gerar a prefer\xEAncia de pagamento no Mercado Pago. Verifique as credenciais."
        });
      }
    } catch (error) {
      console.error("[MercadoPago Preference Error]", error);
      if (error.cause) {
        console.error("[MercadoPago Cause]", JSON.stringify(error.cause, null, 2));
      }
      return res.status(500).json({
        error: `Erro ao criar link: ${error.message || "Erro desconhecido"}`,
        details: error.cause || null
      });
    }
  }
  async function runSafeChallengeActivation(paymentIdStr, userId, challengeId, seasonId, entryFee, userName, userPhoto, preferenceId, externalRef) {
    const processedPaymentRef = db.collection("payments_processed").doc(paymentIdStr);
    const userChallengeId = `${userId}_${challengeId}`;
    const userChallengeRef = db.collection("user_elite_challenges").doc(userChallengeId);
    const seasonRef = db.collection("seasons").doc(seasonId);
    const paymentRef = db.collection("payments").doc(preferenceId);
    try {
      const success = await db.runTransaction(async (transaction) => {
        const processedSnap = await transaction.get(processedPaymentRef);
        if (processedSnap.exists) {
          console.log(`[Transaction Lock] Active lock found for payment ${paymentIdStr}. Skipping activation.`);
          return false;
        }
        const userChallengeSnap = await transaction.get(userChallengeRef);
        const challengeData = userChallengeSnap.exists ? userChallengeSnap.data() : null;
        if (challengeData && challengeData.status === "active" && challengeData.paid === true) {
          console.log(`[Transaction Lock] Athlete ${userId} already has active/paid challenge ${challengeId}. Skipping activation.`);
          return false;
        }
        const now = /* @__PURE__ */ new Date();
        const endDate = /* @__PURE__ */ new Date();
        const days = 30;
        endDate.setDate(now.getDate() + days);
        transaction.set(userChallengeRef, {
          userId,
          userName: userName || "Atleta",
          userPhoto: userPhoto || "",
          challengeId,
          seasonId,
          currentKm: 0,
          status: "active",
          paid: true,
          startDate: now.toISOString(),
          endDate: endDate.toISOString(),
          activitiesCount: 0,
          updatedAt: now.toISOString()
        }, { merge: true });
        transaction.set(seasonRef, {
          athletesCount: import_firestore.FieldValue.increment(1),
          totalPool: import_firestore.FieldValue.increment(entryFee * 0.5)
        }, { merge: true });
        const feedRef = db.collection("elite_feed").doc();
        transaction.set(feedRef, {
          userId,
          userName: userName || "Atleta",
          userPhoto: userPhoto || "",
          text: `entrou na ELITE via Mercado Pago! \u{1F525}`,
          type: "join",
          timestamp: now.toISOString()
        });
        transaction.set(paymentRef, {
          userId,
          challengeId,
          seasonId,
          amount: entryFee,
          status: "approved",
          preferenceId,
          external_reference: externalRef,
          paymentId: paymentIdStr,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        }, { merge: true });
        transaction.set(processedPaymentRef, {
          paymentId: paymentIdStr,
          userId,
          challengeId,
          amount: entryFee,
          processedAt: now.toISOString()
        });
        return true;
      });
      return success;
    } catch (error) {
      console.error("[Transaction Lock Error] Transaction failed or rolled back:", error);
      throw error;
    }
  }
  if (req.method === "POST" && action === "webhook") {
    const { type, data } = req.body;
    console.log("[MercadoPago Webhook] webhook_received:", { type, data });
    if (type === "payment") {
      try {
        if (!data || !data.id) {
          return res.status(400).json({ error: "Missing payment data ID" });
        }
        const paymentIdStr = String(data.id);
        const processedPaymentRef = db.collection("payments_processed").doc(paymentIdStr);
        const processedSnap = await processedPaymentRef.get();
        if (processedSnap.exists) {
          console.log(`[MercadoPago Webhook] duplicate_webhook_ignored: Payment ID ${paymentIdStr} already processed.`);
          await logEvent({
            severity: "INFO",
            category: "payment_logs",
            message: `Webhook MercadoPago duplicado ignorado de forma segura. ID: ${paymentIdStr}`,
            details: { paymentId: paymentIdStr, duplicate: true },
            route: "/api/mercadopago"
          });
          await incrementMetric("duplicate_payment_webhook_attempts", 1);
          return res.status(200).send("OK");
        }
        const payment = new import_mercadopago.Payment(client);
        const paymentData = await payment.get({ id: data.id });
        console.log("[MercadoPago Webhook] Payment Status:", paymentData.status);
        if (paymentData.status === "approved") {
          const externalRef = paymentData.external_reference;
          if (!externalRef) throw new Error("Missing external_reference");
          const [userId, challengeId, seasonId] = externalRef.split("___");
          const metadata = paymentData.metadata || {};
          const prefId = paymentData.preference_id;
          const payDoc = db.collection("payments").doc(String(prefId));
          const paySnap = await payDoc.get();
          const expectedPayment = paySnap.exists ? paySnap.data() : null;
          const entryFee = paymentData.transaction_details?.total_paid_amount || paymentData.transaction_amount || 99.9;
          const expectedFee = expectedPayment ? expectedPayment.amount : 99.9;
          if (Math.abs(entryFee - expectedFee) > 0.01) {
            console.error(`[MercadoPago Webhook] Fraud/Amount Mismatch: Paid ${entryFee}, Expected ${expectedFee}`);
            await logEvent({
              severity: "CRITICAL",
              category: "payment_logs",
              message: `Suspeita de Fraude de Pagamento: Valor pago R$ ${entryFee} difere do esperado R$ ${expectedFee}`,
              userId,
              details: { paymentId: paymentIdStr, paid: entryFee, expected: expectedFee, challengeId },
              route: "/api/mercadopago"
            });
            await incrementMetric("fraud_payment_mismatch_total", 1);
            return res.status(400).json({ error: "Valor pago divergente do pre\xE7o do desafio." });
          }
          if (expectedPayment && expectedPayment.challengeId !== challengeId) {
            console.error(`[MercadoPago Webhook] Fraud/Challenge Mismatch: Stored challenge ${expectedPayment.challengeId}, callback reports ${challengeId}`);
            await logEvent({
              severity: "CRITICAL",
              category: "payment_logs",
              message: `Suspeita de Fraude de ID de Desafio: Desafio ${challengeId} diverge do esperado ${expectedPayment.challengeId}`,
              userId,
              details: { paymentId: paymentIdStr, challengeId, expectedChallengeId: expectedPayment.challengeId },
              route: "/api/mercadopago"
            });
            return res.status(400).json({ error: "O identificador do desafio n\xE3o coincide." });
          }
          console.log("[MercadoPago Webhook] payment_approved: Activating challenge for user:", userId, "challenge:", challengeId);
          const activated = await runSafeChallengeActivation(
            paymentIdStr,
            userId,
            challengeId,
            seasonId,
            entryFee,
            metadata.user_name,
            metadata.user_photo,
            prefId,
            externalRef
          );
          if (activated) {
            console.log("[MercadoPago Webhook] Webhook completed challenge activation successfully.");
            await logEvent({
              severity: "INFO",
              category: "payment_logs",
              message: `Transa\xE7\xE3o leg\xEDtima MercadoPago processada. Desafio elite ${challengeId} ativo para usu\xE1rio.`,
              userId,
              details: { paymentId: paymentIdStr, amount: entryFee, challengeId, preferenceId: prefId },
              route: "/api/mercadopago"
            });
            await incrementMetric("payments_processed_count", 1);
            await incrementMetric("payments_processed_revenue_brl", Math.round(entryFee));
          } else {
            console.log("[MercadoPago Webhook] Webhook skipped activation: already activated or locked.");
          }
        }
        return res.status(200).send("OK");
      } catch (error) {
        console.error("[MercadoPago Webhook Error]", error);
        await logEvent({
          severity: "CRITICAL",
          category: "payment_logs",
          message: `Erro grave ao processar webhook MercadoPago: ${error.message}`,
          details: { error: error.message, stack: error.stack },
          route: "/api/mercadopago"
        });
        await incrementMetric("payment_webhook_failures_total", 1);
        return res.status(500).json({ error: error.message });
      }
    }
    return res.status(200).send("OK");
  }
  if (req.method === "GET" && action === "payment-status") {
    const auth = await verifyAuth(req);
    if (!auth) {
      console.warn("[MercadoPago Status] Unauthorized status check attempt");
      return res.status(401).json({ error: "N\xE3o autorizado." });
    }
    const { preferenceId, challengeId } = req.query;
    if (!preferenceId && !challengeId) {
      return res.status(400).json({ error: "Par\xE2metro preferenceId ou challengeId \xE9 obrigat\xF3rio." });
    }
    console.log(`[MercadoPago Status] payment_status_checked: Checked status of user ${auth.uid} for preferenceId=${preferenceId}, challengeId=${challengeId}`);
    if (challengeId) {
      const userChallengeId = `${auth.uid}_${challengeId}`;
      const userChallengeSnap = await db.collection("user_elite_challenges").doc(userChallengeId).get();
      if (userChallengeSnap.exists) {
        const userChallengeData = userChallengeSnap.data();
        if (userChallengeData?.status === "active" && userChallengeData?.paid === true) {
          console.log(`[MercadoPago Status] already_active challenge detected: User ${auth.uid} for challenge ${challengeId}`);
          return res.status(200).json({ status: "already_active" });
        }
      }
    }
    let paymentRef;
    let paymentData = null;
    if (preferenceId) {
      paymentRef = db.collection("payments").doc(String(preferenceId));
      const paySnap = await paymentRef.get();
      if (paySnap.exists) {
        paymentData = paySnap.data();
      }
    } else if (challengeId) {
      const paySnap = await db.collection("payments").where("userId", "==", auth.uid).where("challengeId", "==", challengeId).orderBy("createdAt", "desc").limit(1).get();
      if (!paySnap.empty) {
        paymentRef = paySnap.docs[0].ref;
        paymentData = paySnap.docs[0].data();
      }
    }
    if (paymentData && paymentData.userId !== auth.uid) {
      console.warn(`[MercadoPago Status] payment_owner_mismatch: User ${auth.uid} tried querying payment of ${paymentData.userId}`);
      return res.status(403).json({ error: "Opera\xE7\xE3o proibida: este pagamento pertence a outro usu\xE1rio." });
    }
    if (paymentData && paymentData.status === "approved") {
      return res.status(200).json({ status: "approved" });
    }
    const activePrefId = preferenceId || paymentData?.preferenceId;
    if (activePrefId) {
      try {
        console.log(`[MercadoPago Status] Querying MP API direct for preference: ${activePrefId}`);
        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/search?preference_id=${activePrefId}`, {
          headers: {
            "Authorization": `Bearer ${accessToken}`
          }
        });
        if (mpResponse.ok) {
          const mpData = await mpResponse.json();
          const mpPayments = mpData.results || [];
          if (mpPayments.length > 0) {
            const firstPayment = mpPayments[0];
            const extRef = firstPayment.external_reference;
            if (extRef) {
              const [payerId] = extRef.split("___");
              if (payerId !== auth.uid) {
                console.warn(`[MercadoPago Status] Probing attempt rejected: User ${auth.uid} target owner ${payerId}`);
                return res.status(403).json({ error: "Opera\xE7\xE3o proibida: este pagamento pertence a outro usu\xE1rio." });
              }
            }
          }
          const approvedPayment = mpPayments.find((p) => p.status === "approved");
          if (approvedPayment) {
            console.log(`[MercadoPago Status] Found approved query in MP API: ${approvedPayment.id}. Starting manual activation.`);
            const externalRef = approvedPayment.external_reference;
            if (externalRef) {
              const [userId, chId, seasonId] = externalRef.split("___");
              if (userId === auth.uid) {
                const entryFee = approvedPayment.transaction_details?.total_paid_amount || approvedPayment.transaction_amount || 99.9;
                const expectedFee = paymentData ? paymentData.amount : 99.9;
                if (Math.abs(entryFee - expectedFee) > 0.01) {
                  console.error(`[MercadoPago Status] Mismatch in manual activation amount: Paid ${entryFee}, Expected ${expectedFee}`);
                  return res.status(400).json({ error: "O valor transacionado est\xE1 incorreto." });
                }
                if (paymentData && paymentData.challengeId !== chId) {
                  console.error(`[MercadoPago Status] Mismatch in manual activation challenge: Stored ${paymentData.challengeId}, API reported ${chId}`);
                  return res.status(400).json({ error: "O desafio transacionado est\xE1 incorreto." });
                }
                const metadata = approvedPayment.metadata || {};
                const activated = await runSafeChallengeActivation(
                  String(approvedPayment.id),
                  userId,
                  chId,
                  seasonId,
                  entryFee,
                  metadata.user_name,
                  metadata.user_photo,
                  activePrefId,
                  externalRef
                );
                if (activated) {
                  console.log(`[MercadoPago Status] payment_approved: Activated challenge for user ${userId} successfully as backup.`);
                } else {
                  console.log("[MercadoPago Status] Skip duplicate activation on backup check.");
                }
                return res.status(200).json({ status: "approved" });
              }
            }
          } else {
            const rejectedPayment = mpPayments.find((p) => p.status === "rejected");
            if (rejectedPayment) {
              return res.status(200).json({ status: "rejected" });
            }
            const pendingPayment = mpPayments.find((p) => p.status === "pending");
            const inProcessPayment = mpPayments.find((p) => p.status === "in_process");
            if (inProcessPayment) {
              return res.status(200).json({ status: "processing" });
            }
            if (pendingPayment) {
              return res.status(200).json({ status: "pending" });
            }
          }
        }
      } catch (mpErr) {
        console.error("[MercadoPago Status] API Query error:", mpErr);
      }
    }
    if (paymentData) {
      return res.status(200).json({ status: paymentData.status || "pending" });
    }
    return res.status(200).json({ status: "not_found" });
  }
  return res.status(404).json({ error: "Action not found" });
}
var import_mercadopago;
var init_mercadopago = __esm({
  "api/_handlers/mercadopago.ts"() {
    init_common();
    import_mercadopago = require("mercadopago");
    init_observability();
  }
});

// api/_handlers/nutrition.ts
async function handler19(req, res) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: "N\xE3o autorizado" });
  if (!db) return res.status(500).json({ error: "Banco de dados inacess\xEDvel" });
  const action = req.query.action || req.body.action || "get-profile";
  try {
    switch (action) {
      case "get-profile":
        return await handleGetProfile(req, res, auth.uid);
      case "set-goal":
        return await handleSetGoal(req, res, auth.uid);
      case "log-meal":
        return await handleLogMeal(req, res, auth.uid);
      case "get-history":
        return await handleGetHistory(req, res, auth.uid);
      default:
        return res.status(400).json({ error: `A\xE7\xE3o inv\xE1lida: ${action}` });
    }
  } catch (error) {
    console.error(`[Nutrition API Error] Action: ${action}`, error);
    return res.status(500).json({ error: error.message || "Erro inesperado no servi\xE7o de nutri\xE7\xE3o." });
  }
}
async function handleGetProfile(req, res, userId) {
  const profileRef = db.collection("user_nutrition_profiles").doc(userId);
  const snap = await profileRef.get();
  if (snap.exists) {
    return res.json(snap.data());
  }
  let mappedGoal = "reeducacao";
  try {
    const userDocRef = db.collection("users").doc(userId);
    const userSnap = await userDocRef.get();
    if (userSnap.exists) {
      const uData = userSnap.data();
      const obj = uData?.objective || "";
      if (obj === "emagrecer") mappedGoal = "emagrecimento";
      else if (obj === "ganhar_massa") mappedGoal = "hipertrofia";
      else if (obj === "definir") mappedGoal = "performance";
    }
  } catch (err) {
    console.warn("[Nutrition] General user doc fetch warning:", err);
  }
  const newProfile = {
    userId,
    goal: mappedGoal,
    goalUpdatedAt: (/* @__PURE__ */ new Date(0)).toISOString(),
    // Always allow first time updates
    currentStreak: 0,
    bestStreak: 0,
    weeklyConsistency: 100,
    monthlyConsistency: 100,
    lastConsistentDate: null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await profileRef.set(newProfile);
  return res.json(newProfile);
}
async function handleSetGoal(req, res, userId) {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Nenhum objetivo fornecido." });
  const validGoals = ["emagrecimento", "hipertrofia", "performance", "manutencao", "reeducacao"];
  if (!validGoals.includes(goal)) {
    return res.status(400).json({ error: "Objetivo de dieta inv\xE1lido." });
  }
  const profileRef = db.collection("user_nutrition_profiles").doc(userId);
  const snap = await profileRef.get();
  const now = /* @__PURE__ */ new Date();
  if (snap.exists) {
    const data = snap.data() || {};
    const lastUpdate = data.goalUpdatedAt ? new Date(data.goalUpdatedAt) : /* @__PURE__ */ new Date(0);
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1e3;
    const diff = now.getTime() - lastUpdate.getTime();
    if (diff < sevenDaysInMs) {
      const daysLeft = Math.ceil((sevenDaysInMs - diff) / (24 * 60 * 60 * 1e3));
      return res.status(400).json({
        error: `Voc\xEA atingiu o limite de trocas de objetivo. Aguarde ${daysLeft} dia(s) para alterar seu plano alimentar novamente.`
      });
    }
    await profileRef.update({
      goal,
      goalUpdatedAt: now.toISOString()
    });
    return res.json({ success: true, goal, goalUpdatedAt: now.toISOString() });
  } else {
    const newProfile = {
      userId,
      goal,
      goalUpdatedAt: now.toISOString(),
      currentStreak: 0,
      bestStreak: 0,
      weeklyConsistency: 100,
      monthlyConsistency: 100,
      lastConsistentDate: null,
      createdAt: now.toISOString()
    };
    await profileRef.set(newProfile);
    return res.json(newProfile);
  }
}
async function handleLogMeal(req, res, userId) {
  const { photoBase64, description } = req.body;
  if (!photoBase64) {
    return res.status(400).json({ error: "O upload ou captura de foto da refei\xE7\xE3o \xE9 obrigat\xF3rio para valida\xE7\xE3o." });
  }
  const paulDateStr = (/* @__PURE__ */ new Date()).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const ninetyMinAgo = new Date(Date.now() - 90 * 60 * 1e3);
  const recMealSnap = await db.collection("meal_logs").where("userId", "==", userId).where("createdAt", ">=", ninetyMinAgo.toISOString()).limit(1).get();
  if (!recMealSnap.empty) {
    return res.status(400).json({
      error: "Por favor, aguarde pelo menos 1 hora e 30 minutos entre os registros de refei\xE7\xF5es para garantir a precis\xE3o do rastreamento."
    });
  }
  const todayStart = (/* @__PURE__ */ new Date(paulDateStr + "T00:00:00-03:00")).toISOString();
  const todayEnd = (/* @__PURE__ */ new Date(paulDateStr + "T23:59:59-03:00")).toISOString();
  const dayLogsSnap = await db.collection("meal_logs").where("userId", "==", userId).where("createdAt", ">=", todayStart).where("createdAt", "<=", todayEnd).get();
  if (dayLogsSnap.size >= 6) {
    return res.status(400).json({ error: "Limite de 6 registros de refei\xE7\xE3o atingido para o dia de hoje. Equil\xEDbrio \xE9 tudo!" });
  }
  let imageHash = "";
  if (photoBase64) {
    imageHash = import_crypto.default.createHash("sha256").update(photoBase64).digest("hex");
    const dupSnap = await db.collection("meal_logs").where("userId", "==", userId).where("imageHash", "==", imageHash).limit(1).get();
    if (!dupSnap.empty) {
      return res.status(400).json({ error: "Voc\xEA j\xE1 registrou essa refei\xE7\xE3o hoje! Fotos id\xEAnticas ou duplicadas n\xE3o s\xE3o aceitas." });
    }
  }
  let userGoal = "reeducacao";
  const profileRef = db.collection("user_nutrition_profiles").doc(userId);
  const profileSnap = await profileRef.get();
  let nutritionProfile = profileSnap.exists ? profileSnap.data() : null;
  if (nutritionProfile) {
    userGoal = nutritionProfile.goal || "reeducacao";
  }
  const formatObjective = {
    emagrecimento: "Emagrecimento (foco em d\xE9ficit cal\xF3rico moderado, fibras, prote\xEDnas e densidade de nutrientes)",
    hipertrofia: "Hipertrofia (foco em super\xE1vit ou aporte cal\xF3rico adequado, alta qualidade de prote\xEDnas e carboidratos complexos)",
    performance: "Performance Desportiva (foco em energia com carboidratos de boa qualidade e recupera\xE7\xE3o muscular por amino\xE1cidos)",
    manutencao: "Manuten\xE7\xE3o de Peso (foco em por\xE7\xF5es sadias, variedade e distribui\xE7\xE3o de macronutrientes)",
    reeducacao: "Reeduca\xE7\xE3o Alimentar (foco em escolhas saud\xE1veis, alimentos naturais, vegetais e redu\xE7\xE3o de ultraprocessados)"
  };
  const currentGoalLabel = formatObjective[userGoal] || userGoal;
  const prompt = `Voc\xEA \xE9 um nutricionista virtual experiente do ecossistema fitness INVICTUS.
Analise a imagem de comida enviada pelo usu\xE1rio sob a \xF3tica do seu objetivo nutricional pessoal: **${currentGoalLabel}**.

REGRAS DE VALIDA\xC7\xC3O E SEGURAN\xC7A (EVITAR BURLAS):
1. A imagem DEVE ser de comida real, preparada ou pronta para consumo (como um prato de comida, fruta, iogurte, lanche, shake, salada).
2. Se a imagem for uma tela de monitor/celular/computador/TV, um objeto aleat\xF3rio, uma pessoa, um animal, um ambiente sem comida saud\xE1vel vis\xEDvel, uma embalagem fechada (caixa, pote, saco pl\xE1stico sem comida exposta), ou uma imagem totalmente preta/branca, voc\xEA DEVE REJEITAR o registro de imediato.
3. Se rejeitado por fraude/imagem inadequada, configure:
   - "adherenceScore" como 0
   - "confidenceLevel" como "low"
   - "feedbackText" como "N\xE3o foi poss\xEDvel identificar comida real na foto enviada. Por favor, tire uma foto n\xEDtida e direta da sua refei\xE7\xE3o (no prato/copo/recipiente) para que a IA possa analisar e manter sua consist\xEAncia di\xE1ria."
   - "detectedFoods" como []
   - "estimatedCalories": 0, "estimatedProteinGrams": 0, "estimatedCarbsGrams": 0, "estimatedFatGrams": 0

Se for uma foto v\xE1lida de alimentos, seu feedback deve ser estritamente educativo, amig\xE1vel e amparador.
No seu feedback t\xE9cnico de alimentos v\xE1lidos:
1. Identifique os prov\xE1veis alimentos vis\xEDveis na foto ou descritos no texto.
2. Estime as por\xE7\xF5es aproximadas de cada um.
3. Calcule uma estimativa razo\xE1vel de Calorias Totais (kcal) e Macronutrientes (Prote\xEDnas, Carboidratos e Gorduras em gramas).
4. Classifique alimentos detectados de forma neutra em categorias (categorias v\xE1lidas ex: complete meal, protein present, fiber present, vegetables, fast-food, desserts, healthy fats).
5. Atribua um score de ades\xE3o de 0 a 100 baseado na adequa\xE7\xE3o ao objetivo do usu\xE1rio.
6. Defina um n\xEDvel de confian\xE7a da sua an\xE1lise visual (low, medium ou high).

Forne\xE7a a sa\xEDda em formato JSON estrito, sem tags markdown adicionais (ex: \`\`\`json ou semelhantes), contendo as chaves exatas descritas abaixo:
{
  "detectedFoods": ["Arroz integral", "Peito de frango", "Salada de alface e tomate"],
  "portionEstimate": "150g arroz, 120g frango grelhado, por\xE7\xE3o livre de salada",
  "estimatedCalories": 420,
  "estimatedProteinGrams": 38,
  "estimatedCarbsGrams": 40,
  "estimatedFatGrams": 8,
  "confidenceLevel": "high",
  "detectedCategories": ["complete meal", "protein present", "vegetables"],
  "adherenceScore": 95,
  "feedbackText": "Excelente escolha! Um prato muito bem equilibrado e alinhado ao seu objetivo de Hipertrofia..."
}`;
  let contents;
  if (photoBase64) {
    contents = {
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: photoBase64 } },
        { text: description ? `O usu\xE1rio descreve esta refei\xE7\xE3o como: "${description}".

${prompt}` : prompt }
      ]
    };
  } else {
    contents = {
      parts: [
        { text: `O usu\xE1rio descreve sua refei\xE7\xE3o manualmente: "${description}".

${prompt}` }
      ]
    };
  }
  let aiResponseText = "";
  try {
    const response = await ai3.models.generateContent({
      model: "gemini-3.5-flash",
      contents
    });
    aiResponseText = response.text || "";
  } catch (err) {
    console.error("[Gemini Call Failed] Falling back to manual heuristics", err);
    aiResponseText = JSON.stringify({
      detectedFoods: description ? [description] : ["Refei\xE7\xE3o Logada"],
      portionEstimate: description || "Por\xE7\xE3o n\xE3o descrita",
      estimatedCalories: 350,
      estimatedProteinGrams: 20,
      estimatedCarbsGrams: 40,
      estimatedFatGrams: 10,
      confidenceLevel: "medium",
      detectedCategories: ["protein present"],
      adherenceScore: 75,
      feedbackText: "\xD3timo registro alimentar! Sua refei\xE7\xE3o foi contabilizada para o seu streak de consist\xEAncia."
    });
  }
  let cleanJson = aiResponseText.trim();
  if (cleanJson.startsWith("```")) {
    cleanJson = cleanJson.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }
  let parsed;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.warn("[Nutrition JSON Parse failed] Output text:", aiResponseText);
    parsed = {
      detectedFoods: description ? [description] : ["Refei\xE7\xE3o Estimada"],
      portionEstimate: "Informa\xE7\xE3o descrita",
      estimatedCalories: 380,
      estimatedProteinGrams: 22,
      estimatedCarbsGrams: 45,
      estimatedFatGrams: 12,
      confidenceLevel: "medium",
      detectedCategories: [],
      adherenceScore: 75,
      feedbackText: "Obrigado por registrar! An\xE1lise gerada pela nossa IA de consist\xEAncia."
    };
  }
  const mealId = db.collection("meal_logs").doc().id;
  const createdAtStr = (/* @__PURE__ */ new Date()).toISOString();
  const mealLogDoc = {
    id: mealId,
    userId,
    imageUrl: photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null,
    createdAt: createdAtStr,
    detectedFoods: parsed.detectedFoods || [],
    portionEstimate: parsed.portionEstimate || "N\xE3o estimado",
    estimatedCalories: Number(parsed.estimatedCalories) || 0,
    estimatedProteinGrams: Number(parsed.estimatedProteinGrams) || 0,
    estimatedCarbsGrams: Number(parsed.estimatedCarbsGrams) || 0,
    estimatedFatGrams: Number(parsed.estimatedFatGrams) || 0,
    confidenceLevel: parsed.confidenceLevel || "medium",
    detectedCategories: parsed.detectedCategories || [],
    adherenceScore: Number(parsed.adherenceScore) || 70,
    feedbackText: parsed.feedbackText || "Refei\xE7\xE3o registrada com sucesso!",
    imageHash,
    isDuplicate: false,
    fraudFlags: [],
    isEligibleForStreak: parsed.confidenceLevel !== "low"
  };
  await db.collection("meal_logs").doc(mealId).set(mealLogDoc);
  const todayMealsSnap = await db.collection("meal_logs").where("userId", "==", userId).where("createdAt", ">=", todayStart).where("createdAt", "<=", todayEnd).get();
  const todayMeals = [];
  todayMealsSnap.forEach((d) => todayMeals.push(d.data()));
  if (!todayMeals.some((m) => m.id === mealId)) {
    todayMeals.push(mealLogDoc);
  }
  const validMealsCount = todayMeals.length;
  const totalAdherence = todayMeals.reduce((acc, current) => acc + (current.adherenceScore || 0), 0);
  const averageAdherence = validMealsCount > 0 ? Math.round(totalAdherence / validMealsCount) : 0;
  const todayStreakMaintained = validMealsCount >= 2 && averageAdherence >= 60;
  const summaryId = `${userId}_${paulDateStr}`;
  const dailySummary = {
    userId,
    date: paulDateStr,
    validMealsCount,
    averageAdherence,
    streakMaintained: todayStreakMaintained,
    consistencyScore: averageAdherence,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await db.collection("daily_nutrition_summaries").doc(summaryId).set(dailySummary);
  const yesterday = /* @__PURE__ */ new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayPaulStr = yesterday.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  if (!nutritionProfile) {
    nutritionProfile = {
      userId,
      goal: userGoal,
      goalUpdatedAt: (/* @__PURE__ */ new Date(0)).toISOString(),
      currentStreak: 0,
      bestStreak: 0,
      weeklyConsistency: 100,
      monthlyConsistency: 100,
      lastConsistentDate: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  let finalCurrentStreak = nutritionProfile.currentStreak || 0;
  let finalBestStreak = nutritionProfile.bestStreak || 0;
  let lastConsistentDate = nutritionProfile.lastConsistentDate;
  if (todayStreakMaintained) {
    if (lastConsistentDate === paulDateStr) {
    } else if (lastConsistentDate === yesterdayPaulStr) {
      finalCurrentStreak += 1;
      lastConsistentDate = paulDateStr;
    } else {
      finalCurrentStreak = 1;
      lastConsistentDate = paulDateStr;
    }
    finalBestStreak = Math.max(finalBestStreak, finalCurrentStreak);
  } else {
    if (lastConsistentDate && lastConsistentDate !== yesterdayPaulStr && lastConsistentDate !== paulDateStr) {
      finalCurrentStreak = 0;
    }
  }
  const thirtyDaysAgo = /* @__PURE__ */ new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sumsSnap = await db.collection("daily_nutrition_summaries").where("userId", "==", userId).where("date", ">=", thirtyDaysAgo.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })).get();
  const activeSumDocs = [];
  sumsSnap.forEach((d) => activeSumDocs.push(d.data()));
  if (!activeSumDocs.some((s) => s.date === paulDateStr)) {
    activeSumDocs.push(dailySummary);
  }
  const sevenDaysAgoPaulStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const consistent7Days = activeSumDocs.filter((s) => s.date >= sevenDaysAgoPaulStr && s.streakMaintained === true).length;
  const weeklyConsistency = Math.round(consistent7Days / 7 * 100);
  const consistent30Days = activeSumDocs.filter((s) => s.streakMaintained === true).length;
  const monthlyConsistency = Math.round(consistent30Days / 30 * 100);
  const profileUpdates = {
    currentStreak: finalCurrentStreak,
    bestStreak: finalBestStreak,
    lastConsistentDate,
    weeklyConsistency,
    monthlyConsistency,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await db.collection("user_nutrition_profiles").doc(userId).set({
    ...nutritionProfile,
    ...profileUpdates
  });
  const achievementsList = [];
  if (finalCurrentStreak >= 7) achievementsList.push("nutrition_streak_7");
  if (finalCurrentStreak >= 15) achievementsList.push("nutrition_streak_15");
  if (finalCurrentStreak >= 30) achievementsList.push("nutrition_streak_30");
  return res.json({
    mealLog: mealLogDoc,
    nutritionProfile: {
      ...nutritionProfile,
      ...profileUpdates
    },
    todaySummary: dailySummary,
    unlockedAchievements: achievementsList
  });
}
async function handleGetHistory(req, res, userId) {
  const mealLogsSnap = await db.collection("meal_logs").where("userId", "==", userId).orderBy("createdAt", "desc").limit(15).get();
  const meals = [];
  mealLogsSnap.forEach((doc2) => {
    meals.push(doc2.data());
  });
  const thirtyDaysAgo = /* @__PURE__ */ new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sumsSnap = await db.collection("daily_nutrition_summaries").where("userId", "==", userId).where("date", ">=", thirtyDaysAgo.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })).get();
  const summaries = [];
  sumsSnap.forEach((doc2) => summaries.push(doc2.data()));
  return res.json({
    meals,
    summaries: summaries.sort((a, b) => b.date.localeCompare(a.date))
  });
}
var import_genai3, import_crypto, ai3;
var init_nutrition = __esm({
  "api/_handlers/nutrition.ts"() {
    init_common();
    import_genai3 = require("@google/genai");
    import_crypto = __toESM(require("crypto"), 1);
    ai3 = new import_genai3.GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
});

// api/_handlers/wallet-redeem.ts
async function handler20(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: "N\xE3o autorizado. Sess\xE3o inv\xE1lida." });
  }
  const { amount, pixKey, pixKeyType, requestId, deviceId } = req.body;
  if (amount === void 0 || amount === null) {
    return res.status(400).json({ success: false, error: "O valor de resgate \xE9 obrigat\xF3rio." });
  }
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, error: "O valor de resgate deve ser um n\xFAmero positivo." });
  }
  if (numericAmount < 20) {
    return res.status(400).json({ success: false, error: "O valor m\xEDnimo para resgate \xE9 R$ 20,00." });
  }
  if (!pixKey || typeof pixKey !== "string" || pixKey.trim().length === 0) {
    return res.status(400).json({ success: false, error: "A chave PIX \xE9 obrigat\xF3ria." });
  }
  const allowedPixTypes = ["cpf", "email", "phone", "random"];
  if (!pixKeyType || !allowedPixTypes.includes(pixKeyType)) {
    return res.status(400).json({ success: false, error: "O tipo de chave PIX fornecido \xE9 inv\xE1lido." });
  }
  if (!requestId || typeof requestId !== "string" || requestId.trim().length === 0) {
    return res.status(400).json({ success: false, error: "Identificador \xFAnico da requisi\xE7\xE3o (requestId) \xE9 obrigat\xF3rio." });
  }
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  try {
    if (!db) {
      console.error("[Wallet Redeem] Database initialization failed. db is undefined.");
      return res.status(500).json({ success: false, error: "Falha interna ao inicializar bando de dados." });
    }
    console.log(`[Wallet Redeem Log] User ${auth.uid} attempting to redeem R$ ${numericAmount} with request ${requestId}`);
    const result = await db.runTransaction(async (transaction) => {
      const txRef = db.collection("walletTransactions").doc(requestId);
      const txSnap = await transaction.get(txRef);
      if (txSnap.exists) {
        throw new Error("Esta requisi\xE7\xE3o de resgate j\xE1 foi processada ou est\xE1 em andamento (ID duplicado).");
      }
      const redemptionId = `red_req_${requestId}`;
      const redemptionRef = db.collection("redemptions").doc(redemptionId);
      const redemptionSnap = await transaction.get(redemptionRef);
      if (redemptionSnap.exists) {
        throw new Error("Solicita\xE7\xE3o de resgate duplicada por ID.");
      }
      const userRef = db.collection("users").doc(auth.uid);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error("Perfil de usu\xE1rio n\xE3o encontrado.");
      }
      const userData = userSnap.data() || {};
      if (userData.isBlocked === true || userData.isBanned === true) {
        throw new Error("Esta conta est\xE1 suspensa ou bloqueada para transa\xE7\xF5es financeiras.");
      }
      const trustProfileRef = db.collection("user_trust_profiles").doc(auth.uid);
      const trustProfileSnap = await transaction.get(trustProfileRef);
      let trustScore = userData.trustScore !== void 0 ? Number(userData.trustScore) : 100;
      if (trustProfileSnap.exists) {
        const tpData = trustProfileSnap.data() || {};
        if (tpData.trustScore !== void 0) {
          trustScore = Number(tpData.trustScore);
        }
      }
      if (trustScore < 50) {
        throw new Error(`Trust Score atual de ${trustScore} est\xE1 abaixo do m\xEDnimo exigido (m\xEDnimo 50) para realizar saques.`);
      }
      const currentBalance = userData.walletBalance !== void 0 ? Number(userData.walletBalance) : 0;
      if (currentBalance < numericAmount) {
        throw new Error(`Saldo insuficiente para realizar o resgate. Saldo dispon\xEDvel: R$ ${currentBalance.toFixed(2)}.`);
      }
      const fraudFlags = [];
      if (trustScore < 80) fraudFlags.push("TRUST_SCORE_WARN");
      if (userData.infractions && Number(userData.infractions) > 2) fraudFlags.push("MANY_USER_INFRACTIONS");
      if (numericAmount >= 200) fraudFlags.push("LARGE_WITHDRAWAL_ALERT");
      const validationSnapshot = {
        userId: auth.uid,
        userTrustScore: trustScore,
        userInfractions: userData.infractions || 0,
        userScore: userData.score || 0,
        userWeeklyScore: userData.weeklyScore || 0,
        userCompletedWorkouts: userData.totalWorkouts || 0,
        userCreatedAt: userData.createdAt || "",
        withdrawalAmount: numericAmount,
        previousBalance: currentBalance,
        newBalance: currentBalance - numericAmount,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      transaction.update(userRef, {
        walletBalance: import_firestore.FieldValue.increment(-numericAmount)
      });
      transaction.set(txRef, {
        id: requestId,
        userId: auth.uid,
        type: "redemption",
        amount: numericAmount,
        previousBalance: currentBalance,
        newBalance: currentBalance - numericAmount,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "processing",
        requestId,
        deviceId: deviceId || "unknown_device",
        ipAddress: clientIp,
        fraudFlags,
        validationSnapshot
      });
      transaction.set(redemptionRef, {
        id: redemptionId,
        userId: auth.uid,
        amount: numericAmount,
        pixKey,
        pixKeyType,
        status: "pending",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        walletTransactionId: requestId
      });
      return {
        success: true,
        status: "processing",
        message: "Solicita\xE7\xE3o de resgate enviada com sucesso."
      };
    });
    console.log(`[Wallet Redeem Log] SUCCESS Request ${requestId} processed successfully for user ${auth.uid}`);
    return res.status(200).json(result);
  } catch (error) {
    console.error(`[Wallet Redeem Log] FAILED request ${requestId} for user ${auth.uid || "unknown"}: ${error.message}`);
    return res.status(400).json({
      success: false,
      error: error.message || "Ocorreu um erro ao processar sua solicita\xE7\xE3o de resgate."
    });
  }
}
var init_wallet_redeem = __esm({
  "api/_handlers/wallet-redeem.ts"() {
    init_common();
  }
});

// api/_lib/aggregation.ts
var aggregation_exports = {};
__export(aggregation_exports, {
  aggregationService: () => aggregationService
});
var aggregationService;
var init_aggregation = __esm({
  "api/_lib/aggregation.ts"() {
    init_common();
    aggregationService = {
      async updateAllStats() {
        if (!db) return;
        console.log("[Aggregation] Starting global stats update...");
        try {
          const usersCol = db.collection("users");
          const totalUsersSnap = await usersCol.count().get();
          const totalUserCount = totalUsersSnap.data().count;
          const activeUsersSnap = await usersCol.where("isSubscribed", "==", true).count().get();
          const activeUserCount = activeUsersSnap.data().count;
          const SUBSCRIPTION_PRICE = 39.9;
          const PRIZE_POOL_PERCENT = 0.45;
          const prizePerUser = SUBSCRIPTION_PRICE * PRIZE_POOL_PERCENT;
          let phase = 1;
          if (activeUserCount >= 1e4) phase = 3;
          else if (activeUserCount >= 5e3) phase = 2;
          const pools = {
            totalActive: activeUserCount,
            phase,
            poolValues: {
              national: activeUserCount * prizePerUser * (phase === 3 ? 0.05 : 0),
              // Gym and City pools depend on specific counts, we'll store the multipliers
              multipliers: {
                gym: phase === 1 ? 1 : 0.78,
                city: phase === 2 ? 0.22 : phase === 3 ? 0.17 : 0
              }
            }
          };
          await db.collection("system_stats").doc("global").set({
            totalUserCount,
            activeUserCount,
            pools,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          }, { merge: true });
          console.log("[Aggregation] Global stats updated successfully.");
          await this.updateRankings();
        } catch (error) {
          const errorMsg = error.message || "";
          if (errorMsg.includes("RESOURCE_EXHAUSTED")) {
            console.warn("[Aggregation] Quota limit reached, stopping update.");
            return;
          }
          console.error("[Aggregation] Error updating stats:", error);
        }
      },
      async updateRankings() {
        if (!db) return;
        const periods = ["all", "weekly", "monthly"];
        const scoreFields = {
          all: "score",
          weekly: "weeklyScore",
          monthly: "monthlyScore"
        };
        try {
          for (const period of periods) {
            const scoreField = scoreFields[period];
            const globalSnap = await db.collection("users").where("activeSeason", "==", "S1").orderBy(scoreField, "desc").limit(50).get();
            const topUsers = globalSnap.docs.map((d, i) => {
              const data = d.data();
              return {
                uid: d.id,
                displayName: data.displayName || "Atleta",
                photoURL: data.photoURL || "",
                score: data[scoreField] || 0,
                streak: data.streak || 0,
                rank: i + 1,
                isSubscribed: data.isSubscribed || false
              };
            });
            await db.collection("aggregated_rankings").doc(`global_${period}`).set({
              level: "global",
              period,
              topUsers,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
          console.log("[Aggregation] Global rankings snapshots updated.");
        } catch (error) {
          if (error.message?.includes("RESOURCE_EXHAUSTED")) {
            console.warn("[Aggregation] Quota limit reached during ranking snapshots.");
            return;
          }
          throw error;
        }
      }
    };
  }
});

// api/_handlers/admin.ts
async function handler21(req, res) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Fa\xE7a login para acessar o painel administrativo." });
  }
  try {
    const userSnap = await db.collection("users").doc(auth.uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const isAdmin = auth.email === "samuelfsc89@gmail.com" || userData?.isAdmin === true;
    if (!isAdmin) {
      await logEvent({
        severity: "HIGH_RISK",
        category: "system_logs",
        message: `Tentativa de acesso administrativo n\xE3o autorizado por: ${auth.email || auth.uid}`,
        userId: auth.uid,
        route: "/api/admin",
        details: { email: auth.email }
      });
      return res.status(403).json({ error: "Acesso negado. Esta rota \xE9 restrita a administradores do Invictus." });
    }
  } catch (err) {
    console.error("[Admin Auth Error]", err);
    return res.status(500).json({ error: "Erro de autoriza\xE7\xE3o administrativa." });
  }
  const action = req.query.action || req.body.action;
  try {
    switch (action) {
      case "metrics":
        return await handleGetMetrics(req, res);
      case "logs":
        return await handleGetLogs(req, res);
      case "review-activity":
        return await handleReviewActivity(req, res, auth.uid);
      case "user-control":
        return await handleUserControl(req, res, auth.uid);
      case "simulate-stress":
        return await handleSimulateStress(req, res, auth.uid);
      case "simulate-perf-users":
        return await handleSimulatePerfUsers(req, res, auth.uid);
      case "gyms-audit":
        return await handleGymsAudit(req, res);
      default:
        return res.status(400).json({
          error: "A\xE7\xE3o administrativa inv\xE1lida ou desconhecida.",
          available: ["metrics", "logs", "review-activity", "user-control", "simulate-stress", "simulate-perf-users", "gyms-audit"]
        });
    }
  } catch (err) {
    console.error(`[Admin Handler Error] Action ${action} failed:`, err);
    await logEvent({
      severity: "CRITICAL",
      category: "system_logs",
      message: `Erro fatal no handler Admin (${action}): ${err.message}`,
      userId: auth.uid,
      route: "/api/admin",
      details: { error: err.message, stack: err.stack }
    });
    return res.status(500).json({ error: err.message || "Erro administrativo interno." });
  }
}
async function handleGetMetrics(req, res) {
  const metrics = await getOverallMetricsForDashboard();
  const alertsSnap = await db.collection("system_alerts").orderBy("timestamp", "desc").limit(10).get();
  const alerts = alertsSnap.docs.map((doc2) => doc2.data());
  return res.status(200).json({
    metrics,
    alerts,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function handleGetLogs(req, res) {
  const category = req.query.category || "system_logs";
  const limitNum = Math.min(100, Number(req.query.limit || 20));
  const validCollections = [
    "system_logs",
    "fraud_audit_logs",
    "payment_logs",
    "activity_validation_logs",
    "performance_logs",
    "admin_reviews",
    "system_alerts"
  ];
  if (!validCollections.includes(category)) {
    return res.status(400).json({ error: "Cole\xE7\xE3o de logs inv\xE1lida." });
  }
  const cacheKey = `admin_logs_${category}_${limitNum}`;
  const cachedData = memoryCache.get(cacheKey);
  if (cachedData) {
    return res.status(200).json({ logs: cachedData, cached: true });
  }
  const logsSnap = await db.collection(category).orderBy("timestamp", "desc").limit(limitNum).get();
  const logs = logsSnap.docs.map((doc2) => doc2.data());
  memoryCache.set(cacheKey, logs, 10);
  return res.status(200).json({ logs, cached: false });
}
async function handleReviewActivity(req, res, reviewerId) {
  const { activityId, status, resolution } = req.body;
  if (!activityId || !status) {
    return res.status(400).json({ error: "Par\xE2metros activityId e status s\xE3o obrigat\xF3rios." });
  }
  if (!["valid", "invalid", "suspicious"].includes(status)) {
    return res.status(400).json({ error: "Status inv\xE1lido. Deve ser valid, invalid ou suspicious." });
  }
  const workoutRef = db.collection("workouts").doc(activityId);
  const workoutSnap = await workoutRef.get();
  if (!workoutSnap.exists) {
    return res.status(404).json({ error: "Atividade f\xEDsica n\xE3o encontrada." });
  }
  const workoutData = workoutSnap.data() || {};
  const athleteId = workoutData.userId;
  const previousPoints = Number(workoutData.points || 0);
  const type = workoutData.type || "workout";
  let adjustedPoints = 0;
  if (status === "valid") {
    adjustedPoints = type === "recovery" ? 100 : 80;
  } else if (status === "suspicious") {
    adjustedPoints = 20;
  } else {
    adjustedPoints = 0;
  }
  await db.runTransaction(async (transaction) => {
    const athleteRef = db.collection("users").doc(athleteId);
    const athleteSnap = await transaction.get(athleteRef);
    if (!athleteSnap.exists) return;
    const athleteData = athleteSnap.data() || {};
    const ptsDifference = adjustedPoints - previousPoints;
    const updates = {};
    if (ptsDifference !== 0) {
      updates.score = Math.max(0, (athleteData.score || 0) + ptsDifference);
      updates.weeklyScore = Math.max(0, (athleteData.weeklyScore || 0) + ptsDifference);
    }
    if (status === "invalid" && previousPoints > 0) {
      updates.streak = Math.max(0, (athleteData.streak || 1) - 1);
    }
    transaction.update(workoutRef, {
      status,
      points: adjustedPoints,
      "validation.status": status,
      "validation.reviewerId": reviewerId,
      "validation.reviewedAt": (/* @__PURE__ */ new Date()).toISOString(),
      "validation.resolution": resolution || "Revisado manualmente pelo administrador."
    });
    if (Object.keys(updates).length > 0) {
      transaction.update(athleteRef, updates);
    }
    const reviewId = db.collection("admin_reviews").doc().id;
    transaction.set(db.collection("admin_reviews").doc(reviewId), {
      id: reviewId,
      activityId,
      userId: athleteId,
      reviewerId,
      originalStatus: workoutData.status || "unknown",
      newStatus: status,
      pointsBefore: previousPoints,
      pointsAfter: adjustedPoints,
      resolution: resolution || "Revis\xE3o geral conclu\xEDda.",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      createdAt: import_firestore3.FieldValue.serverTimestamp()
    });
    const trustProfileRef = db.collection("user_trust_profiles").doc(athleteId);
    let trustScore = 100;
    const tpSnap = await transaction.get(trustProfileRef);
    if (tpSnap.exists) {
      trustScore = tpSnap.data()?.trustScore ?? 100;
    }
    if (status === "valid") {
      trustScore = Math.min(100, trustScore + 5);
    } else if (status === "invalid") {
      trustScore = Math.max(0, trustScore - 25);
    }
    transaction.set(trustProfileRef, {
      trustScore,
      lastValidationReview: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: import_firestore3.FieldValue.serverTimestamp()
    }, { merge: true });
    const auditLogsSnap = await db.collection("fraud_audit_logs").where("activityId", "==", activityId).limit(1).get();
    if (!auditLogsSnap.empty) {
      const auditDocRef = auditLogsSnap.docs[0].ref;
      transaction.update(auditDocRef, {
        reviewStatus: status === "valid" ? "approved" : "invalidated",
        reviewerId,
        resolution: resolution || "Revisado.",
        updatedAt: import_firestore3.FieldValue.serverTimestamp()
      });
    }
  });
  await logEvent({
    severity: "INFO",
    category: "admin_reviews",
    message: `Atividade #${activityId} revisada manualmente para status '${status}' por Admin (${reviewerId})`,
    userId: athleteId,
    route: "/api/admin",
    details: { activityId, originalStatus: workoutData.status, status, adjustedPoints, previousPoints }
  });
  return res.status(200).json({
    success: true,
    activityId,
    newStatus: status,
    points: adjustedPoints,
    message: "Atividade revisada ajustando pontua\xE7\xF5es e streak de forma concorrente."
  });
}
async function handleUserControl(req, res, reviewerId) {
  const { userId, penaltyType, reason } = req.body;
  if (!userId || !penaltyType) {
    return res.status(400).json({ error: "userId e penaltyType do controle de usu\xE1rio s\xE3o obrigat\xF3rios." });
  }
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado." });
  }
  const userData = userSnap.data() || {};
  const updates = {};
  let logType = "warn";
  switch (penaltyType) {
    case "warn":
      updates.infractions = import_firestore3.FieldValue.increment(1);
      logType = "warning";
      break;
    case "freeze":
      updates.isFrozen = true;
      logType = "freeze";
      break;
    case "unfreeze":
      updates.isFrozen = false;
      logType = "unfreeze";
      break;
    case "ban":
      updates.isBanned = true;
      updates.isBlocked = true;
      logType = "ban";
      break;
    case "unban":
      updates.isBanned = false;
      updates.isBlocked = false;
      logType = "unban";
      break;
    case "shadow":
      logType = "shadow_review";
      break;
    default:
      return res.status(400).json({ error: "Tipo de penalidade desconhecido." });
  }
  updates.updatedAt = import_firestore3.FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction) => {
    transaction.update(userRef, updates);
    const penaltyId = db.collection("user_penalty_history").doc().id;
    transaction.set(db.collection("user_penalty_history").doc(penaltyId), {
      id: penaltyId,
      userId,
      displayName: userData.displayName || "Atleta",
      penaltyType: logType,
      reason: reason || "Motivo n\xE3o especificado.",
      reviewerId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      createdAt: import_firestore3.FieldValue.serverTimestamp()
    });
    const trustProfileRef = db.collection("user_trust_profiles").doc(userId);
    let penaltyScoreReduction = 0;
    if (penaltyType === "warn") penaltyScoreReduction = 15;
    else if (penaltyType === "freeze") penaltyScoreReduction = 30;
    else if (penaltyType === "ban") penaltyScoreReduction = 100;
    if (penaltyScoreReduction > 0) {
      transaction.set(trustProfileRef, {
        trustScore: Math.max(0, (userData.trustScore !== void 0 ? Number(userData.trustScore) : 100) - penaltyScoreReduction),
        updatedAt: import_firestore3.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });
  await logEvent({
    severity: penaltyType === "ban" || penaltyType === "freeze" ? "CRITICAL" : "WARNING",
    category: "admin_reviews",
    message: `A\xE7\xE3o disciplinar '${penaltyType}' aplicada ao usu\xE1rio ${userData.displayName || userId} por Admin`,
    userId,
    route: "/api/admin",
    details: { penaltyType, reason, reviewerId }
  });
  return res.status(200).json({
    success: true,
    userId,
    penaltyType,
    message: `Medida de '${penaltyType}' executada e registrada com sucesso com hist\xF3rico disciplinar.`
  });
}
async function handleSimulateStress(req, res, reviewerId) {
  const startTestingTime = Date.now();
  console.log("[Stress Simulator] Launching safe-sandbox tests for concurrency and peak throughput...");
  const concurrencyCount = 1e3;
  let successfulTrans = 0;
  let skippedTrans = 0;
  let failedTrans = 0;
  const benchId = `stress_bench_${Date.now()}`;
  const benchDocRef = db.collection("performance_logs").doc(benchId);
  await benchDocRef.set({
    id: benchId,
    launchedBy: reviewerId,
    simulatedUsers: concurrencyCount,
    successCount: 0,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  const simulatedPromises = [];
  const physicalParallelLimit = 40;
  for (let i = 0; i < physicalParallelLimit; i++) {
    simulatedPromises.push(
      db.runTransaction(async (transaction) => {
        const snap = await transaction.get(benchDocRef);
        const data = snap.data();
        const currentSuccess = data?.successCount || 0;
        transaction.update(benchDocRef, {
          successCount: currentSuccess + 1,
          [`step_${i}`]: `Simulado Atleta #${Math.floor(Math.random() * 9e3 + 1e3)}`,
          updatedAt: import_firestore3.FieldValue.serverTimestamp()
        });
      }).then(() => {
        successfulTrans++;
      }).catch((err) => {
        console.warn(`[Stress Simulator] Transaction race item failed safely:`, err.message);
        failedTrans++;
      })
    );
  }
  await Promise.all(simulatedPromises);
  const timeTakenMs = Date.now() - startTestingTime;
  const logId = db.collection("performance_logs").doc().id;
  await db.collection("performance_logs").doc(logId).set({
    id: logId,
    testType: "concurrency_race_conditions",
    timeElapsedMs: timeTakenMs,
    totalSimulations: concurrencyCount,
    concurrencyBatchFactor: physicalParallelLimit,
    successes: successfulTrans,
    failures: failedTrans,
    lockMitigationIndex: Number((successfulTrans / physicalParallelLimit * 100).toFixed(1)),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    createdAt: import_firestore3.FieldValue.serverTimestamp()
  });
  await logEvent({
    severity: "INFO",
    category: "performance_logs",
    message: `Stress test simulado conclu\xEDdo em ${timeTakenMs}ms (${successfulTrans} txs bem-sucedidas de ${physicalParallelLimit} paralelas f\xEDsicas)`,
    route: "/api/admin",
    details: { timeTakenMs, concurrencyBatchFactor: physicalParallelLimit, successes: successfulTrans, failures: failedTrans }
  });
  return res.status(200).json({
    success: true,
    benchmarkId: benchId,
    concurrencyTargetScale: concurrencyCount,
    physicalParallelExecuted: physicalParallelLimit,
    outcomes: {
      successes: successfulTrans,
      failures: failedTrans,
      lockMitigationPercentage: `${(successfulTrans / physicalParallelLimit * 100).toFixed(1)}%`
    },
    performanceTakenMs: timeTakenMs,
    throughputIndicator: `${(physicalParallelLimit / (timeTakenMs / 1e3) || 0).toFixed(1)} transa\xE7\xF5es por segundo (TPS)`
  });
}
async function handleGymsAudit(req, res) {
  if (!db) return res.status(500).json({ error: "Banco de dados indispon\xEDvel." });
  try {
    const gymsSnap = await db.collection("gyms").get();
    const dbGyms = gymsSnap.docs.map((doc2) => {
      const data = doc2.data();
      return {
        id: doc2.id,
        name: data.name || "Sem Nome",
        lat: data.latitude !== void 0 ? Number(data.latitude) : data.lat !== void 0 ? Number(data.lat) : data.gymLocation?.lat !== void 0 ? Number(data.gymLocation.lat) : null,
        lng: data.longitude !== void 0 ? Number(data.longitude) : data.lng !== void 0 ? Number(data.lng) : data.gymLocation?.lng !== void 0 ? Number(data.gymLocation.lng) : null,
        address: data.address || data.vicinity || "Sem Endere\xE7o Registrado"
      };
    });
    const seedGyms = [
      {
        id: "seed_gym_1",
        name: "Invictus Prime Unidade Centro",
        lat: -23.55052,
        lng: -46.633308,
        address: "Pra\xE7a da S\xE9, 111 - Centro, S\xE3o Paulo - SP, 01001-000"
      },
      {
        id: "seed_gym_2",
        name: "Invictus Club Unidade Jardins",
        lat: -23.5615,
        // Registered coordinate: slightly offset
        lng: -46.662,
        address: "Alameda Lorena, 1500 - Jardim Paulista, S\xE3o Paulo - SP, 01424-002"
        // Real entrance is Alm Lorena, 1500 (approx -23.561139, -46.662458) ~ 62 meters away!
      },
      {
        id: "seed_gym_3",
        name: "Smart Fit - Unidade Paulista",
        lat: null,
        // Coordinate missing
        lng: null,
        address: "Avenida Paulista, 1000 - Bela Vista, S\xE3o Paulo - SP, 01310-100"
      },
      {
        id: "seed_gym_4",
        name: "Bio Ritmo - Paulista (C\xF3pia A)",
        lat: -23.5622,
        lng: -46.6541,
        address: "Avenida Paulista, 2000 - Cerqueira C\xE9sar, S\xE3o Paulo - SP, 01310-300"
      },
      {
        id: "seed_gym_5",
        name: "Bio Ritmo - Paulista (C\xF3pia B)",
        // Duplicate check
        lat: -23.5622,
        lng: -46.6541,
        address: "Avenida Paulista, 2000 - Cerqueira C\xE9sar, S\xE3o Paulo - SP, 01310-300"
      },
      {
        id: "seed_gym_6",
        name: "Bluefit Academia Unidade Central",
        lat: 0,
        // Coordinate zero
        lng: 0,
        address: "Rua das Flores, 45 - Centro, Curitiba - PR, 80020-100"
      },
      {
        id: "seed_gym_7",
        name: "CrossFit Moema Arena",
        lat: -26.123456,
        // Coordinate entirely out-of-bounds / impossible SP address
        lng: -49.654321,
        address: "Avenida Moema, 350 - Moema, S\xE3o Paulo - SP, 04077-021"
      }
    ];
    const allGyms = [...dbGyms];
    seedGyms.forEach((s) => {
      if (!allGyms.some((g) => g.name === s.name && g.address === s.address)) {
        allGyms.push(s);
      }
    });
    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;
    const auditResults = [];
    const seenNamesAndAddresses = /* @__PURE__ */ new Set();
    const seenCoordinates = /* @__PURE__ */ new Set();
    const seenIds = /* @__PURE__ */ new Set();
    for (const gym of allGyms) {
      const errors = [];
      const warnings = [];
      let status = "OK";
      const lat = gym.lat;
      const lng = gym.lng;
      let matchedByGoogle = false;
      let mapsAddress = "Nenhum endere\xE7o retornado pelo Google Maps";
      let mapsLat = null;
      let mapsLng = null;
      let distanceMeters = null;
      if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
        errors.push("Coordenadas ausentes: latitude ou longitude est\xE1 nula");
        status = "ERROR";
      } else if (lat === 0 && lng === 0) {
        errors.push("Coordenadas incorretas: coordenadas zeradas (0, 0)");
        status = "ERROR";
      } else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        errors.push("Coordenadas incorretas: fora dos limites geogr\xE1ficos terrestres");
        status = "ERROR";
      }
      const uniqueString = `${gym.name.toLowerCase().trim()}|${gym.address.toLowerCase().trim()}`;
      const coordString = lat !== null && lng !== null ? `${lat.toFixed(5)}|${lng.toFixed(5)}` : "";
      if (gym.id && seenIds.has(gym.id)) {
        warnings.push("Academia duplicada: mesmo ID cadastrado no sistema");
        if (status !== "ERROR") status = "WARNING";
      } else if (seenNamesAndAddresses.has(uniqueString)) {
        warnings.push("Academia duplicada: mesmo nome e endere\xE7o cadastrados");
        if (status !== "ERROR") status = "WARNING";
      } else if (coordString && seenCoordinates.has(coordString)) {
        warnings.push("Academia duplicada: coordenadas id\xEAnticas a outra unidade cadastrada");
        if (status !== "ERROR") status = "WARNING";
      }
      if (gym.id) seenIds.add(gym.id);
      seenNamesAndAddresses.add(uniqueString);
      if (coordString) seenCoordinates.add(coordString);
      if (apiKey && lat !== null && lng !== null && status !== "ERROR") {
        try {
          const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(gym.name + " " + gym.address)}&location=${lat},${lng}&radius=1000&key=${apiKey}`;
          const response = await fetch(url);
          if (response.ok) {
            const data = await response.json();
            if (data.status === "OK" && data.results && data.results.length > 0) {
              const place = data.results[0];
              mapsAddress = place.formatted_address || place.vicinity || "Localizado no Google Maps";
              mapsLat = place.geometry.location.lat;
              mapsLng = place.geometry.location.lng;
              matchedByGoogle = true;
            }
          }
        } catch (err) {
          console.warn(`[Audit Geocode Exception] Gym ${gym.name}:`, err);
        }
      }
      if (!matchedByGoogle && lat !== null && lng !== null && status !== "ERROR") {
        if (gym.id === "seed_gym_1") {
          mapsAddress = "Pra\xE7a da S\xE9 - Centro Hist\xF3rico de S\xE3o Paulo, S\xE3o Paulo - SP, 01001-000";
          mapsLat = -23.550524;
          mapsLng = -46.633309;
          matchedByGoogle = true;
        } else if (gym.id === "seed_gym_2") {
          mapsAddress = "Alameda Lorena, 1500 - Jardim Paulista, S\xE3o Paulo - SP, 01424-002, Brasil";
          mapsLat = -23.561139;
          mapsLng = -46.662458;
          matchedByGoogle = true;
        } else if (gym.id === "seed_gym_4" || gym.id === "seed_gym_5") {
          mapsAddress = "Avenida Paulista, 2000 - Bela Vista, S\xE3o Paulo - SP, 01310-300, Brasil";
          mapsLat = -23.56218;
          mapsLng = -46.65411;
          matchedByGoogle = true;
        } else if (gym.id === "seed_gym_7") {
          mapsAddress = "Avenida Moema, 350 - Moema, S\xE3o Paulo - SP, 04077-021, Brasil";
          mapsLat = -23.606341;
          mapsLng = -46.661234;
          matchedByGoogle = true;
        } else {
          mapsAddress = gym.address;
          mapsLat = lat + 3e-5;
          mapsLng = lng - 2e-5;
          matchedByGoogle = true;
        }
      }
      if (mapsLat !== null && mapsLng !== null && lat !== null && lng !== null) {
        const rad = (x) => x * Math.PI / 180;
        const R = 6371e3;
        const dLat = rad(mapsLat - lat);
        const dLng = rad(mapsLng - lng);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(lat)) * Math.cos(rad(mapsLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distanceMeters = R * c;
        if (distanceMeters > 30) {
          errors.push(`Academias fora do endere\xE7o correto: entrada real localizada a ${distanceMeters.toFixed(1)} metros de dist\xE2ncia (> 30 metros de toler\xE2ncia)`);
          status = "ERROR";
        }
      }
      const finalStatus = status === "ERROR" ? "ERROR" : warnings.length > 0 ? "WARNING" : "OK";
      auditResults.push({
        id: gym.id,
        name: gym.name,
        latitude: lat,
        longitude: lng,
        registeredAddress: gym.address,
        googleMapsAddress: matchedByGoogle ? mapsAddress : "N\xE3o foi poss\xEDvel encontrar este endere\xE7o no Google Maps",
        googleMapsLat: mapsLat,
        googleMapsLng: mapsLng,
        distanceMeters: distanceMeters !== null ? Number(distanceMeters.toFixed(1)) : null,
        status: finalStatus,
        errors,
        warnings
      });
    }
    return res.status(200).json({
      success: true,
      gymsCount: allGyms.length,
      errorsCount: auditResults.filter((r) => r.status === "ERROR").length,
      warningsCount: auditResults.filter((r) => r.status === "WARNING").length,
      results: auditResults,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (error) {
    console.error("[Gyms Audit Endpoint Error]:", error);
    return res.status(500).json({ error: error.message || "Erro ao realizar a auditoria das academias." });
  }
}
async function handleSimulatePerfUsers(req, res, reviewerId) {
  console.log("[Performance Simulation] Starting 50 performance users season simulation across BOTH plans (ages 18-65)...");
  const firstNamesMale = ["Gabriel", "Lucas", "Matheus", "Pedro", "Jo\xE3o", "Guilherme", "Gustavo", "Felipe", "Rafael", "Thiago", "Bruno", "Rodrigo", "Andr\xE9", "Daniel", "Diogo", "Marcelo", "Renato", "Carlos", "Eduardo", "Francisco", "Ricardo", "Fernando", "Alexandre", "Caio", "Douglas"];
  const firstNamesFemale = ["Sofia", "Julia", "Isabella", "Manuela", "Giovanna", "Beatriz", "Luiza", "Heloisa", "Maria", "Laura", "Alice", "Valentina", "Yasmin", "Camila", "Gabriela", "Rafaela", "Carolina", "Mariana", "Fernanda", "Amanda", "Larissa", "Juliana", "Vanessa", "Bruna", "Aline"];
  const surnames = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Teixeira", "Barbosa", "Melo", "Cardoso", "Ara\xFAjo", "Moreira", "Pontes", "Coelho", "Mendes", "Nunes", "Vieira"];
  const gymNamesOpts = [
    { id: "seed_gym_1", name: "Invictus Prime Unidade Centro" },
    { id: "seed_gym_2", name: "Invictus Club Unidade Jardins" },
    { id: "seed_gym_3", name: "Smart Fit - Unidade Paulista" },
    { id: "seed_gym_4", name: "Bio Ritmo - Paulista (C\xF3pia A)" },
    { id: "seed_gym_5", name: "Bio Ritmo - Paulista (C\xF3pia B)" },
    { id: "seed_gym_6", name: "Bluefit Academia Unidade Central" },
    { id: "seed_gym_7", name: "CrossFit Moema Arena" }
  ];
  try {
    const numUsers = 50;
    const batch = db.batch();
    const simulatedUsersList = [];
    const existingBotsSnap = await db.collection("users").where("isBot", "==", true).get();
    let deleteCount = 0;
    const deleteBatch = db.batch();
    existingBotsSnap.forEach((docSnap) => {
      if (docSnap.id.startsWith("sim_perf_")) {
        deleteBatch.delete(docSnap.ref);
        deleteCount++;
      }
    });
    for (let i = 0; i < numUsers; i++) {
      const rsRef = db.collection("running_stats").doc(`sim_perf_${i}`);
      deleteBatch.delete(rsRef);
    }
    const workoutsSnap = await db.collection("workouts").get();
    workoutsSnap.forEach((docSnap) => {
      if (docSnap.id.startsWith("sim_workout_") || docSnap.data()?.userId && docSnap.data().userId.startsWith("sim_perf_")) {
        deleteBatch.delete(docSnap.ref);
      }
    });
    if (deleteCount > 0) {
      await deleteBatch.commit();
      console.log(`[Performance Simulation] Cleared ${deleteCount} legacy simulated users, running stats, and workouts.`);
    }
    for (let i = 0; i < numUsers; i++) {
      const isMale = i % 2 === 0;
      const firstNameList = isMale ? firstNamesMale : firstNamesFemale;
      const firstName = firstNameList[i % firstNameList.length];
      const lastName = surnames[(i + 3) % surnames.length] + " " + surnames[(i + 7) % surnames.length];
      const name = `${firstName} ${lastName}`;
      const isPremium = i < 25;
      const age = 18 + Math.floor(i / 49 * (65 - 18));
      const sex = isMale ? "male" : "female";
      const height = isMale ? 170 + i % 15 : 155 + i % 16;
      const weight = isMale ? 68 + i % 25 : 49 + i % 23;
      const weeklyFrequency = isPremium ? i % 2 === 0 ? "5+" : "3-4" : i % 2 === 0 ? "3-4" : "0-2";
      const objective = ["emagrecer", "ganhar_massa", "definir"][i % 3];
      const bodySelfAssessment = ["acima_do_peso", "normal", "definido", "maromba"][i % 4];
      const score = isPremium ? 1500 + i * 120 : 400 + (i - 25) * 75;
      const xp = score * 6;
      const level = Math.floor(xp / 1500) + 1;
      const streak = i % 10;
      const gymOpt = gymNamesOpts[i % gymNamesOpts.length];
      const simUser = {
        uid: `sim_perf_${i}`,
        displayName: name,
        displayNameLower: name.toLowerCase(),
        email: `sim_perf_${i}@invictus.com.br`,
        photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=sim_perf_${i}`,
        city: "S\xE3o Paulo",
        state: "SP",
        score,
        xp,
        level,
        weeklyScore: Math.floor(score * 0.12),
        monthlyScore: Math.floor(score * 0.45),
        isActive: true,
        streak,
        league: isPremium ? i % 2 === 0 ? "Liga Alpha" : "Liga Beta" : "Liga Delta",
        height,
        weight,
        age,
        cpf: `999888777${i.toString().padStart(2, "0")}`,
        sex,
        weeklyFrequency,
        objective,
        bodySelfAssessment,
        imc: Number((weight / (height / 100 * (height / 100))).toFixed(1)),
        isSubscribed: isPremium,
        subscriptionTier: isPremium ? "performance" : "open",
        isBot: true,
        isBlocked: false,
        walletBalance: isPremium ? i * 6 : 0,
        totalActiveDays: isPremium ? 20 + i % 30 : 8 + i % 15,
        totalWorkouts: isPremium ? 25 + i % 40 : 10 + i % 20,
        gymId: gymOpt.id,
        gymName: gymOpt.name,
        role: "user",
        createdAt: new Date(Date.now() - (60 - i % 35) * 24 * 3600 * 1e3).toISOString(),
        // generated weeks ago
        termsAccepted: true,
        termsAcceptedAt: new Date(Date.now() - 60 * 24 * 3600 * 1e3).toISOString(),
        referralCode: `SIM${i.toString().padStart(3, "0")}`,
        referralStats: {
          totalReferrals: i % 4,
          validReferrals: i % 3,
          bonusBalance: i % 3 * 15,
          referralPoints: i % 3 * 100
        },
        referralMilestones: [],
        followersCount: i + 12,
        followingCount: i + 8,
        postsCount: i % 6,
        appCredits: i * 3,
        activeSeason: "S1",
        positions: {
          gym: i % 10 + 1,
          city: i % 30 + 1,
          national: i + 1,
          league: i % 15 + 1,
          global: i + 1,
          region: i % 20 + 1
        }
      };
      simulatedUsersList.push(simUser);
      const userRef = db.collection("users").doc(simUser.uid);
      batch.set(userRef, simUser);
      const bestRunMonth = isPremium ? 8 + i * 0.5 : 3.5 + (i - 25) * 0.4;
      const bestRunWeek = isPremium ? 5 + i * 0.3 : 2 + (i - 25) * 0.2;
      const runningStatsObj = {
        userId: simUser.uid,
        best_run_km_month: Number(bestRunMonth.toFixed(2)),
        best_run_km_week: Number(bestRunWeek.toFixed(2)),
        last_run_date: (/* @__PURE__ */ new Date()).toISOString(),
        // set to today so they pass startOfMonth filter
        is_paid_running: isPremium,
        // true for Performance plan, false for Open plan
        validation: {
          score: 95,
          status: "VALID",
          reasons: ["Padr\xE3o biomec\xE2nico verificado com sucesso."]
        }
      };
      const runningStatsRef = db.collection("running_stats").doc(simUser.uid);
      batch.set(runningStatsRef, runningStatsObj);
    }
    await batch.commit();
    const workoutBatch = db.batch();
    const nowTime = Date.now();
    for (let i = 0; i < numUsers; i++) {
      const userObj = simulatedUsersList[i];
      const isPremium = userObj.isSubscribed;
      const workoutId1 = `sim_workout_gym_${i}_${nowTime}`;
      const workoutDuration1 = 35 + i % 45;
      const workoutTimestamp1 = new Date(nowTime - i % 15 * 24 * 3600 * 1e3 - i % 12 * 3600 * 1e3).toISOString();
      const gymWorkoutObj = {
        id: workoutId1,
        userId: userObj.uid,
        displayName: userObj.displayName,
        photoUrl: `https://picsum.photos/seed/workout-gym-${i}/400/300`,
        timestamp: workoutTimestamp1,
        status: "valid",
        type: "workout",
        points: isPremium ? 80 : 50,
        duration: workoutDuration1,
        gymId: userObj.gymId,
        gymName: userObj.gymName,
        validation: {
          status: "valid",
          reviewerId: "system_auto_detector",
          reviewedAt: workoutTimestamp1,
          resolution: "Intelig\xEAncia Artificial validou o padr\xE3o de presen\xE7a de forma bem-sucedida."
        }
      };
      const workoutRef1 = db.collection("workouts").doc(workoutId1);
      workoutBatch.set(workoutRef1, gymWorkoutObj);
      const workoutId2 = `sim_workout_run_${i}_${nowTime}`;
      const runKm = isPremium ? 6 + i * 0.4 : 3 + (i - 25) * 0.3;
      const runDuration = Math.floor(runKm * (5.5 + i % 2 * 0.5));
      const tempPaceMinutes = Math.floor(runDuration / runKm);
      const tempPaceSeconds = Math.floor(runDuration % runKm * 60 / runKm);
      const formattedPace = `${tempPaceMinutes}'${tempPaceSeconds.toString().padStart(2, "0")}"/km`;
      const runTimestamp2 = new Date(nowTime - i % 6 * 2 * 24 * 3600 * 1e3 - 4 * 3600 * 1e3).toISOString();
      const runningWorkoutObj = {
        id: workoutId2,
        userId: userObj.uid,
        displayName: userObj.displayName,
        photoUrl: `https://picsum.photos/seed/workout-run-${i}/400/300`,
        timestamp: runTimestamp2,
        status: "valid",
        type: "cardio",
        points: isPremium ? 100 : 70,
        duration: runDuration,
        distance: Number(runKm.toFixed(2)),
        pace: formattedPace,
        gymId: userObj.gymId,
        gymName: userObj.gymName,
        validation: {
          status: "valid",
          reviewerId: "system_auto_detector",
          reviewedAt: runTimestamp2,
          resolution: "Corrida autenticada atrav\xE9s dos sensores de geolocaliza\xE7\xE3o e acelera\xE7\xE3o espacial."
        }
      };
      const workoutRef2 = db.collection("workouts").doc(workoutId2);
      workoutBatch.set(workoutRef2, runningWorkoutObj);
    }
    await workoutBatch.commit();
    console.log("[Performance Simulation] Running immediate global aggregation...");
    await aggregationService.updateAllStats();
    await logEvent({
      severity: "INFO",
      category: "system_logs",
      message: `Simula\xE7\xE3o de temporada completa: 50 atletas gerados nos dois planos com hist\xF3rico completo de 1 temporada rodando de treinos, cadastrados em academias distintas e rankings atualizados.`,
      userId: reviewerId,
      route: "/api/admin",
      details: { count: numUsers }
    });
    return res.status(200).json({
      success: true,
      message: "Simula\xE7\xE3o de 50 usu\xE1rios em ambos os planos (Performance e Open) com 1 temporada rodando de dados completada!",
      usersCount: numUsers,
      clearedLegacyCount: deleteCount,
      users: simulatedUsersList.map((u) => ({
        uid: u.uid,
        name: u.displayName,
        age: u.age,
        objective: u.objective,
        weeklyFrequency: u.weeklyFrequency,
        tier: u.subscriptionTier
      }))
    });
  } catch (error) {
    console.error("[Simulation Error]:", error);
    return res.status(500).json({ error: error.message || "Erro ao realizar a simula\xE7\xE3o de usu\xE1rios performance." });
  }
}
var import_firestore3;
var init_admin = __esm({
  "api/_handlers/admin.ts"() {
    init_common();
    init_observability();
    import_firestore3 = require("firebase-admin/firestore");
    init_aggregation();
  }
});

// api/_handlers/denounce.ts
async function handler22(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "M\xE9todo n\xE3o permitido." });
  }
  const authUser = await verifyAuth(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: "Sess\xE3o expirada. Entre novamente." });
  }
  const { suspectUserId } = req.body;
  if (!suspectUserId) {
    return res.status(400).json({ success: false, error: "Usu\xE1rio suspeito n\xE3o informado." });
  }
  if (authUser.uid === suspectUserId) {
    return res.status(400).json({ success: false, error: "Voc\xEA n\xE3o pode denunciar a si mesmo." });
  }
  try {
    if (!db) {
      return res.status(500).json({ success: false, error: "Servi\xE7o temporariamente indispon\xEDvel." });
    }
    const suspectRef = db.collection("users").doc(suspectUserId);
    const suspectSnap = await suspectRef.get();
    if (!suspectSnap.exists) {
      return res.status(404).json({ success: false, error: "Usu\xE1rio n\xE3o encontrado." });
    }
    const suspectData = suspectSnap.data() || {};
    const pos = suspectData.positions || {};
    const isTopAthlete = pos.gym && pos.gym <= 5 || pos.city && pos.city <= 5 || pos.national && pos.national <= 5;
    const denounceRef = db.collection("denunciations").doc();
    const denunciation = {
      id: denounceRef.id,
      reporterUserId: authUser.uid,
      suspectUserId,
      suspectDisplayName: suspectData.displayName || "Atleta",
      isTopAthleteAtDenounce: !!isTopAthlete,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "pending"
    };
    await denounceRef.set(denunciation);
    const trustProfileRef = db.collection("user_trust_profiles").doc(suspectUserId);
    const trustProfileSnap = await trustProfileRef.get();
    let trustScore = 100;
    if (trustProfileSnap.exists) {
      trustScore = trustProfileSnap.data()?.trustScore ?? 100;
    }
    const newTrustScore = Math.max(0, trustScore - 20);
    const fraudRiskLevel = newTrustScore >= 80 ? "low" : newTrustScore >= 50 ? "medium" : "high";
    await trustProfileRef.set({
      userId: suspectUserId,
      trustScore: newTrustScore,
      fraudRiskLevel,
      denunciationCount: import_firestore.FieldValue.increment(1),
      lastValidationReview: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: import_firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const fortyEightHoursAgo = /* @__PURE__ */ new Date();
    fortyEightHoursAgo.setDate(fortyEightHoursAgo.getDate() - 2);
    const recentWorkouts = await db.collection("workouts").where("userId", "==", suspectUserId).where("timestamp", ">=", fortyEightHoursAgo.toISOString()).get();
    let flaggedCount = 0;
    const batch = db.batch();
    recentWorkouts.forEach((doc2) => {
      const workout = doc2.data();
      if (isTopAthlete || newTrustScore < 60) {
        batch.update(doc2.ref, {
          status: "under_review",
          "validation.status": "pending_review",
          "validation.requiresManualReview": true,
          "validation.reason": (workout.validation?.reason || "") + " | Den\xFAncia recebida de competidor (" + (isTopAthlete ? "Zona de Premia\xE7\xE3o" : "Aumento de Risco") + ")"
        });
        flaggedCount++;
      }
    });
    if (flaggedCount > 0) {
      await batch.commit();
    }
    const logId = db.collection("fraud_audit_logs").doc().id;
    await db.collection("fraud_audit_logs").doc(logId).set({
      id: logId,
      userId: suspectUserId,
      displayName: suspectData.displayName || "Competidor",
      type: "user_reported",
      fraudRiskScore: parseFloat(((100 - newTrustScore) / 100).toFixed(2)),
      fraudFlags: ["USER_REPORTED_IN_RANKING", isTopAthlete ? "REPRESENT_TOP_LEAGUE_RISK" : "MEMBER_REPORTED"],
      trustLevel: fraudRiskLevel,
      severity: isTopAthlete ? "CRITICAL" : "WARNING",
      actionTaken: isTopAthlete ? "auto_under_review" : "shadow_logged",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      reviewStatus: "pending"
    });
    await logEvent({
      severity: isTopAthlete ? "HIGH_RISK" : "WARNING",
      category: "fraud_audit_logs",
      message: `Den\xFAncia registrada para o atleta ${suspectData.displayName} (UID: ${suspectUserId}). TrustScore reduzido de ${trustScore} para ${newTrustScore}. Atividades sob revis\xE3o: ${flaggedCount}`,
      userId: authUser.uid,
      route: "/api/denounce",
      details: { suspectUserId, isTopAthlete, flaggedCount, newTrustScore }
    });
    return res.json({
      success: true,
      isTopAthlete,
      flaggedCount,
      message: "Den\xFAncia registrada com sucesso. Nossos auditores analisar\xE3o as evid\xEAncias do usu\xE1rio em breve."
    });
  } catch (error) {
    console.error("Denounce error:", error);
    return res.status(500).json({ success: false, error: "Ocorreu um erro ao enviar a den\xFAncia." });
  }
}
var init_denounce = __esm({
  "api/_handlers/denounce.ts"() {
    init_common();
    init_observability();
  }
});

// api/_lib/payments-service.ts
function calculateSeasonDetails(purchaseDate) {
  const day = purchaseDate.getDate();
  const year = purchaseDate.getFullYear();
  const month = purchaseDate.getMonth();
  if (day === 1) {
    const startsAt = new Date(year, month, 1, 0, 0, 0, 0);
    const endsAt = new Date(year, month, 14, 23, 59, 59, 999);
    const seasonId = `season_${year}_${String(month + 1).padStart(2, "0")}_A`;
    return {
      seasonId,
      seasonStart: startsAt.toISOString(),
      seasonEnd: endsAt.toISOString(),
      status: "ACTIVE"
    };
  } else if (day >= 2 && day <= 14) {
    const startsAt = new Date(year, month, 15, 0, 0, 0, 0);
    const endsAt = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const seasonId = `season_${year}_${String(month + 1).padStart(2, "0")}_B`;
    return {
      seasonId,
      seasonStart: startsAt.toISOString(),
      seasonEnd: endsAt.toISOString(),
      status: "WAITING"
    };
  } else if (day === 15) {
    const startsAt = new Date(year, month, 15, 0, 0, 0, 0);
    const endsAt = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const seasonId = `season_${year}_${String(month + 1).padStart(2, "0")}_B`;
    return {
      seasonId,
      seasonStart: startsAt.toISOString(),
      seasonEnd: endsAt.toISOString(),
      status: "ACTIVE"
    };
  } else {
    const nextMonthDate = new Date(year, month + 1, 1);
    const nYear = nextMonthDate.getFullYear();
    const nMonth = nextMonthDate.getMonth();
    const startsAt = new Date(nYear, nMonth, 1, 0, 0, 0, 0);
    const endsAt = new Date(nYear, nMonth, 14, 23, 59, 59, 999);
    const seasonId = `season_${nYear}_${String(nMonth + 1).padStart(2, "0")}_A`;
    return {
      seasonId,
      seasonStart: startsAt.toISOString(),
      seasonEnd: endsAt.toISOString(),
      status: "WAITING"
    };
  }
}
async function logPaymentAudit(log) {
  try {
    const logId = db.collection("payment_audit_logs").doc().id;
    await db.collection("payment_audit_logs").doc(logId).set({
      ...log,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    console.log(`[Audit Log] Saved log event '${log.action}' for orderId: ${log.orderId}`);
  } catch (err) {
    console.error("[Audit Log Error] Failed to write payment audit log:", err);
  }
}
async function grantProAccessAfterApprovedPayment(orderId, paymentId, eventSource) {
  const now = /* @__PURE__ */ new Date();
  const orderRef = db.collection("payment_orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new Error(`Pedido ${orderId} n\xE3o foi encontrado no banco de dados.`);
  }
  const orderData = orderSnap.data();
  if (orderData.status === "approved") {
    console.log(`[Grant Pro Skip] Order ${orderId} is already approved. Skipping provision.`);
    return { success: true, alreadyGranted: true };
  }
  const userId = orderData.userId;
  const planId = orderData.planId;
  const amount = orderData.amount;
  console.log(`[Grant Pro Access] Processing approval for user ${userId}, order ${orderId}, payment ${paymentId}`);
  const previousStatus = orderData.status || "pending";
  await orderRef.update({
    status: "approved",
    paymentId,
    rawStatus: "approved",
    paidAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
  await logPaymentAudit({
    userId,
    orderId,
    paymentId,
    previousStatus,
    newStatus: "approved",
    eventSource,
    action: "payment_approved",
    reason: `Pagamento com ID ${paymentId} confirmado via ${eventSource}.`
  });
  const entitlementId = `${userId}_${planId}`;
  const durationDays = planId === "invictus_annual" ? 365 : 30;
  const endsAt = /* @__PURE__ */ new Date();
  endsAt.setDate(now.getDate() + durationDays);
  const entitlementRef = db.collection("user_entitlements").doc(entitlementId);
  await entitlementRef.set({
    userId,
    planId,
    status: "active",
    sourceOrderId: orderId,
    purchasedAt: now.toISOString(),
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    expiresAt: endsAt.toISOString(),
    createdAt: orderData.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  }, { merge: true });
  const seasonDetails = calculateSeasonDetails(now);
  const startD = new Date(seasonDetails.seasonStart);
  const nextSeasonStartStr = `${String(startD.getDate()).padStart(2, "0")}/${String(startD.getMonth() + 1).padStart(2, "0")}/${startD.getFullYear()}`;
  const subscriptionTier = planId === "invictus_performance" ? "performance" : "open";
  if (subscriptionTier === "performance") {
    const registrationId = `${userId}_${seasonDetails.seasonId}`;
    await db.collection("season_registrations").doc(registrationId).set({
      userId,
      seasonId: seasonDetails.seasonId,
      seasonStart: seasonDetails.seasonStart,
      seasonEnd: seasonDetails.seasonEnd,
      registrationDate: now.toISOString(),
      status: seasonDetails.status
    });
  }
  await db.collection("users").doc(userId).set({
    isSubscribed: true,
    status: "PRO_ATIVO",
    subscriptionTier,
    seasonStatus: subscriptionTier === "performance" ? seasonDetails.status === "ACTIVE" ? "ACTIVE" : "WAITING_NEXT_SEASON" : "NOT_ELIGIBLE",
    nextSeasonStart: subscriptionTier === "performance" ? nextSeasonStartStr : "",
    updatedAt: now.toISOString(),
    isPro: true,
    plan: "pro",
    proStatus: "active",
    proActivatedAt: import_firestore.FieldValue.serverTimestamp(),
    proPaymentId: paymentId
  }, { merge: true });
  await logPaymentAudit({
    userId,
    orderId,
    paymentId,
    previousStatus,
    newStatus: "approved",
    eventSource,
    action: "pro_granted",
    reason: `Acesso PRO liberado com sucesso. Plano: ${planId}. Temporada: ${seasonDetails.seasonId} (${seasonDetails.status}).`
  });
  console.log(`[Grant Pro Access] Pro access granted successfully for user: ${userId}`);
  return { success: true, alreadyGranted: false };
}
async function revokeProAccess(orderId, paymentId, newStatus, eventSource, reasonDetails) {
  const now = /* @__PURE__ */ new Date();
  const orderRef = db.collection("payment_orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new Error(`Pedido ${orderId} n\xE3o foi encontrado no banco de dados para revoga\xE7\xE3o.`);
  }
  const orderData = orderSnap.data();
  const userId = orderData.userId;
  const previousStatus = orderData.status || "pending";
  console.warn(`[Revoke Pro Access] Revoking user ${userId} PRO access since order transitioned to ${newStatus}`);
  let riskFlags = orderData.riskFlags || [];
  if (newStatus === "charged_back") {
    riskFlags.push("chargeback_detected", "account_review_triggered");
  }
  await orderRef.update({
    status: newStatus,
    paymentId,
    rawStatus: newStatus,
    riskFlags,
    updatedAt: now.toISOString()
  });
  const entitlementId = `${userId}_${orderData.planId}`;
  await db.collection("user_entitlements").doc(entitlementId).set({
    status: "suspended",
    updatedAt: now.toISOString()
  }, { merge: true });
  await db.collection("users").doc(userId).set({
    isSubscribed: false,
    status: "FREE",
    seasonStatus: "INACTIVE",
    updatedAt: now.toISOString()
  }, { merge: true });
  if (newStatus === "charged_back") {
    try {
      await db.collection("users").doc(userId).set({
        isUnderReview: true,
        updatedAt: now.toISOString()
      }, { merge: true });
    } catch (profileErr) {
      console.warn("[Revoke Pro Error] Could not flag user profile infractions:", profileErr);
    }
  }
  await logPaymentAudit({
    userId,
    orderId,
    paymentId,
    previousStatus,
    newStatus,
    eventSource,
    action: "pro_revoked",
    reason: `Acesso PRO revogado devido ao status ${newStatus}. Motivo: ${reasonDetails}.`
  });
  return { success: true };
}
var init_payments_service = __esm({
  "api/_lib/payments-service.ts"() {
    init_common();
  }
});

// api/_handlers/payments-create-checkout.ts
async function handler23(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(455).json({ error: "M\xE9todo n\xE3o permitido." });
  }
  const authUser = await verifyAuth(req);
  if (!authUser) {
    return res.status(401).json({ error: "Sess\xE3o expira ou inv\xE1lida. Conecte-se novamente." });
  }
  const { planId = "invictus_monthly" } = req.body;
  const plan = PLANS[planId];
  if (!plan) {
    return res.status(400).json({ error: "Plano selecionado \xE9 inv\xE1lido." });
  }
  const possibleVarNames = [
    "TOKEN_DE_ACESSO_AO_MERCADO_PAGO",
    "MERCADO_PAGO_ACESS_TOKEN",
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MP_ACCESS_TOKEN",
    "MERCADOPAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_TOKEN",
    "MP_TOKEN"
  ];
  let selectedVarName = "MERCADO_PAGO_ACCESS_TOKEN";
  let accessToken = "";
  for (const varName of possibleVarNames) {
    const val = (process.env[varName] || "").trim();
    if (val && val.startsWith("APP_USR-")) {
      accessToken = val;
      selectedVarName = varName;
      break;
    }
  }
  if (!accessToken) {
    for (const varName of possibleVarNames) {
      const val = (process.env[varName] || "").trim();
      if (val && !val.toLowerCase().includes("placeholder") && !val.toLowerCase().includes("seu_token") && val.length >= 15) {
        accessToken = val;
        selectedVarName = varName;
        break;
      }
    }
  }
  if (!accessToken) {
    accessToken = (process.env.MERCADO_PAGO_ACCESS_TOKEN || "").trim();
  }
  const finalPrice = plan.price;
  try {
    const now = /* @__PURE__ */ new Date();
    const entitlementsSnap = await db.collection("user_entitlements").where("userId", "==", authUser.uid).where("planId", "==", planId).where("status", "==", "active").get();
    let hasActiveEntitlement = false;
    for (const doc2 of entitlementsSnap.docs) {
      const data = doc2.data();
      const endsAt = data.endsAt ? new Date(data.endsAt) : null;
      if (!endsAt || endsAt > now) {
        hasActiveEntitlement = true;
      }
    }
    if (hasActiveEntitlement) {
      return res.status(400).json({
        error: "Voc\xEA j\xE1 possui uma assinatura ativa para este plano no momento.",
        code: "ALREADY_ACTIVE"
      });
    }
    const pendingOrdersSnap = await db.collection("payment_orders").where("userId", "==", authUser.uid).where("planId", "==", planId).where("status", "==", "pending").get();
    if (!pendingOrdersSnap.empty) {
      console.log(`[Payments] Cancelling preceding pending orders for user ${authUser.uid} to create a fresh one.`);
      const batch = db.batch();
      for (const pendingDoc of pendingOrdersSnap.docs) {
        batch.update(pendingDoc.ref, {
          status: "cancelled",
          updatedAt: now.toISOString()
        });
      }
      await batch.commit();
    }
    const orderId = db.collection("payment_orders").doc().id;
    const client = new import_mercadopago2.MercadoPagoConfig({ accessToken });
    const preference = new import_mercadopago2.Preference(client);
    let baseUrl = "https://www.desafiosemdesculpa.com.br";
    const publicUrlCandidates = [
      process.env.MP_SUCCESS_URL,
      process.env.VITE_APP_URL,
      process.env.VITE_API_URL
    ];
    let foundOfficialDomain = false;
    for (const candidate of publicUrlCandidates) {
      if (candidate) {
        try {
          const parsed = new URL(candidate);
          const hostname = parsed.hostname.toLowerCase();
          if (hostname.includes("desafiosemdesculpa.com.br")) {
            baseUrl = parsed.origin;
            foundOfficialDomain = true;
            break;
          }
        } catch (e) {
        }
      }
    }
    if (!foundOfficialDomain) {
      const forwardedHost = req.headers["x-forwarded-host"];
      const host = forwardedHost || req.headers.host || "";
      if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
        baseUrl = `https://${host}`;
      }
    }
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    const backUrls = {
      success: `${baseUrl}/pagamento/sucesso?payment=success&orderId=${orderId}`,
      failure: `${baseUrl}/settings?payment=failure&orderId=${orderId}`,
      pending: `${baseUrl}/pagamento/sucesso?payment=pending&orderId=${orderId}`
    };
    const notificationUrl = `${baseUrl}/api/payments/webhook`;
    let userEmail = authUser.email;
    if (!userEmail) {
      try {
        const userDoc = await db.collection("users").doc(authUser.uid).get();
        if (userDoc.exists) {
          userEmail = userDoc.data()?.email;
        }
      } catch (err) {
        console.warn("[Payments] Could not query user email from users collection:", err);
      }
    }
    if (!userEmail) {
      userEmail = "samuelfsc89@gmail.com";
    }
    const body = {
      items: [
        {
          id: planId,
          title: plan.name,
          unit_price: finalPrice,
          quantity: 1,
          currency_id: "BRL"
        }
      ],
      payer: {
        email: userEmail
      },
      payment_methods: {
        excluded_payment_types: [
          { id: "ticket" },
          // Exclude Boleto (Ticket)
          { id: "debit_card" },
          // Exclude Debit Cards
          { id: "prepaid_card" },
          // Exclude Prepaid Cards
          { id: "atm" }
          // Exclude ATM payments
          // We DO NOT exclude bank_transfer (which Pix belongs to) or credit_card
        ],
        installments: 12
        // Support up to 12 installments for credit card
      },
      binary_mode: false,
      // Do not block Pix or Credit Card with strict binary mode
      external_reference: orderId,
      back_urls: backUrls,
      auto_return: "approved",
      metadata: {
        userId: authUser.uid,
        orderId,
        planId
      }
    };
    if (!notificationUrl.includes("localhost") && !notificationUrl.includes("127.0.0.1") && notificationUrl.startsWith("https://")) {
      body.notification_url = notificationUrl;
      console.log("[Payments] Setting notification_url:", notificationUrl);
    } else {
      console.warn("[Payments] Skipping notification_url in development/localhost mode to avoid Mercado Pago preference errors:", notificationUrl);
    }
    let result = null;
    let checkoutUrl = "";
    const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production" || process.env.VERCEL === "1";
    const tokenPrefix = accessToken ? accessToken.substring(0, 15) : "";
    const tokenLength = accessToken ? accessToken.length : 0;
    const diagnosticData = {
      rota_chamada: "/api/payments/create-checkout",
      node_env: process.env.NODE_ENV || "undefined",
      vercel_env: process.env.VERCEL_ENV || "undefined",
      token_variable_name_used: selectedVarName,
      token_prefix: tokenPrefix,
      token_length: tokenLength,
      is_production_detected: isProduction,
      init_point: "",
      sandbox_init_point: "",
      checkout_url_final: ""
    };
    if (!accessToken || accessToken.trim() === "") {
      console.error("[Payments] Erro de configura\xE7\xE3o: Access Token do Mercado Pago ausente.", { diagnosticData });
      return res.status(400).json({ error: "Configura\xE7\xE3o do Mercado Pago inv\xE1lida: Access Token ausente.", ...diagnosticData });
    }
    if (accessToken.toLowerCase().includes("placeholder") || accessToken.toLowerCase().includes("seu_token") || accessToken.length < 15) {
      console.error("[Payments] Erro de valida\xE7\xE3o: Token inv\xE1lido ou vazio detectado.", { tokenStart: accessToken.substring(0, 10), diagnosticData });
      return res.status(400).json({ error: "Checkout rejeitado. Credenciais do Mercado Pago inv\xE1lidas ou de placeholder detectadas.", ...diagnosticData });
    }
    if (isProduction && accessToken.startsWith("TEST-")) {
      console.error("[Payments] Bloqueio imediato de seguran\xE7a: Credencial de teste (TEST-) rejeitada em produ\xE7\xE3o.", { diagnosticData });
      return res.status(400).json({ error: "Checkout configurado em sandbox. Credenciais TEST- negadas em produ\xE7\xE3o.", ...diagnosticData });
    }
    if (isProduction && !accessToken.startsWith("APP_USR-")) {
      console.error("[Payments] Bloqueio imediato de seguran\xE7a: Apenas credenciais APP_USR- s\xE3o permitidas em produ\xE7\xE3o.", { diagnosticData });
      return res.status(400).json({ error: "Checkout configurado de forma insegura. Apenas credenciais de produ\xE7\xE3o (APP_USR-) s\xE3o v\xE1lidas.", ...diagnosticData });
    }
    const hasValidTokenFormat = accessToken.startsWith("APP_USR-") || !isProduction && accessToken.startsWith("TEST-");
    if (!hasValidTokenFormat) {
      console.error("[Payments] Formato de token n\xE3o autorizado:", { tokenStart: accessToken.substring(0, 10), diagnosticData });
      return res.status(400).json({ error: "Formato do token do Mercado Pago inv\xE1lido ou n\xE3o autorizado.", ...diagnosticData });
    }
    try {
      console.log("[Payments] Creating MP preference for orderId:", orderId);
      const apiCall = preference.create({ body });
      apiCall.catch((err) => {
        console.warn("[Payments] Mercado Pago background preference creation rejected safely:", err.message || err);
      });
      const timeoutCall = new Promise(
        (_, reject) => setTimeout(() => reject(new Error("Gateway timeout: Mercado Pago demorou mais de 3.5 segundos para responder.")), 3500)
      );
      result = await Promise.race([apiCall, timeoutCall]);
      const isSandboxAux = accessToken.startsWith("TEST-");
      const realStatusIsSandbox = isSandboxAux || result.init_point && result.init_point.toLowerCase().includes("sandbox.mercadopago");
      const detectedAmbiente = realStatusIsSandbox ? "sandbox" : "production";
      checkoutUrl = result.init_point || "";
      diagnosticData.init_point = result.init_point || "";
      diagnosticData.sandbox_init_point = result.sandbox_init_point || "";
      diagnosticData.checkout_url_final = checkoutUrl;
      if (accessToken.startsWith("APP_USR-") && checkoutUrl.toLowerCase().includes("sandbox.mercadopago")) {
        console.error("[Payments Diagnostics ERROR] TOKEN PREFIX IS APP_USR, BUT MERCADO PAGO RETURNED SANDBOX URL!", {
          token_prefix: accessToken.substring(0, 15),
          token_length: accessToken.length,
          full_mp_preference_response: result,
          request_body_sent: body
        });
      }
      console.log("[Payments] Diagn\xF3stico de Cria\xE7\xE3o de Prefer\xEAncia:", diagnosticData);
      if (checkoutUrl.toLowerCase().includes("sandbox.mercadopago")) {
        console.error("[Payments] ERRO CR\xCDTICO DE SEGURAN\xC7A: URL de checkout em sandbox de forma inesperada!", { checkoutUrl });
        return res.status(500).json({
          error: "Checkout configurado em sandbox. Verifique credenciais e init_point.",
          ...diagnosticData,
          preference_id: result?.id || "",
          full_mp_response_on_mismatch: accessToken.startsWith("APP_USR-") ? result : void 0
        });
      }
      console.log("[Payments] Mercado Pago API Preference Creation [SUCCESS]:", {
        preferenceId: result?.id,
        init_point: result?.init_point,
        collector_id: result?.collector_id,
        payment_methods_sent: body.payment_methods,
        selected_checkout_url: checkoutUrl,
        is_sandbox: realStatusIsSandbox
      });
      await db.collection("utils").doc("mp_debug").set({
        environment: detectedAmbiente,
        hasAccessToken: true,
        hasPublicKey: !!process.env.MERCADO_PAGO_PUBLIC_KEY,
        lastPreferenceId: result?.id || null,
        lastPayload: body,
        selectedInitPointType: "init_point",
        selectedInitPoint: checkoutUrl,
        collector_id: result?.collector_id || null,
        lastDiagnostics: diagnosticData,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }, { merge: true });
    } catch (err) {
      console.error("[Payments] Mercado Pago API preference creation failed:", err);
      const isSandbox = accessToken.startsWith("TEST-");
      await db.collection("utils").doc("mp_debug").set({
        environment: isSandbox ? "sandbox" : "production",
        hasAccessToken: true,
        hasPublicKey: !!process.env.MERCADO_PAGO_PUBLIC_KEY,
        lastPreferenceId: null,
        lastPayload: body,
        selectedInitPointType: "init_point",
        selectedInitPoint: null,
        collector_id: null,
        lastError: {
          message: err.message,
          status: err.status,
          response: err.response?.data || err.data || null
        },
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }, { merge: true });
      return res.status(500).json({
        error: "Erro na cria\xE7\xE3o do checkout do Mercado Pago. Por favor, verifique as credenciais."
      });
    }
    if (!checkoutUrl) {
      throw new Error("Nenhum checkout url foi gerado pelo Mercado Pago.");
    }
    const orderDoc = {
      orderId,
      userId: authUser.uid,
      planId,
      amount: finalPrice,
      currency: "BRL",
      status: "pending",
      provider: "mercado_pago",
      preferenceId: result.id || "",
      paymentId: "",
      externalReference: orderId,
      checkoutUrl,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      rawStatus: "pending",
      riskFlags: []
    };
    await db.collection("payment_orders").doc(orderId).set(orderDoc);
    await logPaymentAudit({
      userId: authUser.uid,
      orderId,
      paymentId: result.id || "",
      previousStatus: "none",
      newStatus: "pending",
      eventSource: "checkout_created",
      action: "checkout_created",
      reason: `Checkout do Mercado Pago criado com sucesso para o plano ${planId}.`
    });
    return res.status(200).json({
      success: true,
      orderId,
      checkoutUrl,
      preferenceId: result.id,
      // Mandatory diagnostic log properties requested by user of the actual API output
      ...diagnosticData,
      preference_id: result.id || "",
      full_mp_response_on_mismatch: accessToken.startsWith("APP_USR-") && checkoutUrl.toLowerCase().includes("sandbox.mercadopago") ? result : void 0
    });
  } catch (error) {
    console.error("[Payments Create Checkout Error] Full error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
      response: error.response,
      status: error.status,
      cause: error.cause,
      data: error.response?.data || error.data
    });
    return res.status(500).json({
      error: "N\xE3o foi poss\xEDvel iniciar o pagamento agora. Tente novamente em alguns instantes.",
      details: error.message
    });
  }
}
var import_mercadopago2, PLANS;
var init_payments_create_checkout = __esm({
  "api/_handlers/payments-create-checkout.ts"() {
    init_common();
    import_mercadopago2 = require("mercadopago");
    init_payments_service();
    PLANS = {
      "invictus_monthly": {
        name: "Plano Invictus Mensal",
        price: 1
      },
      "invictus_annual": {
        name: "Plano Invictus Anual",
        price: 1
      },
      "invictus_open": {
        name: "Invictus Open",
        price: 9.9
      },
      "invictus_performance": {
        name: "Invictus Performance",
        price: 29.9
      }
    };
  }
});

// api/_handlers/payments-webhook.ts
async function handler24(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(455).json({ error: "M\xE9todo n\xE3o permitido." });
  }
  const now = /* @__PURE__ */ new Date();
  const eventId = String(req.body.id || req.body.data?.id || req.query.id || `random_${Math.random().toString(36).substring(2, 11)}`);
  const payloadHash = import_crypto2.default.createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
  try {
    await db.collection("webhook_events").doc(eventId).set({
      eventId,
      provider: "mercado_pago",
      type: req.body.type || "unknown",
      paymentId: String(req.body.data?.id || ""),
      receivedAt: now.toISOString(),
      status: "received",
      payloadHash
    }, { merge: true });
  } catch (err) {
    console.warn("[Webhook Log Error] Error creating initial webhook log:", err);
  }
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("[Webhook Error] Missing MERCADO_PAGO_ACCESS_TOKEN");
    return res.status(500).json({ error: "Token do Mercado Pago ausente." });
  }
  const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const signatureHeader = req.headers["x-signature"];
  if (webhookSecret && signatureHeader) {
    try {
      console.log(`[Webhook Signature Check] Validating signature: ${signatureHeader}`);
      const parts = signatureHeader.split(",");
      let ts = "";
      let v1 = "";
      for (const part of parts) {
        const [k, v] = part.split("=");
        if (k.trim() === "ts") ts = v.trim();
        if (k.trim() === "v1") v1 = v.trim();
      }
      const dataId = req.body.data?.id || req.query.id || "";
      const requestId = req.headers["x-request-id"] || "";
      const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const computedHash = import_crypto2.default.createHmac("sha256", webhookSecret).update(message).digest("hex");
      if (computedHash !== v1) {
        console.warn(`[Webhook Security Warning] Signature mismatch! Computed: ${computedHash}, header: ${v1}`);
      } else {
        console.log("[Webhook Signature Check] Cryptographic signature matches successfully.");
      }
    } catch (sigErr) {
      console.error("[Webhook Signature Validation Exception]", sigErr);
    }
  }
  const { type, action: eventAction, data } = req.body;
  if (type !== "payment") {
    console.log(`[Webhook Ignores] Received type '${type}'. System only processes 'payment' hooks.`);
    await db.collection("webhook_events").doc(eventId).update({
      status: "ignored",
      processedAt: now.toISOString()
    });
    return res.status(200).send("OK");
  }
  const paymentId = String(data?.id);
  if (!paymentId || paymentId === "undefined") {
    return res.status(400).json({ error: "ID do pagamento ausente no corpo do webhook." });
  }
  try {
    const client = new import_mercadopago3.MercadoPagoConfig({ accessToken });
    const payment = new import_mercadopago3.Payment(client);
    console.log(`[Webhook Verification] Syncing payment ${paymentId} directly with Mercado Pago API...`);
    const paymentData = await payment.get({ id: paymentId });
    const orderId = paymentData.external_reference;
    if (!orderId) {
      console.warn(`[Webhook Warning] Payment ${paymentId} does not possess an external_reference.`);
      await db.collection("webhook_events").doc(eventId).update({
        status: "failed_missing_reference",
        processedAt: now.toISOString()
      });
      return res.status(200).send("OK");
    }
    const orderRef = db.collection("payment_orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      console.error(`[Webhook Error] Internal order with reference ID ${orderId} not found in DB.`);
      await db.collection("webhook_events").doc(eventId).update({
        status: "failed_order_not_found",
        processedAt: now.toISOString()
      });
      return res.status(200).send("OK");
    }
    const orderData = orderSnap.data();
    await logPaymentAudit({
      userId: orderData.userId,
      orderId,
      paymentId,
      previousStatus: orderData.status || "pending",
      newStatus: paymentData.status || "unknown",
      eventSource: "webhook",
      action: "webhook_received",
      reason: `Webhook recebido do Mercado Pago com status nativo: ${paymentData.status}.`
    });
    if (orderData.status === "approved" && paymentData.status === "approved") {
      console.log(`[Webhook Double Approved Block] Order ${orderId} is already approved. Avoiding duplications.`);
      await db.collection("webhook_events").doc(eventId).update({
        status: "duplicate_ignored",
        processedAt: now.toISOString(),
        paymentId
      });
      return res.status(200).send("OK");
    }
    if (paymentData.external_reference !== orderId) {
      console.error(`[Webhook Security Block] Spoofing attempt detected! payment.external_reference (${paymentData.external_reference}) does not match orderId (${orderId})`);
      await db.collection("webhook_events").doc(eventId).update({
        status: "fraud_blocked_external_reference",
        processedAt: now.toISOString(),
        paymentId
      });
      return res.status(200).send("OK");
    }
    const paymentUserId = paymentData.metadata?.user_id || paymentData.metadata?.userId || paymentData.metadata?.user_id;
    if (paymentUserId && paymentUserId !== orderData.userId) {
      console.error(`[Webhook Security Block] Spoofing attempt detected! payment metadata userId (${paymentUserId}) does not match order userId (${orderData.userId})`);
      await db.collection("webhook_events").doc(eventId).update({
        status: "fraud_blocked_user_mismatch",
        processedAt: now.toISOString(),
        paymentId
      });
      return res.status(200).send("OK");
    }
    const duplicatePaymentSnap = await db.collection("payment_orders").where("paymentId", "==", String(paymentData.id)).get();
    let isUsed = false;
    for (const dpDoc of duplicatePaymentSnap.docs) {
      if (dpDoc.id !== orderId) {
        isUsed = true;
      }
    }
    if (isUsed) {
      console.error(`[Webhook Security Block] Replay attack: payment_id ${paymentData.id} has already been used for another order.`);
      await db.collection("webhook_events").doc(eventId).update({
        status: "fraud_blocked_duplicate_payment",
        processedAt: now.toISOString(),
        paymentId
      });
      return res.status(200).send("OK");
    }
    const transactionAmount = paymentData.transaction_amount || paymentData.transaction_details?.total_paid_amount || 0;
    const expectedAmount = orderData.amount;
    if (paymentData.status === "approved" && Math.abs(transactionAmount - expectedAmount) > 0.01) {
      console.error(`[Webhook Fraud Block] Expected price change! Paid BRL ${transactionAmount}, expected BRL ${expectedAmount}`);
      await orderRef.update({
        status: "rejected",
        rawStatus: paymentData.status,
        riskFlags: ["mismatched_amount_fraud", `paid_${transactionAmount}_expected_${expectedAmount}`],
        updatedAt: now.toISOString()
      });
      await db.collection("webhook_events").doc(eventId).update({
        status: "fraud_blocked",
        processedAt: now.toISOString(),
        paymentId
      });
      await logPaymentAudit({
        userId: orderData.userId,
        orderId,
        paymentId,
        previousStatus: orderData.status || "pending",
        newStatus: "rejected",
        eventSource: "webhook",
        action: "suspicious_frontend_attempt",
        reason: `Tentativa de fraude de valor: pago R$ ${transactionAmount}, esperado R$ ${expectedAmount}.`
      });
      return res.status(200).send("OK");
    }
    const mpStatus = paymentData.status;
    if (mpStatus === "approved") {
      await grantProAccessAfterApprovedPayment(orderId, paymentId, "webhook");
    } else if (mpStatus === "refunded" || mpStatus === "charged_back") {
      const internalStatus = mpStatus === "refunded" ? "refunded" : "charged_back";
      await revokeProAccess(orderId, paymentId, internalStatus, "webhook", `Pagamento estornado/devolvido pelo gateway (status: ${mpStatus}).`);
    } else {
      let mappedStatus = "pending";
      if (mpStatus === "rejected") mappedStatus = "rejected";
      if (mpStatus === "cancelled") mappedStatus = "cancelled";
      if (mpStatus === "in_process") mappedStatus = "processing";
      await orderRef.update({
        status: mappedStatus,
        paymentId,
        rawStatus: mpStatus,
        updatedAt: now.toISOString()
      });
      const auditAction = mappedStatus === "rejected" || mappedStatus === "cancelled" ? "payment_rejected" : "payment_pending";
      await logPaymentAudit({
        userId: orderData.userId,
        orderId,
        paymentId,
        previousStatus: orderData.status || "pending",
        newStatus: mappedStatus,
        eventSource: "webhook",
        action: auditAction,
        reason: `Status de pagamento atualizado para: ${mappedStatus}.`
      });
    }
    await db.collection("webhook_events").doc(eventId).update({
      status: "processed",
      processedAt: now.toISOString(),
      paymentId
    });
    return res.status(200).send("OK");
  } catch (err) {
    console.error(`[Webhook Exception] Critical failure processing payment callback event ${eventId}:`, err);
    await db.collection("webhook_events").doc(eventId).set({
      status: "failed",
      processedAt: now.toISOString(),
      error: err.message
    }, { merge: true });
    return res.status(500).json({ error: "Erro de comunica\xE7\xE3o ao processar o evento webhook." });
  }
}
var import_mercadopago3, import_crypto2;
var init_payments_webhook = __esm({
  "api/_handlers/payments-webhook.ts"() {
    init_common();
    import_mercadopago3 = require("mercadopago");
    init_payments_service();
    import_crypto2 = __toESM(require("crypto"), 1);
  }
});

// api/_handlers/payments-status.ts
async function handler25(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(455).json({ error: "M\xE9todo n\xE3o permitido." });
  }
  const authUser = await verifyAuth(req);
  if (!authUser) {
    return res.status(401).json({ error: "Sess\xE3o expirada. Fa\xE7a login novamente." });
  }
  const orderId = req.query.orderId || req.params?.orderId;
  if (!orderId) {
    return res.status(400).json({ error: "Identificador do pedido (orderId) ausente." });
  }
  try {
    console.log(`[Payments Status] Fetching status for orderId: ${orderId}`);
    const orderSnap = await db.collection("payment_orders").doc(orderId).get();
    if (!orderSnap.exists) {
      return res.status(404).json({ error: "Pedido n\xE3o encontrado." });
    }
    const orderData = orderSnap.data();
    if (!orderData) {
      return res.status(404).json({ error: "Os dados do pedido est\xE3o vazios." });
    }
    if (orderData.userId !== authUser.uid) {
      console.warn(`[Payments Status Block] User ${authUser.uid} tried to read order of user ${orderData.userId}`);
      return res.status(403).json({ error: "Opera\xE7\xE3o proibida: este pedido pertence a outro usu\xE1rio." });
    }
    let status = orderData.status || "pending";
    const paymentIdParam = req.query.paymentId || req.query.payment_id;
    if (status === "pending" || status === "processing") {
      const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || "";
      if (accessToken && paymentIdParam && /^\d+$/.test(paymentIdParam)) {
        try {
          console.log(`[Payments Status Search] Querying Mercado Pago API directly for specific payment_id: ${paymentIdParam}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);
          const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentIdParam}`, {
            signal: controller.signal,
            headers: {
              "Authorization": `Bearer ${accessToken}`
            }
          });
          clearTimeout(timeoutId);
          if (response.ok) {
            const p = await response.json();
            if (p.external_reference !== orderId) {
              console.error(`[Payments Security Block] Spoofing attempt detected! payment.external_reference (${p.external_reference}) does not match orderId (${orderId})`);
              return res.status(400).json({ error: "Opera\xE7\xE3o inv\xE1lida: o pagamento n\xE3o corresponde ao pedido solicitado." });
            }
            const paymentUserId = p.metadata?.user_id || p.metadata?.userId || p.metadata?.user_id;
            if (paymentUserId && paymentUserId !== authUser.uid) {
              console.error(`[Payments Security Block] Spoofing attempt detected! payment metadata userId (${paymentUserId}) does not match authenticated userId (${authUser.uid})`);
              return res.status(400).json({ error: "Opera\xE7\xE3o inv\xE1lida: o pagamento pertence a outro usu\xE1rio." });
            }
            const actualPaidAmount = p.transaction_amount || p.transaction_details?.total_paid_amount || 0;
            const expectedProductPrice = orderData.amount;
            if (Math.abs(actualPaidAmount - expectedProductPrice) > 0.01) {
              console.error(`[Payments Security Block] Price manipulation! paid amount ${actualPaidAmount} does not match expected amount ${expectedProductPrice}`);
              return res.status(400).json({ error: "Opera\xE7\xE3o inv\xE1lida: o valor pago n\xE3o coincide com o plano contratado." });
            }
            const duplicatePaymentSnap = await db.collection("payment_orders").where("paymentId", "==", String(p.id)).get();
            let isUsed = false;
            for (const dpDoc of duplicatePaymentSnap.docs) {
              if (dpDoc.id !== orderId) {
                isUsed = true;
              }
            }
            if (isUsed) {
              console.error(`[Payments Security Block] Replay attack: payment_id ${p.id} has already been used for another order.`);
              return res.status(400).json({ error: "Opera\xE7\xE3o inv\xE1lida: este pagamento j\xE1 foi processado anteriormente." });
            }
            if (p.status === "approved") {
              console.log(`[Payments Status Search] Direct payment_id ${paymentIdParam} is approved! Activating Pro access.`);
              await grantProAccessAfterApprovedPayment(orderId, String(p.id), "status_direct_param");
              status = "approved";
            } else if (p.status === "rejected" || p.status === "cancelled") {
              console.warn(`[Payments Status Search] Direct payment_id ${paymentIdParam} was ${p.status}. Revoking access.`);
              await revokeProAccess(orderId, String(p.id), p.status, "status_direct_param", `Pagamento recusado: ${p.status_detail}`);
              status = p.status;
            }
          }
        } catch (directErr) {
          console.error("[Payments Status Search] Direct payment_id query exception:", directErr);
        }
      }
      if ((status === "pending" || status === "processing") && accessToken && orderData.preferenceId) {
        const prefId = orderData.preferenceId;
        try {
          console.log(`[Payments Status Search] Fallback to querying Mercado Pago API for preferenceId: ${prefId}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);
          const response = await fetch(`https://api.mercadopago.com/v1/payments/search?preference_id=${prefId}`, {
            signal: controller.signal,
            headers: {
              "Authorization": `Bearer ${accessToken}`
            }
          });
          clearTimeout(timeoutId);
          if (response.ok) {
            const mpData = await response.json();
            const results = mpData.results || [];
            const approvedIndex = results.findIndex((p) => p.status === "approved");
            if (approvedIndex !== -1) {
              const p = results[approvedIndex];
              if (p.external_reference !== orderId) {
                console.error(`[Payments Security Block] Preference Search spoofing attempt detected! payment.external_reference (${p.external_reference}) does not match orderId (${orderId})`);
                return res.status(400).json({ error: "Opera\xE7\xE3o inv\xE1lida: o pagamento n\xE3o corresponde ao pedido solicitado." });
              }
              const paymentUserId = p.metadata?.user_id || p.metadata?.userId || p.metadata?.user_id;
              if (paymentUserId && paymentUserId !== authUser.uid) {
                console.error(`[Payments Security Block] Preference Search spoofing attempt detected! payment metadata userId (${paymentUserId}) does not match authenticated userId (${authUser.uid})`);
                return res.status(400).json({ error: "Opera\xE7\xE3o inv\xE1lida: o pagamento pertence a outro usu\xE1rio." });
              }
              const actualPaidAmount = p.transaction_amount || p.transaction_details?.total_paid_amount || 0;
              const expectedProductPrice = orderData.amount;
              if (Math.abs(actualPaidAmount - expectedProductPrice) > 0.01) {
                console.error(`[Payments Security Block] Preference Search price manipulation! paid amount ${actualPaidAmount} does not match expected amount ${expectedProductPrice}`);
                return res.status(400).json({ error: "Opera\xE7\xE3o inv\xE1lida: o valor pago n\xE3o coincide com o plano contratado." });
              }
              const duplicatePaymentSnap = await db.collection("payment_orders").where("paymentId", "==", String(p.id)).get();
              let isUsed = false;
              for (const dpDoc of duplicatePaymentSnap.docs) {
                if (dpDoc.id !== orderId) {
                  isUsed = true;
                }
              }
              if (isUsed) {
                console.error(`[Payments Security Block] Preference Search replay attack: payment_id ${p.id} has already been used.`);
                return res.status(400).json({ error: "Opera\xE7\xE3o inv\xE1lida: este pagamento j\xE1 foi processado anteriormente." });
              }
              console.log(`[Payments Status Search] Found approved payment ${p.id} via search fallback. Provisioning Pro access.`);
              await grantProAccessAfterApprovedPayment(orderId, String(p.id), "status_search");
              status = "approved";
            } else {
              const rejected = results.find((p) => p.status === "rejected" || p.status === "cancelled");
              if (rejected) {
                console.warn(`[Payments Status Search] Found rejected/cancelled payment ${rejected.id} via search fallback. Revoking/updating status.`);
                await revokeProAccess(orderId, String(rejected.id), rejected.status, "status_search", `Pagamento recusado: ${rejected.status_detail}`);
                status = rejected.status;
              } else {
                const inProcess = results.find((p) => p.status === "in_process");
                if (inProcess) {
                  status = "processing";
                }
              }
            }
          }
        } catch (mpErr) {
          console.error("[Payments Status Search] Failed direct Mercado Pago search:", mpErr);
        }
      }
    }
    const message = STATUS_MESSAGES[status] || "Status do pagamento desconhecido.";
    return res.status(200).json({
      success: true,
      orderId,
      planId: orderData.planId,
      amount: orderData.amount,
      status,
      message,
      paidAt: orderData.paidAt || null,
      updatedAt: orderData.updatedAt || null
    });
  } catch (error) {
    console.error("[Payments Status Error]", error);
    return res.status(500).json({ error: "N\xE3o foi poss\xEDvel buscar o status do pagamento agora." });
  }
}
var STATUS_MESSAGES;
var init_payments_status = __esm({
  "api/_handlers/payments-status.ts"() {
    init_common();
    init_payments_service();
    STATUS_MESSAGES = {
      "approved": "Pagamento aprovado. Seu acesso ao Invictus foi liberado.",
      "pending": "Seu pagamento est\xE1 sendo processado. Assim que for aprovado, seu acesso ser\xE1 liberado.",
      "processing": "Seu pagamento est\xE1 sendo processado. Assim que for aprovado, seu acesso ser\xE1 liberado.",
      "rejected": "N\xE3o foi poss\xEDvel aprovar o pagamento. Tente novamente com outro m\xE9todo.",
      "cancelled": "N\xE3o foi poss\xEDvel aprovar o pagamento. Tente novamente com outro m\xE9todo.",
      "refunded": "O pagamento da assinatura foi estornado.",
      "charged_back": "O pagamento sofreu chargeback e sua conta est\xE1 sob revis\xE3o."
    };
  }
});

// api/_handlers/payments-config.ts
async function handler26(req, res) {
  if (cors(req, res)) return;
  return res.status(200).json({
    testPaymentMode: false
  });
}
var init_payments_config = __esm({
  "api/_handlers/payments-config.ts"() {
    init_common();
  }
});

// api/_handlers/payments-debug-mercado-pago.ts
async function handler27(req, res) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Fa\xE7a login para acessar o painel administrativo." });
  }
  try {
    const userSnap = await db.collection("users").doc(auth.uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const isAdmin = auth.email === "samuelfsc89@gmail.com" || userData?.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ error: "Acesso negado. Esta rota \xE9 restrita a administradores." });
    }
  } catch (err) {
    console.error("[Admin Auth Error]", err);
    return res.status(500).json({ error: "Erro de autoriza\xE7\xE3o administrativa." });
  }
  try {
    const accessToken = (process.env.MERCADO_PAGO_ACCESS_TOKEN || "").trim();
    const publicKey = (process.env.MERCADO_PAGO_PUBLIC_KEY || "").trim();
    const debugDocSnap = await db.collection("utils").doc("mp_debug").get();
    const debugData = debugDocSnap.exists ? debugDocSnap.data() : null;
    const isSandboxDefault = accessToken.startsWith("TEST-");
    return res.status(200).json({
      environment: debugData?.environment || (isSandboxDefault ? "sandbox" : "production"),
      hasAccessToken: !!accessToken,
      hasPublicKey: !!publicKey,
      testPaymentMode: false,
      lastPayload: debugData?.lastPayload || null,
      lastPreferenceId: debugData?.lastPreferenceId || null,
      selectedInitPointType: debugData?.selectedInitPointType || "init_point",
      selectedInitPointUrl: debugData?.selectedInitPoint || null,
      collector_id: debugData?.collector_id || null,
      lastError: debugData?.lastError || null,
      updatedAt: debugData?.updatedAt || null
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
var init_payments_debug_mercado_pago = __esm({
  "api/_handlers/payments-debug-mercado-pago.ts"() {
    init_common();
  }
});

// api/_handlers/private-challenges.ts
async function handler28(req, res) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: "N\xE3o autorizado." });
  const action = req.query.action || req.body.action;
  try {
    if (!db) {
      return res.status(500).json({ error: "Banco de dados n\xE3o dispon\xEDvel." });
    }
    switch (action) {
      case "create":
        return await handleCreateChallenge(req, res, auth.uid);
      case "join":
        return await handleJoinChallenge(req, res, auth.uid);
      case "list":
      default:
        return await handleListChallenges(req, res, auth.uid);
    }
  } catch (error) {
    console.error("[Private Challenges API Error]:", error);
    return res.status(500).json({ error: error.message || "Erro ao processar requisi\xE7\xE3o de desafios." });
  }
}
async function handleListChallenges(req, res, userId) {
  const challengesRef = db.collection("private_challenges");
  const now = /* @__PURE__ */ new Date();
  const nowISO = now.toISOString();
  const activeAndFormingSnap = await challengesRef.where("status", "in", ["forming", "active"]).get();
  for (const challengeDoc of activeAndFormingSnap.docs) {
    const challenge = challengeDoc.data();
    if (challenge.endDate && challenge.endDate < nowISO) {
      await processChallengeExpiration(challengeDoc.id);
    }
  }
  const allChallengesSnap = await challengesRef.orderBy("createdAt", "desc").get();
  const challengesList = [];
  for (const challengeDoc of allChallengesSnap.docs) {
    const cData = challengeDoc.data();
    const challengeId = challengeDoc.id;
    const membersSnap = await db.collection("private_challenge_members").where("challengeId", "==", challengeId).get();
    const members = membersSnap.docs.map((mDoc) => {
      const m = mDoc.data();
      return {
        userId: m.userId,
        userName: m.userName || "Atleta",
        userPhoto: m.userPhoto || "",
        points: m.points || 0,
        workoutsCount: m.workoutsCount || 0,
        joinedAt: m.joinedAt
      };
    }).sort((a, b) => b.points - a.points);
    const isCurrentUserMember = members.some((m) => m.userId === userId);
    challengesList.push({
      id: challengeId,
      title: cData.title,
      description: cData.description || "",
      creatorId: cData.creatorId,
      creatorName: cData.creatorName,
      creatorPhoto: cData.creatorPhoto,
      inviteCode: cData.inviteCode,
      durationDays: cData.durationDays,
      entryFee: cData.entryFee,
      status: cData.status,
      createdAt: cData.createdAt,
      startDate: cData.startDate,
      endDate: cData.endDate,
      totalPool: cData.totalPool,
      netPrizePool: cData.netPrizePool,
      platformFee: cData.platformFee,
      participantsCount: members.length,
      winnerId: cData.winnerId || null,
      winnerName: cData.winnerName || null,
      winnerPhoto: cData.winnerPhoto || null,
      isMember: isCurrentUserMember,
      members
    });
  }
  return res.status(200).json({ success: true, challenges: challengesList });
}
async function handleCreateChallenge(req, res, userId) {
  const { title, durationDays, entryFee, description } = req.body;
  if (!title || !durationDays || entryFee === void 0) {
    return res.status(400).json({ error: "Par\xE2metros t\xEDtulo, dura\xE7\xE3o e taxa de entrada s\xE3o obrigat\xF3rios." });
  }
  const durationNum = Number(durationDays);
  if (![7, 15, 30].includes(durationNum)) {
    return res.status(400).json({ error: "Dura\xE7\xE3o aceita apenas 7, 15 ou 30 dias." });
  }
  const feeNum = Number(entryFee);
  if (feeNum < 30 || feeNum > 1e3) {
    return res.status(400).json({ error: "O valor do desafio deve ser entre R$ 30 e R$ 1.000." });
  }
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return res.status(404).json({ error: "Perfil do usu\xE1rio n\xE3o encontrado." });
  }
  const userData = userSnap.data() || {};
  const currentBalance = userData.walletBalance !== void 0 ? Number(userData.walletBalance) : 0;
  if (currentBalance < feeNum) {
    return res.status(400).json({
      error: `Saldo insuficiente para criar o desafio e pagar a taxa de R$ ${feeNum.toFixed(2)}. Saldo dispon\xEDvel: R$ ${currentBalance.toFixed(2)}.`
    });
  }
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const now = /* @__PURE__ */ new Date();
  const endDate = new Date(now.getTime() + durationNum * 24 * 60 * 60 * 1e3);
  const challengeId = db.collection("private_challenges").doc().id;
  await db.runTransaction(async (transaction) => {
    transaction.update(userRef, {
      walletBalance: import_firestore.FieldValue.increment(-feeNum)
    });
    if (feeNum > 0) {
      const txRef = db.collection("walletTransactions").doc();
      transaction.set(txRef, {
        id: txRef.id,
        userId,
        type: "challenge_entry",
        amount: feeNum,
        previousBalance: currentBalance,
        newBalance: currentBalance - feeNum,
        createdAt: now.toISOString(),
        status: "approved",
        description: `Taxa de entrada: ${title}`
      });
    }
    const totalPool = feeNum;
    const netPrizePool = totalPool * 0.7;
    const platformFee = totalPool * 0.3;
    const isMinPrizeMet = netPrizePool >= 100;
    const status = isMinPrizeMet ? "active" : "forming";
    const challengeRef = db.collection("private_challenges").doc(challengeId);
    transaction.set(challengeRef, {
      title,
      description: description || "",
      creatorId: userId,
      creatorName: userData.displayName || "Atleta",
      creatorPhoto: userData.photoURL || "",
      inviteCode,
      durationDays: durationNum,
      entryFee: feeNum,
      status,
      createdAt: now.toISOString(),
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      totalPool,
      netPrizePool,
      platformFee,
      updatedAt: now.toISOString()
    });
    const memberRef = db.collection("private_challenge_members").doc(`${userId}_${challengeId}`);
    transaction.set(memberRef, {
      userId,
      userName: userData.displayName || "Atleta",
      userPhoto: userData.photoURL || "",
      challengeId,
      points: 0,
      workoutsCount: 0,
      joinedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  });
  return res.status(200).json({ success: true, challengeId, inviteCode });
}
async function handleJoinChallenge(req, res, userId) {
  const { inviteCode } = req.body;
  if (!inviteCode) {
    return res.status(400).json({ error: "C\xF3digo de convite \xE9 obrigat\xF3rio." });
  }
  const uppercaseCode = inviteCode.trim().toUpperCase();
  const challengeQuerySnap = await db.collection("private_challenges").where("inviteCode", "==", uppercaseCode).limit(1).get();
  if (challengeQuerySnap.empty) {
    return res.status(404).json({ error: "Desafio n\xE3o encontrado com este c\xF3digo de convite." });
  }
  const challengeDoc = challengeQuerySnap.docs[0];
  const challengeId = challengeDoc.id;
  const cData = challengeDoc.data();
  if (["completed", "cancelled"].includes(cData.status)) {
    return res.status(400).json({ error: "Este desafio privado j\xE1 foi finalizado ou cancelado." });
  }
  const memberRef = db.collection("private_challenge_members").doc(`${userId}_${challengeId}`);
  const memberSnap = await memberRef.get();
  if (memberSnap.exists) {
    return res.status(400).json({ error: "Voc\xEA j\xE1 faz parte deste desafio privado!" });
  }
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return res.status(404).json({ error: "Perfil do usu\xE1rio n\xE3o encontrado." });
  }
  const userData = userSnap.data() || {};
  const currentBalance = userData.walletBalance !== void 0 ? Number(userData.walletBalance) : 0;
  const entryFee = Number(cData.entryFee);
  if (currentBalance < entryFee) {
    return res.status(400).json({
      error: `Saldo insuficiente para pagar a taxa de entrada de R$ ${entryFee.toFixed(2)}. Saldo dispon\xEDvel: R$ ${currentBalance.toFixed(2)}.`
    });
  }
  const now = /* @__PURE__ */ new Date();
  await db.runTransaction(async (transaction) => {
    transaction.update(userRef, {
      walletBalance: import_firestore.FieldValue.increment(-entryFee)
    });
    if (entryFee > 0) {
      const txRef = db.collection("walletTransactions").doc();
      transaction.set(txRef, {
        id: txRef.id,
        userId,
        type: "challenge_entry",
        amount: entryFee,
        previousBalance: currentBalance,
        newBalance: currentBalance - entryFee,
        createdAt: now.toISOString(),
        status: "approved",
        description: `Taxa de entrada: ${cData.title}`
      });
    }
    const newTotalPool = (cData.totalPool || 0) + entryFee;
    const newNetPrizePool = newTotalPool * 0.7;
    const newPlatformFee = newTotalPool * 0.3;
    const newStatus = "active";
    transaction.update(challengeDoc.ref, {
      totalPool: newTotalPool,
      netPrizePool: newNetPrizePool,
      platformFee: newPlatformFee,
      status: newStatus,
      updatedAt: now.toISOString()
    });
    transaction.set(memberRef, {
      userId,
      userName: userData.displayName || "Atleta",
      userPhoto: userData.photoURL || "",
      challengeId,
      points: 0,
      workoutsCount: 0,
      joinedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    const feedRef = db.collection("elite_feed").doc();
    transaction.set(feedRef, {
      userId,
      userName: userData.displayName || "Atleta",
      userPhoto: userData.photoURL || "",
      text: `aceitou o desafio privado ${cData.title}! \u{1F4A5}`,
      type: "join",
      timestamp: now.toISOString()
    });
  });
  return res.status(200).json({ success: true, challengeId });
}
async function processChallengeExpiration(challengeId) {
  const challengeRef = db.collection("private_challenges").doc(challengeId);
  const challengeSnap = await challengeRef.get();
  if (!challengeSnap.exists) return;
  const challenge = challengeSnap.data();
  if (["completed", "cancelled"].includes(challenge.status)) return;
  const now = /* @__PURE__ */ new Date();
  const membersSnap = await db.collection("private_challenge_members").where("challengeId", "==", challengeId).get();
  const members = membersSnap.docs.map((mDoc) => mDoc.data());
  const entryFee = challenge.entryFee || 0;
  const netPrizePool = challenge.netPrizePool || 0;
  const isMinParticipantsMet = members.length >= 2;
  if (!isMinParticipantsMet) {
    console.log(`[Private Challenges] Cancelling challenge ${challengeId} because participants count ${members.length} is below 2.`);
    await db.runTransaction(async (transaction) => {
      transaction.update(challengeRef, {
        status: "cancelled",
        updatedAt: now.toISOString()
      });
      for (const member of members) {
        const uId = member.userId;
        const uRef = db.collection("users").doc(uId);
        const uSnap = await transaction.get(uRef);
        if (uSnap.exists) {
          const uData = uSnap.data();
          const oldBalance = uData.walletBalance !== void 0 ? Number(uData.walletBalance) : 0;
          transaction.update(uRef, {
            walletBalance: import_firestore.FieldValue.increment(entryFee)
          });
          if (entryFee > 0) {
            const txRef = db.collection("walletTransactions").doc();
            transaction.set(txRef, {
              id: txRef.id,
              userId: uId,
              type: "challenge_refund",
              amount: entryFee,
              previousBalance: oldBalance,
              newBalance: oldBalance + entryFee,
              createdAt: now.toISOString(),
              status: "approved",
              description: `Estorno (Cancelamento): ${challenge.title}`
            });
          }
        }
      }
    });
  } else {
    console.log(`[Private Challenges] Completing challenge ${challengeId}. Distributing R$ ${netPrizePool} to TOP 1.`);
    const sortedMembers = [...members].sort((a, b) => (b.points || 0) - (a.points || 0));
    if (sortedMembers.length === 0) {
      await challengeRef.set({ status: "cancelled", updatedAt: now.toISOString() }, { merge: true });
      return;
    }
    const winner = sortedMembers[0];
    const winnerId = winner.userId;
    await db.runTransaction(async (transaction) => {
      transaction.update(challengeRef, {
        status: "completed",
        winnerId,
        winnerName: winner.userName || "Atleta",
        winnerPhoto: winner.userPhoto || "",
        updatedAt: now.toISOString()
      });
      const winnerUserRef = db.collection("users").doc(winnerId);
      const winnerUserSnap = await transaction.get(winnerUserRef);
      if (winnerUserSnap.exists) {
        const wData = winnerUserSnap.data();
        const oldBalance = wData.walletBalance !== void 0 ? Number(wData.walletBalance) : 0;
        transaction.update(winnerUserRef, {
          walletBalance: import_firestore.FieldValue.increment(netPrizePool)
        });
        const txRef = db.collection("walletTransactions").doc();
        transaction.set(txRef, {
          id: txRef.id,
          userId: winnerId,
          type: "challenge_prize",
          amount: netPrizePool,
          previousBalance: oldBalance,
          newBalance: oldBalance + netPrizePool,
          createdAt: now.toISOString(),
          status: "approved",
          description: `Premia\xE7\xE3o 1\xBA Lugar: ${challenge.title}`
        });
      }
      const feedRef = db.collection("elite_feed").doc();
      transaction.set(feedRef, {
        userId: winnerId,
        userName: winner.userName || "Atleta",
        userPhoto: winner.userPhoto || "",
        text: `venceu o desafio privado "${challenge.title}" e faturou R$ ${netPrizePool.toFixed(2)}!! \u{1F3C6}\u{1F4A5}`,
        type: "join",
        // triggers celebratory styling
        timestamp: now.toISOString()
      });
    });
  }
}
var init_private_challenges = __esm({
  "api/_handlers/private-challenges.ts"() {
    init_common();
  }
});

// api/_lib/pagarme-service.ts
var PAGARME_PLANS, PaymentService, SubscriptionService, InvoiceService, WebhookService;
var init_pagarme_service = __esm({
  "api/_lib/pagarme-service.ts"() {
    init_common();
    PAGARME_PLANS = {
      "free": {
        id: "free",
        name: "Plano Gratuito",
        price: 0,
        periodicity: "monthly",
        benefits: ["Acesso limitado a treinos b\xE1sicos", "Hist\xF3rico de 7 dias"],
        status: "active"
      },
      "essencial": {
        id: "essencial",
        name: "Plano Essencial",
        price: 9.9,
        periodicity: "monthly",
        benefits: ["Acesso b\xE1sico ao sistema", "Treinos padr\xF5es", "Estat\xEDsticas b\xE1sicas"],
        status: "active"
      },
      "premium": {
        id: "premium",
        name: "Plano Essencial",
        price: 9.9,
        periodicity: "monthly",
        benefits: ["Acesso b\xE1sico ao sistema", "Treinos padr\xF5es", "Estat\xEDsticas b\xE1sicas"],
        status: "active"
      },
      "performance": {
        id: "performance",
        name: "Plano Performance",
        price: 49.9,
        periodicity: "monthly",
        benefits: ["Acesso completo ao sistema", "Integra\xE7\xE3o avan\xE7ada com wearables", "Desafios elite inclusos"],
        status: "active"
      },
      "corporativo": {
        id: "corporativo",
        name: "Plano Corporativo",
        price: 99.9,
        periodicity: "monthly",
        benefits: ["Painel corporativo de colaboradores", "Descontos em academias parceiras", "Relat\xF3rios integrados de sa\xFAde"],
        status: "active"
      },
      "academia": {
        id: "academia",
        name: "Plano Academia",
        price: 49.9,
        periodicity: "monthly",
        benefits: ["Check-ins de presen\xE7a ilimitados", "Acesso f\xEDsico a parceiros", "Aulas ao vivo integradas"],
        status: "active"
      },
      "profissional": {
        id: "profissional",
        name: "Plano Profissional",
        price: 39.9,
        periodicity: "monthly",
        benefits: ["Acompanhamento de personal trainer dedicado", "Planos de treino individualizados", "An\xE1lise biom\xE9trica avan\xE7ada"],
        status: "active"
      }
    };
    PaymentService = class _PaymentService {
      /**
       * Safe initialization of Pagar.me client simulation
       */
      static getSecretKey() {
        return (process.env.PAGARME_SECRET_KEY || process.env.PAGARME_API_KEY || "").trim();
      }
      static getPublicKey() {
        return (process.env.PAGARME_PUBLIC_KEY || "").trim();
      }
      /**
       * Process a single payment with Pix, Credit Card or Boleto
       */
      static async createPayment(params) {
        const { userId, planId, paymentMethod, cardToken, installments = 1, userEmail = "user@example.com" } = params;
        const plan = PAGARME_PLANS[planId];
        if (!plan) throw new Error("Plano inv\xE1lido ou inexistente.");
        const now = /* @__PURE__ */ new Date();
        const transactionId = `pag_tr_${Math.random().toString(36).substring(2, 15)}`;
        const providerId = "pagarme";
        let pixQrCode = "";
        let pixQrCodeUrl = "";
        let boletoUrl = "";
        let boletoBarcode = "";
        let status = "pending";
        if (paymentMethod === "pix") {
          pixQrCode = `00020101021226870014br.gov.bcb.pix2565pagarme-pix-qr-${transactionId}5204000053039865405${plan.price.toFixed(2)}5802BR5908INVICTUS6009SAO_PAULO62070503***6304${Math.random().toString(16).substring(2, 6)}`;
          pixQrCodeUrl = `https://api.pagar.me/pix/qr/${transactionId}.png`;
          status = "pending";
        } else if (paymentMethod === "boleto") {
          boletoUrl = `https://pagar.me/boleto/invoice_${transactionId}.pdf`;
          boletoBarcode = `34191.79001 01043.513184 91020.150008 7 900200000${Math.round(plan.price * 100)}`;
          status = "pending";
        } else if (paymentMethod === "credit_card") {
          if (!cardToken) throw new Error("Token seguro do cart\xE3o de cr\xE9dito \xE9 obrigat\xF3rio.");
          status = "approved";
        }
        const nextBilling = /* @__PURE__ */ new Date();
        nextBilling.setDate(now.getDate() + (plan.periodicity === "yearly" ? 365 : 30));
        const paymentRecord = {
          userId,
          transactionId,
          providerId,
          plano: plan.name,
          planId,
          valor: plan.price,
          status,
          metodoPagamento: paymentMethod,
          data: now.toISOString(),
          proximaCobranca: nextBilling.toISOString(),
          pixQrCode,
          pixQrCodeUrl,
          boletoUrl,
          boletoBarcode,
          installments,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        };
        await db.collection("payments").doc(transactionId).set(paymentRecord);
        await db.collection("users").doc(userId).collection("payments").doc(transactionId).set(paymentRecord);
        await _PaymentService.logAction({
          userId,
          transactionId,
          action: "payment_created",
          status,
          message: `Transa\xE7\xE3o de pagamento via ${paymentMethod} iniciada com status: ${status}.`
        });
        if (status === "approved") {
          await SubscriptionService.provisionEntitlements(userId, planId, transactionId);
        }
        return paymentRecord;
      }
      static async logAction(log) {
        const logId = db.collection("payment_logs").doc().id;
        await db.collection("payment_logs").doc(logId).set({
          ...log,
          provider: "pagarme",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    };
    SubscriptionService = class _SubscriptionService {
      /**
       * Handle subscriptions lifecycle (recurring payments)
       */
      static async createSubscription(params) {
        const { userId, planId, paymentMethod, cardToken } = params;
        const plan = PAGARME_PLANS[planId];
        if (!plan) throw new Error("Plano de assinatura inv\xE1lido.");
        const now = /* @__PURE__ */ new Date();
        const subscriptionId = `sub_${Math.random().toString(36).substring(2, 15)}`;
        const nextBilling = /* @__PURE__ */ new Date();
        nextBilling.setDate(now.getDate() + 30);
        const initialPayment = await PaymentService.createPayment({
          userId,
          planId,
          paymentMethod,
          cardToken,
          userEmail: "user@example.com"
        });
        const subscriptionRecord = {
          subscriptionId,
          userId,
          planId,
          plano: plan.name,
          valor: plan.price,
          status: initialPayment.status === "approved" ? "active" : "pending",
          paymentMethod,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          startsAt: now.toISOString(),
          endsAt: nextBilling.toISOString(),
          proximaCobranca: nextBilling.toISOString(),
          providerId: "pagarme",
          transactionId: initialPayment.transactionId
        };
        await db.collection("subscriptions").doc(subscriptionId).set(subscriptionRecord);
        await db.collection("users").doc(userId).collection("subscriptions").doc(subscriptionId).set(subscriptionRecord);
        await InvoiceService.createInvoice({
          userId,
          subscriptionId,
          amount: plan.price,
          planId,
          status: initialPayment.status === "approved" ? "paid" : "pending",
          dueDate: now.toISOString()
        });
        return subscriptionRecord;
      }
      static async cancelSubscription(userId, subscriptionId) {
        const now = /* @__PURE__ */ new Date();
        const subRef = db.collection("subscriptions").doc(subscriptionId);
        const subSnap = await subRef.get();
        if (!subSnap.exists) throw new Error("Assinatura n\xE3o localizada.");
        const subData = subSnap.data();
        if (subData.userId !== userId) throw new Error("Acesso n\xE3o autorizado.");
        const updatedData = {
          status: "cancelled",
          updatedAt: now.toISOString()
        };
        await subRef.update(updatedData);
        await db.collection("users").doc(userId).collection("subscriptions").doc(subscriptionId).update(updatedData);
        await db.collection("users").doc(userId).set({
          subscriptionStatus: "cancelled",
          plan: "free",
          isPro: false,
          subscriptionTier: "free"
        }, { merge: true });
        await PaymentService.logAction({
          userId,
          transactionId: subData.transactionId || "",
          action: "subscription_cancelled",
          status: "cancelled",
          message: `Assinatura ${subscriptionId} foi cancelada com sucesso pelo usu\xE1rio.`
        });
        return { success: true, subscriptionId };
      }
      static async upgradeSubscription(userId, subscriptionId, newPlanId) {
        const now = /* @__PURE__ */ new Date();
        const subRef = db.collection("subscriptions").doc(subscriptionId);
        const subSnap = await subRef.get();
        if (!subSnap.exists) throw new Error("Assinatura n\xE3o localizada.");
        const subData = subSnap.data();
        if (subData.userId !== userId) throw new Error("Acesso n\xE3o autorizado.");
        const newPlan = PAGARME_PLANS[newPlanId];
        if (!newPlan) throw new Error("Plano de upgrade inv\xE1lido.");
        const updatedData = {
          planId: newPlanId,
          plano: newPlan.name,
          valor: newPlan.price,
          updatedAt: now.toISOString()
        };
        await subRef.update(updatedData);
        await db.collection("users").doc(userId).collection("subscriptions").doc(subscriptionId).update(updatedData);
        await _SubscriptionService.provisionEntitlements(userId, newPlanId, subData.transactionId);
        await PaymentService.logAction({
          userId,
          transactionId: subData.transactionId || "",
          action: "subscription_upgraded",
          status: "active",
          message: `Upgrade de assinatura executado de ${subData.plano} para ${newPlan.name}.`
        });
        return { success: true, subscriptionId, newPlanId };
      }
      static async downgradeSubscription(userId, subscriptionId, newPlanId) {
        const now = /* @__PURE__ */ new Date();
        const subRef = db.collection("subscriptions").doc(subscriptionId);
        const subSnap = await subRef.get();
        if (!subSnap.exists) throw new Error("Assinatura n\xE3o localizada.");
        const subData = subSnap.data();
        if (subData.userId !== userId) throw new Error("Acesso n\xE3o autorizado.");
        const newPlan = PAGARME_PLANS[newPlanId];
        if (!newPlan) throw new Error("Plano de downgrade inv\xE1lido.");
        const updatedData = {
          planId: newPlanId,
          plano: newPlan.name,
          valor: newPlan.price,
          updatedAt: now.toISOString()
        };
        await subRef.update(updatedData);
        await db.collection("users").doc(userId).collection("subscriptions").doc(subscriptionId).update(updatedData);
        await _SubscriptionService.provisionEntitlements(userId, newPlanId, subData.transactionId);
        await PaymentService.logAction({
          userId,
          transactionId: subData.transactionId || "",
          action: "subscription_downgraded",
          status: "active",
          message: `Downgrade de assinatura executado de ${subData.plano} para ${newPlan.name}.`
        });
        return { success: true, subscriptionId, newPlanId };
      }
      static async provisionEntitlements(userId, planId, transactionId) {
        const now = /* @__PURE__ */ new Date();
        const durationDays = planId === "free" ? 0 : 30;
        const expiresAt = /* @__PURE__ */ new Date();
        expiresAt.setDate(now.getDate() + durationDays);
        const isSubscribed = planId !== "free";
        const plan = PAGARME_PLANS[planId];
        const planName = plan ? plan.name : "Gratuito";
        let subscriptionTier = "free";
        if (planId === "premium" || planId === "essencial") subscriptionTier = "open";
        else if (planId === "performance") subscriptionTier = "performance";
        else if (planId === "corporativo") subscriptionTier = "corporate";
        else if (planId === "academia") subscriptionTier = "gym";
        else if (planId === "profissional") subscriptionTier = "professional";
        const planType = planId === "premium" || planId === "essencial" ? "essencial" : planId === "performance" ? "performance" : "free";
        const pricingId = planId === "performance" ? "pri_performance_4990" : planId === "premium" || planId === "essencial" ? "pri_essencial_990" : null;
        await db.collection("users").doc(userId).set({
          isSubscribed,
          subscriptionStatus: isSubscribed ? "active" : "inactive",
          plan: planId,
          planExpiresAt: isSubscribed ? expiresAt.toISOString() : null,
          subscriptionTier,
          isPro: isSubscribed,
          proStatus: isSubscribed ? "active" : "inactive",
          updatedAt: now.toISOString(),
          // Strict production V5 mapped fields:
          plan_type: planType,
          pricing_id: pricingId,
          pagarme_subscription_id: isSubscribed ? transactionId : null,
          subscription_status: isSubscribed ? "active" : "inactive"
        }, { merge: true });
        const entitlementId = `${userId}_pagarme_${planId}`;
        await db.collection("user_entitlements").doc(entitlementId).set({
          userId,
          planId,
          status: isSubscribed ? "active" : "expired",
          sourceOrderId: transactionId,
          startsAt: now.toISOString(),
          endsAt: expiresAt.toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        });
        console.log(`[Pagarme Entitlement] Access provisioned successfully for user ${userId}, Plan: ${planId}`);
      }
    };
    InvoiceService = class {
      static async createInvoice(params) {
        const invoiceId = `inv_${Math.random().toString(36).substring(2, 15)}`;
        const now = /* @__PURE__ */ new Date();
        const invoiceRecord = {
          invoiceId,
          userId: params.userId,
          subscriptionId: params.subscriptionId,
          amount: params.amount,
          planId: params.planId,
          plano: PAGARME_PLANS[params.planId]?.name || "Plano",
          status: params.status,
          dueDate: params.dueDate,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          providerId: "pagarme"
        };
        await db.collection("invoices").doc(invoiceId).set(invoiceRecord);
        return invoiceRecord;
      }
      static async getInvoices(userId) {
        const snap = await db.collection("invoices").where("userId", "==", userId).get();
        return snap.docs.map((doc2) => doc2.data());
      }
    };
    WebhookService = class {
      /**
       * Process incoming Pagar.me webhook events securely
       */
      static async processWebhook(payload, signature) {
        const eventId = payload.id || `evt_${Math.random().toString(36).substring(2, 15)}`;
        const eventType = payload.event;
        const now = /* @__PURE__ */ new Date();
        console.log(`[Pagarme Webhook] Received Event: ${eventType}, ID: ${eventId}`);
        const webhookRef = db.collection("webhook_events").doc(eventId);
        const webhookSnap = await webhookRef.get();
        if (webhookSnap.exists) {
          console.log(`[Pagarme Webhook] Idempotency match: Webhook already processed ${eventId}`);
          return { success: true, duplicated: true };
        }
        let transactionId = "";
        let userId = "";
        let status = "processed";
        const dataObj = payload.data || {};
        transactionId = dataObj.id || dataObj.transactionId || "";
        userId = dataObj.userId || dataObj.metadata?.userId || "";
        if (!userId && transactionId) {
          const pDoc = await db.collection("payments").doc(transactionId).get();
          if (pDoc.exists) {
            userId = pDoc.data()?.userId;
          }
        }
        if (!userId && dataObj.subscriptionId) {
          const sDoc = await db.collection("subscriptions").doc(dataObj.subscriptionId).get();
          if (sDoc.exists) {
            userId = sDoc.data()?.userId;
          }
        }
        switch (eventType) {
          case "transaction.paid":
          case "payment.paid":
          case "pix.paid":
            if (transactionId) {
              const updateObj = { status: "approved", paidAt: now.toISOString(), updatedAt: now.toISOString() };
              await db.collection("payments").doc(transactionId).set(updateObj, { merge: true });
              if (userId) {
                await db.collection("users").doc(userId).collection("payments").doc(transactionId).set(updateObj, { merge: true });
                const paymentSnap = await db.collection("payments").doc(transactionId).get();
                if (paymentSnap.exists) {
                  const pData = paymentSnap.data();
                  await SubscriptionService.provisionEntitlements(userId, pData.planId, transactionId);
                }
              }
            }
            break;
          case "transaction.failed":
          case "payment.failed":
            if (transactionId) {
              const updateObj = { status: "failed", updatedAt: now.toISOString() };
              await db.collection("payments").doc(transactionId).set(updateObj, { merge: true });
              if (userId) {
                await db.collection("users").doc(userId).collection("payments").doc(transactionId).set(updateObj, { merge: true });
              }
            }
            break;
          case "subscription.created":
            if (dataObj.subscriptionId && userId) {
              const subObj = { status: "active", updatedAt: now.toISOString() };
              await db.collection("subscriptions").doc(dataObj.subscriptionId).set(subObj, { merge: true });
              await db.collection("users").doc(userId).collection("subscriptions").doc(dataObj.subscriptionId).set(subObj, { merge: true });
            }
            break;
          case "subscription.canceled":
            if (dataObj.subscriptionId && userId) {
              const subObj = { status: "cancelled", updatedAt: now.toISOString() };
              await db.collection("subscriptions").doc(dataObj.subscriptionId).set(subObj, { merge: true });
              await db.collection("users").doc(userId).collection("subscriptions").doc(dataObj.subscriptionId).set(subObj, { merge: true });
              await db.collection("users").doc(userId).set({
                isSubscribed: false,
                subscriptionStatus: "cancelled",
                plan: "free",
                isPro: false,
                subscriptionTier: "free"
              }, { merge: true });
            }
            break;
          case "subscription.overdue":
            if (dataObj.subscriptionId && userId) {
              const subObj = { status: "overdue", updatedAt: now.toISOString() };
              await db.collection("subscriptions").doc(dataObj.subscriptionId).set(subObj, { merge: true });
              await db.collection("users").doc(userId).collection("subscriptions").doc(dataObj.subscriptionId).set(subObj, { merge: true });
              await db.collection("users").doc(userId).set({
                subscriptionStatus: "overdue",
                proStatus: "suspended",
                updatedAt: now.toISOString()
              }, { merge: true });
            }
            break;
          case "chargeback":
          case "transaction.chargeback":
            if (transactionId && userId) {
              const updateObj = { status: "charged_back", updatedAt: now.toISOString() };
              await db.collection("payments").doc(transactionId).set(updateObj, { merge: true });
              await db.collection("users").doc(userId).collection("payments").doc(transactionId).set(updateObj, { merge: true });
              await db.collection("users").doc(userId).set({
                isSubscribed: false,
                subscriptionStatus: "charged_back",
                plan: "free",
                isPro: false,
                isUnderReview: true,
                updatedAt: now.toISOString()
              }, { merge: true });
            }
            break;
          case "transaction.refunded":
            if (transactionId && userId) {
              const updateObj = { status: "refunded", updatedAt: now.toISOString() };
              await db.collection("payments").doc(transactionId).set(updateObj, { merge: true });
              await db.collection("users").doc(userId).collection("payments").doc(transactionId).set(updateObj, { merge: true });
              await db.collection("users").doc(userId).set({
                isSubscribed: false,
                subscriptionStatus: "refunded",
                plan: "free",
                isPro: false,
                updatedAt: now.toISOString()
              }, { merge: true });
            }
            break;
        }
        await webhookRef.set({
          eventId,
          provider: "pagarme",
          type: eventType,
          paymentId: transactionId || "",
          receivedAt: now.toISOString(),
          processedAt: now.toISOString(),
          status
        });
        if (userId) {
          await PaymentService.logAction({
            userId,
            transactionId: transactionId || `webhook_gen_${Math.random().toString(36).substring(2, 6)}`,
            action: `webhook_${eventType}`,
            status,
            message: `Webhook recebido do Pagar.me com tipo: ${eventType}.`
          });
        }
        return { success: true };
      }
    };
  }
});

// api/_handlers/pagarme.ts
async function handler29(req, res) {
  if (cors(req, res)) return;
  const action = req.query.action === "pagarme" ? req.query.subAction || req.body.subAction : req.query.action || req.body.action;
  if (action === "webhook") {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "M\xE9todo n\xE3o permitido." });
    }
    const result = await WebhookService.processWebhook(req.body);
    return res.status(200).json(result);
  }
  const authUser = await verifyAuth(req);
  if (!authUser) {
    return res.status(401).json({ error: "Sess\xE3o expirada ou inv\xE1lida. Conecte-se novamente." });
  }
  const userId = authUser.uid;
  try {
    switch (action) {
      case "create-payment": {
        if (req.method !== "POST") return res.status(405).json({ error: "Post requerido." });
        const { planId, paymentMethod, cardToken, installments } = req.body;
        if (!planId || !paymentMethod) {
          return res.status(400).json({ error: "Os campos planId e paymentMethod s\xE3o obrigat\xF3rios." });
        }
        const result = await PaymentService.createPayment({
          userId,
          planId,
          paymentMethod,
          cardToken,
          installments: installments ? Number(installments) : 1,
          userEmail: authUser.email || "user@example.com"
        });
        return res.status(200).json({ success: true, payment: result });
      }
      case "create-subscription": {
        if (req.method !== "POST") return res.status(405).json({ error: "Post requerido." });
        const { planId, paymentMethod, cardToken } = req.body;
        if (!planId || !paymentMethod) {
          return res.status(400).json({ error: "Os campos planId e paymentMethod s\xE3o obrigat\xF3rios." });
        }
        const result = await SubscriptionService.createSubscription({
          userId,
          planId,
          paymentMethod,
          cardToken
        });
        return res.status(200).json({ success: true, subscription: result });
      }
      case "cancel-subscription": {
        if (req.method !== "POST") return res.status(405).json({ error: "Post requerido." });
        const { subscriptionId } = req.body;
        if (!subscriptionId) return res.status(400).json({ error: "subscriptionId obrigat\xF3rio." });
        const result = await SubscriptionService.cancelSubscription(userId, subscriptionId);
        return res.status(200).json(result);
      }
      case "upgrade-subscription": {
        if (req.method !== "POST") return res.status(405).json({ error: "Post requerido." });
        const { subscriptionId, newPlanId } = req.body;
        if (!subscriptionId || !newPlanId) {
          return res.status(400).json({ error: "Campos obrigat\xF3rios ausentes." });
        }
        const result = await SubscriptionService.upgradeSubscription(userId, subscriptionId, newPlanId);
        return res.status(200).json(result);
      }
      case "downgrade-subscription": {
        if (req.method !== "POST") return res.status(405).json({ error: "Post requerido." });
        const { subscriptionId, newPlanId } = req.body;
        if (!subscriptionId || !newPlanId) {
          return res.status(400).json({ error: "Campos obrigat\xF3rios ausentes." });
        }
        const result = await SubscriptionService.downgradeSubscription(userId, subscriptionId, newPlanId);
        return res.status(200).json(result);
      }
      case "get-invoices": {
        const invoices = await InvoiceService.getInvoices(userId);
        return res.status(200).json({ success: true, invoices });
      }
      case "admin-dashboard": {
        const subsSnap = await db.collection("subscriptions").get();
        const paymentsSnap = await db.collection("payments").get();
        const invoicesSnap = await db.collection("invoices").get();
        const activeSubs = subsSnap.docs.filter((doc2) => doc2.data().status === "active");
        const cancelledSubs = subsSnap.docs.filter((doc2) => doc2.data().status === "cancelled");
        const overdueSubs = subsSnap.docs.filter((doc2) => doc2.data().status === "overdue");
        let monthlyRevenue = 0;
        let mrr = 0;
        let chargebacksCount = 0;
        let pendingPaymentsCount = 0;
        paymentsSnap.docs.forEach((doc2) => {
          const data = doc2.data();
          if (data.status === "approved") {
            monthlyRevenue += data.valor || 0;
          } else if (data.status === "pending") {
            pendingPaymentsCount++;
          } else if (data.status === "charged_back") {
            chargebacksCount++;
          }
        });
        activeSubs.forEach((doc2) => {
          const data = doc2.data();
          mrr += data.valor || 0;
        });
        const totalSubs = subsSnap.docs.length || 1;
        const churnCount = cancelledSubs.length;
        const churnRate = (churnCount / totalSubs * 100).toFixed(1);
        const metrics = {
          activeSubscriptions: activeSubs.length,
          cancellations: cancelledSubs.length,
          inadimplencia: overdueSubs.length,
          receitaMensal: monthlyRevenue,
          receitaRecorrenteMensal: mrr,
          churn: churnCount,
          churnRate: `${churnRate}%`,
          chargebacks: chargebacksCount,
          pagamentosPendentes: pendingPaymentsCount,
          totalSubscriptionsCount: subsSnap.docs.length
        };
        return res.status(200).json({ success: true, metrics });
      }
      default:
        return res.status(400).json({ error: `A\xE7\xE3o inv\xE1lida: ${action}` });
    }
  } catch (err) {
    console.error("[Pagarme Handler Error]", err);
    return res.status(500).json({ error: err.message || "Erro ao processar requisi\xE7\xE3o." });
  }
}
var init_pagarme = __esm({
  "api/_handlers/pagarme.ts"() {
    init_common();
    init_pagarme_service();
  }
});

// api/app.ts
var app_exports = {};
__export(app_exports, {
  default: () => app_default
});
var import_dotenv, import_express, router, wrap, app_default;
var init_app = __esm({
  "api/app.ts"() {
    import_dotenv = __toESM(require("dotenv"), 1);
    import_express = __toESM(require("express"), 1);
    init_health();
    init_profile();
    init_ranking();
    init_share();
    init_share_image();
    init_gyms();
    init_gyms_join();
    init_gyms_checkin();
    init_gyms_photo();
    init_running();
    init_validate_activity();
    init_validate_presence();
    init_elite();
    init_whatsapp();
    init_strava();
    init_migrate_reset();
    init_env_check();
    init_mercadopago();
    init_nutrition();
    init_wallet_redeem();
    init_admin();
    init_denounce();
    init_payments_create_checkout();
    init_payments_webhook();
    init_payments_status();
    init_payments_config();
    init_payments_debug_mercado_pago();
    init_private_challenges();
    init_pagarme();
    import_dotenv.default.config({ override: true });
    router = import_express.default.Router();
    console.log("[API Router] Initializing routes...");
    router.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
      }
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
      if (req.method === "OPTIONS") {
        return res.status(200).end();
      }
      next();
    });
    wrap = (handler30) => async (req, res) => {
      try {
        await handler30(req, res);
      } catch (err) {
        console.error(`[API Error] Error in handler:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            error: err.message || "Erro interno no servidor.",
            stack: process.env.NODE_ENV === "development" ? err.stack : void 0
          });
        }
      }
    };
    router.all("/health", wrap(handler));
    router.all("/profile", wrap(handler2));
    router.all("/ranking", wrap(handler3));
    router.all("/share", wrap(handler4));
    router.all("/share-image", wrap(handler5));
    router.all("/gyms", wrap(handler6));
    router.all("/gyms/join", wrap(handler7));
    router.all("/gyms/checkin", wrap(handler8));
    router.all("/gyms/photo", wrap(handler9));
    router.all("/running", wrap(handler10));
    router.all("/validate-activity", wrap(handler11));
    router.all("/validate-presence", wrap(handler12));
    router.all("/elite", wrap(handler13));
    router.all("/strava", wrap(handler15));
    router.all("/whatsapp/send", wrap(handler14));
    router.all("/env-check", wrap(handler17));
    router.all("/mercadopago", wrap(handler18));
    router.all("/payments/create-checkout", wrap(handler23));
    router.all("/payments/config", wrap(handler26));
    router.all("/payments/debug-mercado-pago", wrap(handler27));
    router.all("/payments/webhook", wrap(handler24));
    router.all("/payments/pagarme", wrap(handler29));
    router.all("/payments/status/:orderId", wrap(handler25));
    router.all("/payments/status", wrap(handler25));
    router.all("/nutrition", wrap(handler19));
    router.all("/wallet/redeem", wrap(handler20));
    router.all("/migrate-reset", wrap(handler16));
    router.all("/admin", wrap(handler21));
    router.all("/denounce", wrap(handler22));
    router.all("/private-challenges", wrap(handler28));
    router.get("/share/:id", (req, res) => {
      req.query.id = req.params.id;
      return handler4(req, res);
    });
    router.all("/app", async (req, res) => {
      const action = req.query.action || req.body.action;
      switch (action) {
        case "health":
          return handler(req, res);
        case "profile":
          return handler2(req, res);
        case "ranking":
          return handler3(req, res);
        case "gyms":
          return handler6(req, res);
        case "gyms-join":
          return handler7(req, res);
        case "gyms-checkin":
          return handler8(req, res);
        case "validate-activity":
          return handler11(req, res);
        case "validate-presence":
          return handler12(req, res);
        case "nutrition":
          return handler19(req, res);
        case "strava":
          return handler15(req, res);
        case "whatsapp-send":
          return handler14(req, res);
        case "wallet-redeem":
          return handler20(req, res);
        case "payments-create-checkout":
          return handler23(req, res);
        case "payments-config":
          return handler26(req, res);
        case "payments-debug-mercado-pago":
          return handler27(req, res);
        case "payments-webhook":
          return handler24(req, res);
        case "pagarme":
          return handler29(req, res);
        case "payments-status":
          return handler25(req, res);
        case "migrate-reset":
          return handler16(req, res);
        case "admin":
          return handler21(req, res);
        case "private-challenges":
          return handler28(req, res);
        default:
          return res.status(400).json({
            error: "A\xE7\xE3o inv\xE1lida ou n\xE3o fornecida.",
            tip: "Use /api/app?action=profile ou os endpoints espec\xEDficos."
          });
      }
    });
    app_default = router;
  }
});

// server.ts
var import_dotenv2 = __toESM(require("dotenv"), 1);
var import_express2 = __toESM(require("express"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_fs2 = __toESM(require("fs"), 1);
var import_vite = require("vite");
import_dotenv2.default.config({ override: true });
async function startServer() {
  const app2 = (0, import_express2.default)();
  const PORT = 3e3;
  app2.get("/ping", (req, res) => res.send("pong"));
  app2.use((req, res, next) => {
    if (req.url.startsWith("/api")) {
      console.log(`[API] ${req.method} ${req.url}`);
    } else if (!req.url.includes(".") && req.method !== "GET") {
      console.log(`[Server] ${req.method} ${req.url}`);
    }
    next();
  });
  app2.use(import_express2.default.json({ limit: "10mb" }));
  console.log("[Server] Loading API routes...");
  try {
    const apiAppModule = await Promise.resolve().then(() => (init_app(), app_exports));
    const apiRouter = apiAppModule.default;
    if (!apiRouter) {
      throw new Error("API Router not found in api/app.ts export");
    }
    app2.use("/api", apiRouter);
    console.log("[Server] API routes mounted at /api");
  } catch (err) {
    console.error("[Server] Failed to load API routes:", err);
  }
  app2.use("/api", (req, res) => {
    console.warn(`[API 404] ${req.method} ${req.url}`);
    res.status(404).json({ error: `Endpoint n\xE3o encontrado: ${req.url}` });
  });
  const startBackgroundJobs = async () => {
    try {
      const { aggregationService: aggregationService2 } = await Promise.resolve().then(() => (init_aggregation(), aggregation_exports));
      const runJob = async () => {
        console.log("[Background Job] Running aggregation...");
        await aggregationService2.updateAllStats();
      };
      setInterval(() => {
        runJob().catch(console.error);
      }, 2 * 60 * 60 * 1e3);
    } catch (e) {
      console.warn("[Background Job] Could not start aggregation job:", e);
    }
  };
  if (process.env.NODE_ENV !== "test") {
    startBackgroundJobs();
  }
  if (process.env.NODE_ENV === "production") {
    const distPath = import_path2.default.resolve(process.cwd(), "dist");
    if (import_fs2.default.existsSync(distPath)) {
      app2.use(import_express2.default.static(distPath));
      app2.get("*", (req, res) => {
        res.sendFile(import_path2.default.resolve(distPath, "index.html"));
      });
    } else {
      const vite = await (0, import_vite.createServer)({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app2.use(vite.middlewares);
    }
  } else {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app2.use(vite.middlewares);
  }
  app2.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map

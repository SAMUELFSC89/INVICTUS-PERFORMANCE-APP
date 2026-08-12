import { ActivitySession, Workout, UserProfile, MealPlanEntry } from "../types";
import { auth, db, handleFirestoreError, OperationType } from "../firebase";
import { collection, addDoc, doc, updateDoc, getDoc, increment, query, where, getDocs, limit, runTransaction, setDoc } from "firebase/firestore";
import { validationService } from "./validationService";
import { workoutService, simpleHash } from "./workoutService";
import { calculatePoints } from "../lib/seasonUtils";
import { getCurrentLocation } from "../lib/locationUtils";
import { compressBase64Image } from "../lib/imageCompression";
import { validateGeofenceCheckin, MAX_GEOFENCE_RADIUS_METERS, MAX_GPS_ACCURACY_METERS } from "./geofenceEngine";

const SESSION_KEY = 'current_activity_session';

function createStructuredError(title: string, message: string): Error {
  const fullMsg = `${title}\n\n${message}`;
  const err = new Error(fullMsg);
  (err as any).title = title;
  (err as any).userFacingMessage = message;
  return err;
}

export const activityService = {
  /**
   * Starts a new activity session
   */
  async startSession(type: 'workout' | 'cardio', providedLocation?: { lat: number; lng: number; accuracy?: number }, cardioType?: string, smartwatchData?: any, checkInId?: string): Promise<ActivitySession> {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');

    // Check for existing session locally
    const existing = this.getCurrentSession();
    if (existing) throw new Error('Já existe uma atividade em andamento.');

    // 1. Check for active/orphaned sessions on the backend via Firestore
    try {
      const activeSessionsQuery = query(
        collection(db, 'active_sessions'),
        where('userId', '==', user.uid),
        where('status', '==', 'active')
      );
      const activeSessionsSnap = await getDocs(activeSessionsQuery);
      
      for (const docSnap of activeSessionsSnap.docs) {
        const sessData = docSnap.data();
        const startTimeMs = new Date(sessData.startTime).getTime();
        const diffMs = Date.now() - startTimeMs;
        
        // Auto-expire sessions older than 4 hours (orphaned/abandoned)
        if (diffMs > 4 * 60 * 60 * 1000) {
          await updateDoc(docSnap.ref, {
            status: 'abandoned',
            abandonedReason: 'Sessão abandonada (tempo limite de 4 horas excedido)',
            endTime: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }).catch(e => console.warn('[ActivityService] Could not update abandoned session:', e));
        } else {
          // Active unexpired session exists!
          // Restore/recover it to localStorage so user doesn't lose progress across devices, 
          // and prevent multiple concurrent sessions!
          const restoredSession: ActivitySession = {
            id: sessData.id,
            userId: sessData.userId,
            type: sessData.type,
            cardioType: sessData.cardioType || undefined,
            cardioTypeLabel: sessData.cardioTypeLabel || undefined,
            isIndoorCardio: sessData.isIndoorCardio,
            requiresGpsDistance: sessData.requiresGpsDistance,
            smartwatchData: sessData.smartwatchData || undefined,
            startTime: sessData.startTime,
            startLocation: sessData.startLocation || undefined,
            status: 'active',
            checkInId: sessData.checkInId || undefined,
            checkpoints: sessData.checkpoints || []
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(restoredSession));
          throw new Error('Você já possui uma atividade ativa em andamento! Recuperamos sua sessão ativa do servidor.');
        }
      }
    } catch (checkErr: any) {
      if (checkErr.message?.includes('Você já possui uma atividade ativa')) {
        throw checkErr;
      }
      console.warn('[ActivityService] Server check for active sessions failed, proceeding locally:', checkErr);
    }

    // Fetch user data for gym validation
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) throw new Error('Perfil de usuário não encontrado');
    const userData = userSnap.data() as UserProfile;

    let startLocation = providedLocation;
    
    if (!startLocation) {
      try {
        // High accuracy for gym validation
        startLocation = await getCurrentLocation(type === 'workout'); 
      } catch (error: any) {
        console.warn('Location capture failed for startSession', error);
        if (error.message.includes('Permissão')) {
          throw error;
        }
      }
    }

    const CARDIO_TYPES_MAP: Record<string, { label: string; isIndoor: boolean; requiresGps: boolean }> = {
      running: { label: 'Corrida', isIndoor: false, requiresGps: true },
      walking: { label: 'Caminhada', isIndoor: false, requiresGps: true },
      bike: { label: 'Bike', isIndoor: false, requiresGps: true },
      treadmill: { label: 'Esteira', isIndoor: true, requiresGps: false },
      stationary_bike: { label: 'Bicicleta ergométrica', isIndoor: true, requiresGps: false },
      elliptical: { label: 'Elíptico', isIndoor: true, requiresGps: false },
      stair_climber: { label: 'Escada', isIndoor: true, requiresGps: false },
      rowing: { label: 'Remo', isIndoor: true, requiresGps: false },
      other: { label: 'Outros', isIndoor: true, requiresGps: false }
    };

    // Gym Proximity Check for Workout with Anti-Fraud 50m Rad (Only if checkInId not provided)
    if (type === 'workout' && !checkInId) {
      if (!userData.gymId) {
        throw createStructuredError(
          "📍 Seleção de Academia Necessária",
          'Para que seus treinos possam ser validados e somarem pontos no ranking, selecione sua academia oficial na aba "Academia" antes de iniciar.'
        );
      }

      if (startLocation) {
        const accuracy = startLocation.accuracy || 15;
        
        // Block start if GPS is too imprecise (allow up to 200m accuracy for indoor gym / web environment)
        if (accuracy > 200) {
          throw createStructuredError(
            "📍 Aguardando Sinal de Localização",
            "Certifique-se de que a localização do seu celular está ativada para que possamos confirmar seu treino na academia."
          );
        }

        let gymLoc = userData.gymLocation;
        
        // Check if gymLoc is present and valid
        let isGymLocationValid = gymLoc && 
                                  gymLoc.lat !== undefined && 
                                  gymLoc.lng !== undefined && 
                                  !isNaN(Number(gymLoc.lat)) && 
                                  !isNaN(Number(gymLoc.lng)) && 
                                  Number(gymLoc.lat) >= -90 && Number(gymLoc.lat) <= 90 && 
                                  Number(gymLoc.lng) >= -180 && Number(gymLoc.lng) <= 180 &&
                                  (Number(gymLoc.lat) !== 0 || Number(gymLoc.lng) !== 0);

        // Try fetching canonical gym doc from gyms collection if user.gymLocation is invalid
        if (!isGymLocationValid && userData.gymId) {
          try {
            const gymDocRef = doc(db, 'gyms', userData.gymId);
            const gymDocSnap = await getDoc(gymDocRef);
            if (gymDocSnap.exists()) {
              const gymData = gymDocSnap.data();
              const gLat = gymData?.latitude ?? gymData?.lat;
              const gLng = gymData?.longitude ?? gymData?.lng;
              if (gLat !== undefined && gLng !== undefined && !isNaN(Number(gLat)) && !isNaN(Number(gLng))) {
                gymLoc = { lat: Number(gLat), lng: Number(gLng) };
                isGymLocationValid = true;
                // Sync user profile
                try {
                  const userRef = doc(db, 'users', user.uid);
                  await updateDoc(userRef, { gymLocation: gymLoc });
                } catch (e) {
                  console.warn('Failed syncing gymLocation to user profile:', e);
                }
              }
            }
          } catch (err) {
            console.warn('Error fetching gym doc in activityService:', err);
          }
        }

        if (!isGymLocationValid || !gymLoc) {
          console.warn(`Academia sem coordenadas válidas: gymId=${userData.gymId}, userId=${user.uid}`);
          throw createStructuredError(
            "📍 Atualização de Academia Necessária",
            "Sua academia selecionada precisa ter o endereço confirmado no mapa.\n\nAcesse a aba 'Academia' no menu para atualizar."
          );
        }

        const geofenceResult = validateGeofenceCheckin(
          {
            id: userData.gymId,
            name: userData.gymName || 'Sua Academia',
            latitude: gymLoc.lat,
            longitude: gymLoc.lng
          },
          {
            latitude: startLocation.lat,
            longitude: startLocation.lng,
            accuracy: accuracy,
            timestamp: new Date().toISOString()
          },
          MAX_GEOFENCE_RADIUS_METERS,
          Math.max(MAX_GPS_ACCURACY_METERS, 200)
        );

        if (!geofenceResult.approved) {
          console.warn(`Tentativa de iniciar fora da geofence da academia: userId=${user.uid}, gymId=${userData.gymId}, reason=${geofenceResult.reason}`);
          throw createStructuredError(
            "📍 Localização da Academia",
            geofenceResult.userFacingMessage
          );
        }
      } else {
        console.warn(`Tentativa de início de atividade sem dados de geolocalização: userId=${user.uid}, gymId=${userData.gymId}`);
        throw createStructuredError(
          "📍 Localização Indisponível",
          "Não conseguimos identificar sua localização no momento.\n\nVerifique se a localização do celular está ativa e tente novamente."
        );
      }
    }

    const cardioMapEntry = cardioType ? CARDIO_TYPES_MAP[cardioType] : undefined;

    const session: ActivitySession = {
      id: Math.random().toString(36).substring(7),
      userId: user.uid,
      type,
      cardioType,
      cardioTypeLabel: cardioMapEntry?.label,
      isIndoorCardio: cardioMapEntry?.isIndoor,
      requiresGpsDistance: cardioMapEntry?.requiresGps,
      smartwatchData,
      startTime: new Date().toISOString(),
      startLocation,
      status: 'active',
      checkInId,
      checkpoints: startLocation ? [{ timestamp: new Date().toISOString(), location: startLocation }] : []
    };

    // Low-overhead standard device sensors monitoring to challenge automated scripts
    if (typeof window !== 'undefined') {
      localStorage.setItem('has_sensor_oscillation', 'false');
      localStorage.setItem('has_sensor_events', 'false');
      
      const isSupported = 'DeviceMotionEvent' in window;
      if (!isSupported) {
        localStorage.setItem('sensor_status', 'not_supported');
      } else {
        localStorage.setItem('sensor_status', 'unavailable');

        const registerListener = () => {
          let timer = setTimeout(() => {
            if (localStorage.getItem('sensor_status') === 'granted' && localStorage.getItem('has_sensor_events') !== 'true') {
              localStorage.setItem('sensor_status', 'unavailable');
            }
          }, 3000);

          const handleMotion = (event: DeviceMotionEvent) => {
            localStorage.setItem('has_sensor_events', 'true');
            if (localStorage.getItem('sensor_status') === 'unavailable') {
              localStorage.setItem('sensor_status', 'granted');
            }
            const acc = event.accelerationIncludingGravity;
            if (acc) {
              const force = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
              if (force > 11.5) { // Force exceeds standard state
                localStorage.setItem('has_sensor_oscillation', 'true');
                window.removeEventListener('devicemotion', handleMotion);
                clearTimeout(timer);
              }
            }
          };
          window.addEventListener('devicemotion', handleMotion);
        };

        if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
          (DeviceMotionEvent as any).requestPermission()
            .then((permissionState: string) => {
              if (permissionState === 'granted') {
                localStorage.setItem('sensor_status', 'granted');
                registerListener();
              } else {
                localStorage.setItem('sensor_status', 'denied');
              }
            })
            .catch(() => {
              localStorage.setItem('sensor_status', 'error');
            });
        } else {
          localStorage.setItem('sensor_status', 'granted');
          registerListener();
        }
      }
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));

    // Save to Firestore active_sessions for global cross-device synchronization and orphaning protection
    setDoc(doc(db, 'active_sessions', session.id), {
      id: session.id,
      userId: session.userId,
      type: session.type,
      cardioType: session.cardioType || null,
      cardioTypeLabel: session.cardioTypeLabel || null,
      isIndoorCardio: !!session.isIndoorCardio,
      requiresGpsDistance: !!session.requiresGpsDistance,
      smartwatchData: session.smartwatchData || null,
      startTime: session.startTime,
      startLocation: session.startLocation || null,
      status: 'active',
      checkInId: session.checkInId || null,
      checkpoints: session.checkpoints || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).catch(err => console.warn('[ActivityService] Failed to write active session registry to Firestore:', err));

    return session;
  },

  /**
   * Gets the current active session from localStorage
   */
  getCurrentSession(): ActivitySession | null {
    const data = localStorage.getItem(SESSION_KEY);
    if (!data) return null;
    try {
      const session = JSON.parse(data) as ActivitySession;
      if (session.status !== 'active') return null;

      // Auto-expire sessions older than 90 minutes
      const startTime = new Date(session.startTime).getTime();
      const now = new Date().getTime();
      const diffMins = (now - startTime) / (1000 * 60);

      if (diffMins > 90) {
        console.log('[ActivityService] Session older than 90m expired, clearing stale state');
        this.cancelSession();
        return null;
      }

      return session;
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  },

  /**
   * Adds a checkpoint to the current session
   */
  addCheckpoint(location: { lat: number; lng: number }) {
    const session = this.getCurrentSession();
    if (!session) return;

    session.checkpoints.push({
      timestamp: new Date().toISOString(),
      location
    });

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));

    // Async sync with Firestore to prevent losing offline path progress if app restarts
    const docRef = doc(db, 'active_sessions', session.id);
    updateDoc(docRef, {
      checkpoints: session.checkpoints,
      updatedAt: new Date().toISOString()
    }).catch(err => console.warn('[ActivityService] Failed to sync checkpoint to Firestore:', err));
  },

  setHasExercises(has: boolean) {
    const session = this.getCurrentSession();
    if (!session) return;
    session.hasExercises = has;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },

  calculateSessionDistance(session: ActivitySession): number {
    let distanceKm = 0;
    for (let i = 1; i < session.checkpoints.length; i++) {
      const p1 = session.checkpoints[i - 1].location;
      const p2 = session.checkpoints[i].location;
      distanceKm += validationService.calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    }
    return distanceKm;
  },

  /**
   * Ends and validates the current activity
   */
  async endSession(photoBase64?: string): Promise<{ workout: Workout; validation: any; message?: string; isScoringEligible?: boolean; nonScoringReason?: string | null }> {
    const session = this.getCurrentSession();
    if (!session) throw new Error('Nenhuma atividade em andamento.');

    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');

    let endLocation: { lat: number; lng: number } | undefined;
    try {
      // Use high accuracy with fast 4s timeout for end location check
      endLocation = await getCurrentLocation(session.type === 'workout', 4000); 
    } catch (error) {
      console.warn('Could not get end location', error);
    }

    if (endLocation) {
      session.checkpoints.push({
        timestamp: new Date().toISOString(),
        location: endLocation
      });
    }

    const startTime = new Date(session.startTime);
    const endTime = new Date();
    const rawDurationMins = Math.floor((endTime.getTime() - startTime.getTime()) / 60000);
    const durationMins = Math.min(90, rawDurationMins);

    const distanceKm = this.calculateSessionDistance(session);

    const userRef = doc(db, 'users', user.uid);
    
    // 1. Get fresh user data BEFORE transaction for validation
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) throw new Error("Usuário não encontrado.");
    const userData = userSnap.data() as UserProfile;

    // 2. Compress Image on Frontend
    let finalPhoto = photoBase64;
    if (photoBase64) {
      try {
        console.log('[activityService] Compressing raw image representation...');
        finalPhoto = await compressBase64Image(photoBase64);
      } catch (err) {
        console.warn('[activityService] Failed to compress image. Proceeding with original.', err);
      }
    }

    // 3. Activity Submission via Secure API
    const idToken = await user.getIdToken();
    
    // Capture user trust indicators from window environments dynamically
    let isDev = false;
    if (typeof window !== 'undefined') {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const hasDevtools = (window.outerWidth - window.innerWidth > 160) || (window.outerHeight - window.innerHeight > 160);
      isDev = isLocalhost || hasDevtools || !!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    }

    let isEmu = typeof window !== 'undefined' && /headless|chrome-lighthouse|bot|crawl|emulator|android sdk/i.test(navigator.userAgent || '');
    if (typeof window !== 'undefined' && !isEmu) {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
          const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            const renderer = ((gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '').toString();
            if (/swiftshader|google/i.test(renderer) || /llvmpipe|software/i.test(renderer) || /virtualbox/i.test(renderer) || /emulator/i.test(renderer)) {
              isEmu = true;
            }
          }
        }
      } catch (e) {
        // Safe catch
      }
    }

    let isRoot = false;
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent || '';
      const rootedSigs = ['rooted', 'jailbreak', 'supersu', 'magisk', 'cydia', 'busybox', 'xposed', 'substrate', 'bypass'];
      const hasRootSignatures = rootedSigs.some(sig => ua.toLowerCase().includes(sig));
      const hasCordovaJailbreak = !!(window as any).cordova || !!(window as any).Capacitor;
      isRoot = hasRootSignatures || hasCordovaJailbreak;
    }

    let isMockLoc = false;
    if (session.startLocation) {
      const accuracy = (session.startLocation as any).accuracy || 0;
      if (accuracy < 1 && accuracy > 0) {
        isMockLoc = true;
      }
    }
    if (endLocation) {
      const accuracy = (endLocation as any).accuracy || 0;
      if (accuracy < 1 && accuracy > 0) {
        isMockLoc = true;
      }
    }
    if (session.checkpoints && session.checkpoints.some(c => (c.location as any).accuracy && (c.location as any).accuracy < 1)) {
      isMockLoc = true;
    }

    const hasOscillation = typeof window !== 'undefined' ? localStorage.getItem('has_sensor_oscillation') !== 'false' : true;
    const sensorStatus = typeof window !== 'undefined' ? (localStorage.getItem('sensor_status') || 'unavailable') : 'unavailable';
    const pedometerSteps = Math.round(distanceKm * 1350); // standard runners steps counter biomechanics

    const response = await fetch('/api/validate-activity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        type: session.type,
        cardioType: session.cardioType,
        cardioTypeLabel: session.cardioTypeLabel,
        isIndoorCardio: session.isIndoorCardio,
        requiresGpsDistance: session.requiresGpsDistance,
        smartwatchData: session.smartwatchData,
        durationMins,
        distanceKm,
        startLocation: session.startLocation,
        endLocation,
        photoBase64: finalPhoto,
        checkpoints: session.checkpoints,
        hasExercises: !!session.hasExercises,
        checkInId: session.checkInId,
        isMockLocation: isMockLoc,
        isEmulator: isEmu,
        isRooted: isRoot,
        isDeveloperMode: isDev,
        hasSensorOscillation: hasOscillation,
        sensorStatus,
        pedometerSteps
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      this.cancelSession();
      throw new Error(errorData.userMessage || errorData.error || 'Não conseguimos validar esta atividade no momento.');
    }

    try {
      const respData = await response.json();
      
      if (respData.presenceCheckRequired) {
        return {
          presenceCheckRequired: true,
          presenceCheckId: respData.presenceCheckId,
          livenessPrompt: respData.livenessPrompt,
          userMessage: respData.userMessage
        } as any;
      }

      const { workout, validation, message, isScoringEligible, nonScoringReason, success, status, reasonCode, userMessage, canRetry } = respData;
      
      // Clear session completely
      this.cancelSession();

      // Update Firestore active_session entry to completed
      updateDoc(doc(db, 'active_sessions', session.id), {
        status: 'completed',
        endTime: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }).catch(() => {});

      const finalUserMessage = userMessage || message || 'Não conseguimos validar esta atividade no momento. Tente novamente seguindo as regras do desafio.';

      const enrichedValidation = {
        ...(validation || workout?.validation || {}),
        success: success !== undefined ? success : (workout?.status === 'valid'),
        status: status || (workout?.status === 'valid' ? 'approved' : 'rejected'),
        reasonCode: reasonCode || null,
        userMessage: finalUserMessage,
        canRetry: canRetry !== undefined ? canRetry : false
      };

      return { 
        workout,
        validation: enrichedValidation,
        message: finalUserMessage,
        isScoringEligible,
        nonScoringReason
      };
    } catch (e) {
      // If we can't parse JSON, the session stays so the user can try again
      throw new Error('Falha ao processar resposta do servidor. Sua atividade ainda está salva localmente.');
    }
  },

  async submitDiet(photoBase64: string): Promise<{ workout: Workout; validation: any }> {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');

    // 1. Compress Image on Frontend
    let finalPhoto = photoBase64;
    try {
      console.log('[activityService] Compressing raw diet image representation...');
      finalPhoto = await compressBase64Image(photoBase64);
    } catch (err) {
      console.warn('[activityService] Failed to compress diet image. Proceeding with original.', err);
    }

    // 2. Submit to secure backend API
    const idToken = await user.getIdToken();
    const response = await fetch('/api/validate-activity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        type: 'diet',
        photoBase64: finalPhoto,
        durationMins: 0
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Falha ao validar dieta no servidor.');
    }

    const { workout } = await response.json();

    return { 
      workout,
      validation: workout.validation
    };
  },

  cancelSession() {
    const data = localStorage.getItem(SESSION_KEY);
    if (data) {
      try {
        const session = JSON.parse(data) as ActivitySession;
        updateDoc(doc(db, 'active_sessions', session.id), {
          status: 'cancelled',
          endTime: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }).catch(() => {});
      } catch (e) {}
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('kmfatal_active_run');
    localStorage.removeItem('kmfatal_start_time');
    localStorage.removeItem('kmfatal_total_distance');
    localStorage.removeItem('kmfatal_run_points');
  }
};

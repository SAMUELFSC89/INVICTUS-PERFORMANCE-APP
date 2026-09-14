import ActivityKit
import Capacitor
import CoreLocation
import Foundation

// #328: plugin Capacitor local (não é um pacote separado -- vive direto no
// alvo do app, igual o AppDelegate) que liga o JS (activityLiveActivityService.ts)
// à Live Activity nativa (ActivityKit) da atividade em andamento. É o
// equivalente iOS da notificação persistente do Android
// (activityNotificationService.ts / capacitor-android-foreground-service).
//
// Os botões "Pausar/Retomar" e "Finalizar" usam LiveActivityIntent. O sistema
// pode executar o intent no processo do app sem trazer a UI ao primeiro plano,
// inclusive antes de a bridge JS/listener estar pronta. Por isso o intent grava
// a ação no App Group e sinaliza via Darwin notification; este plugin drena
// também qualquer ação que já estava pendente ao carregar e a retém até o JS
// registrar o listener, evitando perder o comando em cold/headless start.
@objc(InvictusActivityPlugin)
public class InvictusActivityPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "InvictusActivityPlugin"
    public let jsName = "InvictusActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLocationTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeLocationTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTrackedLocations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLocationTracking", returnType: CAPPluginReturnPromise)
    ]

    private var locationManager: CLLocationManager?
    private var trackedLocations: [[String: Any]] = []
    private let trackedLocationsKey = "invictus.background.locations"

    override public func load() {
        if let saved = UserDefaults(suiteName: InvictusActivityIPC.appGroupId)?.array(forKey: trackedLocationsKey) as? [[String: Any]] {
            trackedLocations = saved
        }
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                let plugin = Unmanaged<InvictusActivityPlugin>.fromOpaque(observer).takeUnretainedValue()
                plugin.handlePendingActionFromIntent()
            },
            InvictusActivityIPC.darwinNotificationName,
            nil,
            .deliverImmediately
        )

        // Se o intent executou antes de o Capacitor criar este plugin, a Darwin
        // notification já passou. A fonte durável é o App Group: leia agora e
        // retenha o evento até o primeiro listener JS de `activityAction`.
        handlePendingActionFromIntent()
    }

    private func authorizationLabel(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways: return "authorizedAlways"
        case .authorizedWhenInUse: return "authorizedWhenInUse"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    private func configureLocationManager() -> CLLocationManager {
        let manager = self.locationManager ?? CLLocationManager()
        self.locationManager = manager
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = true
        if #available(iOS 11.0, *) { manager.showsBackgroundLocationIndicator = true }
        return manager
    }

    private func beginLocationTracking(_ call: CAPPluginCall, clearExisting: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(); return }
            if clearExisting {
                self.trackedLocations = []
                self.persistTrackedLocations()
            }
            let manager = self.configureLocationManager()
            let status = manager.authorizationStatus

            if status == .denied || status == .restricted {
                self.notifyListeners("locationAuthorization", data: ["status": self.authorizationLabel(status)])
                self.notifyListeners("locationError", data: ["code": "permission_denied", "message": "Permissão de localização indisponível."])
                call.resolve()
                return
            }

            if status == .notDetermined {
                manager.requestWhenInUseAuthorization()
            }

            // Core Location mantém esta solicitação e começa a entregar fixes
            // assim que o usuário concede a permissão. A tela JS recebe cada
            // atualização via `locationUpdate`, em vez de ficar presa no
            // snapshot web (que não roda em um app Capacitor nativo).
            manager.startUpdatingLocation()
            self.notifyListeners("locationAuthorization", data: ["status": self.authorizationLabel(manager.authorizationStatus)])
            call.resolve()
        }
    }

    @objc func startLocationTracking(_ call: CAPPluginCall) {
        // Sessão nova: o buffer anterior não pertence a este treino.
        beginLocationTracking(call, clearExisting: true)
    }

    @objc func resumeLocationTracking(_ call: CAPPluginCall) {
        // Recuperação após recriação do WebView/processo JS: o buffer persistido
        // pertence à sessão em andamento e NÃO pode ser apagado antes do JS
        // importá-lo e do encerramento enviar a prova completa ao backend.
        beginLocationTracking(call, clearExisting: false)
    }

    @objc func getTrackedLocations(_ call: CAPPluginCall) {
        call.resolve(["locations": trackedLocations])
    }

    @objc func stopLocationTracking(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.locationManager?.stopUpdatingLocation()
            call.resolve(["locations": self?.trackedLocations ?? []])
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        notifyListeners("locationAuthorization", data: ["status": authorizationLabel(status)])
        if status == .authorizedAlways || status == .authorizedWhenInUse {
            manager.startUpdatingLocation()
        } else if status == .denied || status == .restricted {
            notifyListeners("locationError", data: ["code": "permission_denied", "message": "Permissão de localização indisponível."])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 && location.horizontalAccuracy <= 100 {
            var point: [String: Any] = [
                "lat": location.coordinate.latitude,
                "lng": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "timestamp": ISO8601DateFormatter().string(from: location.timestamp)
            ]

            // CLLocation.speed < 0 significa "velocidade indisponível". O
            // código anterior transformava isso em 0 e o JS tentava derivar
            // uma velocidade a partir do drift das coordenadas. Agora 0 real
            // continua 0 e valor inválido simplesmente não é enviado.
            if location.speed >= 0 {
                let speedKmH = location.speed * 3.6
                point["speedKmH"] = speedKmH < 1.0 ? 0 : speedKmH
            }
            if #available(iOS 15.0, *) {
                point["isSimulated"] = location.sourceInformation?.isSimulatedBySoftware ?? false
            }

            trackedLocations.append(point)
            notifyListeners("locationUpdate", data: point)
        }
        if trackedLocations.count > 5000 { trackedLocations.removeFirst(trackedLocations.count - 5000) }
        persistTrackedLocations()
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let nsError = error as NSError
        print("[InvictusActivityPlugin] background location falhou: \(error)")
        notifyListeners("locationError", data: [
            "code": nsError.code,
            "message": nsError.localizedDescription
        ])
    }

    private func persistTrackedLocations() {
        UserDefaults(suiteName: InvictusActivityIPC.appGroupId)?.set(trackedLocations, forKey: trackedLocationsKey)
    }

    deinit {
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(InvictusActivityIPC.darwinNotificationName),
            nil
        )
    }

    private func handlePendingActionFromIntent() {
        guard let defaults = UserDefaults(suiteName: InvictusActivityIPC.appGroupId) else { return }

        var pending = defaults.stringArray(forKey: InvictusActivityIPC.pendingActionQueueKey) ?? []
        // Migração fail-safe para uma ação gravada por build anterior. Ela entra
        // na frente porque necessariamente ocorreu antes dos itens da fila v2.
        if let legacy = defaults.string(forKey: InvictusActivityIPC.pendingActionKey) {
            pending.insert(legacy, at: 0)
            defaults.removeObject(forKey: InvictusActivityIPC.pendingActionKey)
        }
        guard !pending.isEmpty else { return }

        // Remova o lote durável só depois de copiá-lo localmente. Cada evento é
        // retido pelo Capacitor se o listener JS ainda não existir, então todos
        // os toques do usuário sobrevivem ao cold/headless start sem que um
        // segundo toque sobrescreva o primeiro.
        defaults.removeObject(forKey: InvictusActivityIPC.pendingActionQueueKey)
        let validActions = pending.compactMap { InvictusActivityIPC.Action(rawValue: $0)?.rawValue }
        for raw in validActions {
            DispatchQueue.main.async { [weak self] in
                self?.notifyListeners("activityAction", data: ["action": raw], retainUntilConsumed: true)
            }
        }
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["supported": false])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve()
            return
        }
        let sessionId = call.getString("sessionId") ?? UUID().uuidString
        let isCardio = call.getBool("isCardio") ?? false
        let title = call.getString("title") ?? "Atividade em andamento"
        let distanceKm = call.getDouble("distanceKm") ?? 0

        let attributes = InvictusActivityAttributes(sessionId: sessionId, isCardio: isCardio)
        let state = InvictusActivityAttributes.ContentState(
            isPaused: false,
            referenceStart: Date(),
            frozenElapsedSeconds: 0,
            distanceKm: distanceKm,
            title: title
        )

        do {
            let activity = try Activity<InvictusActivityAttributes>.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil),
                pushType: nil
            )
            InvictusActivityStore.shared.currentActivityId = activity.id
            call.resolve()
        } catch {
            print("[InvictusActivityPlugin] start falhou: \(error)")
            call.reject("Não foi possível iniciar a Live Activity.", nil, error)
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        let isPaused = call.getBool("isPaused") ?? false
        let referenceStartMs = call.getDouble("referenceStartMs") ?? (Date().timeIntervalSince1970 * 1000)
        let frozenElapsedSeconds = call.getDouble("frozenElapsedSeconds") ?? 0
        let distanceKm = call.getDouble("distanceKm") ?? 0
        let title = call.getString("title") ?? "Atividade em andamento"

        let state = InvictusActivityAttributes.ContentState(
            isPaused: isPaused,
            referenceStart: Date(timeIntervalSince1970: referenceStartMs / 1000),
            frozenElapsedSeconds: frozenElapsedSeconds,
            distanceKm: distanceKm,
            title: title
        )

        Task {
            for activity in Activity<InvictusActivityAttributes>.activities {
                await activity.update(.init(state: state, staleDate: nil))
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<InvictusActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            InvictusActivityStore.shared.currentActivityId = nil
            call.resolve()
        }
    }
}

final class InvictusActivityStore {
    static let shared = InvictusActivityStore()
    var currentActivityId: String?
    private init() {}
}

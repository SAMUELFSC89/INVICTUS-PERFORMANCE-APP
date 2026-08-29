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
// Os botões "Pausar/Retomar" e "Finalizar" da Live Activity rodam num App
// Intent que executa FORA do processo do app (na extension), então não dá
// pra chamar o JS diretamente dali. O caminho de volta é: intent grava a
// ação pendente no UserDefaults do App Group compartilhado
// (InvictusActivityIPC.appGroupId) e dispara uma Darwin notification; este
// plugin escuta essa notification (registrado em load()) e repassa pro JS
// via notifyListeners.
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
        // #328: observer de baixo nível (Darwin notification center) --
        // funciona entre processos diferentes (app <-> widget extension),
        // ao contrário do NotificationCenter.default comum.
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                let plugin = Unmanaged<InvictusActivityPlugin>.fromOpaque(observer).takeUnretainedValue()
                plugin.handlePendingActionFromExtension()
            },
            InvictusActivityIPC.darwinNotificationName,
            nil,
            .deliverImmediately
        )
    }

    @objc func startLocationTracking(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(); return }
            self.trackedLocations = []
            self.persistTrackedLocations()
            let manager = self.locationManager ?? CLLocationManager()
            self.locationManager = manager
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = 5
            manager.activityType = .fitness
            manager.pausesLocationUpdatesAutomatically = false
            manager.allowsBackgroundLocationUpdates = true
            if #available(iOS 11.0, *) { manager.showsBackgroundLocationIndicator = true }
            if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
            manager.startUpdatingLocation()
            call.resolve()
        }
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

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 && location.horizontalAccuracy <= 100 {
            var point: [String: Any] = [
                "lat": location.coordinate.latitude,
                "lng": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "timestamp": ISO8601DateFormatter().string(from: location.timestamp),
                "speedKmH": max(0, location.speed * 3.6)
            ]
            if #available(iOS 15.0, *) {
                point["isSimulated"] = location.sourceInformation?.isSimulatedBySoftware ?? false
            }
            trackedLocations.append(point)
        }
        if trackedLocations.count > 5000 { trackedLocations.removeFirst(trackedLocations.count - 5000) }
        persistTrackedLocations()
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[InvictusActivityPlugin] background location falhou: \(error)")
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

    private func handlePendingActionFromExtension() {
        guard let defaults = UserDefaults(suiteName: InvictusActivityIPC.appGroupId),
              let raw = defaults.string(forKey: InvictusActivityIPC.pendingActionKey) else {
            return
        }
        defaults.removeObject(forKey: InvictusActivityIPC.pendingActionKey)
        // notifyListeners precisa rodar na main thread (é o que aciona o
        // bridge JS) -- a Darwin notification pode chegar em qualquer thread.
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("activityAction", data: ["action": raw])
        }
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        // #328 fix: o resto do plugin usa a API baseada em ActivityContent
        // (request/update/end com .init(state:staleDate:)), que só existe a
        // partir do iOS 16.2 -- iOS 16.1 tinha só a API antiga com
        // ContentState puro. Reportar "supported" com base em 16.1 faria o JS
        // achar que dá pra chamar start()/update() num 16.1 real, onde o
        // build nem compilaria essas chamadas. Por isso o gate aqui também é
        // 16.2, para bater com o que o resto do arquivo realmente usa.
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
            // Usuário desativou Live Activities nas Configurações do sistema
            // -- não é um erro do app, só não há nada pra mostrar.
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
            // Best-effort: a Live Activity é um extra -- nunca deve travar o
            // fluxo real de início da atividade.
            print("[InvictusActivityPlugin] start falhou: \(error)")
            call.resolve()
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

/// Pequeno estado auxiliar em memória -- hoje só guarda o id da activity
/// atual para eventual depuração; a fonte de verdade de "existe uma
/// activity rodando" é sempre `Activity<InvictusActivityAttributes>.activities`
/// (a API oficial da ActivityKit), nunca esse cache.
final class InvictusActivityStore {
    static let shared = InvictusActivityStore()
    var currentActivityId: String?
    private init() {}
}

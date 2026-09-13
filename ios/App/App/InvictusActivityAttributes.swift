import ActivityKit
import AppIntents
import Foundation

// #328: tipo compartilhado entre o app principal e a Widget Extension
// (InvictusActivityWidget) para a Live Activity da atividade em andamento
// (cardio/treino). Este arquivo entra em AMBOS os targets. Além dos atributos,
// mantém os LiveActivityIntent interativos no mesmo source compartilhado para
// que o sistema encontre a mesma implementação no app host e no widget.
//
// O cronômetro é exibido no widget via `Text(timerInterval:)`/estilo
// `.timer`, calculado puramente no lado nativo a partir de `startedAt` +
// `pausedAccumulatedSeconds` -- não precisamos (nem devemos) empurrar uma
// atualização nativa a cada segundo; isso economiza o orçamento de updates
// da ActivityKit e bate com a mesma lógica de pausa já usada no
// activityService.ts (pausedMs / pauseStartedAt).
public struct InvictusActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var isPaused: Bool
        /// Início "efetivo" da contagem corrente: se nunca houve pausa, é o
        /// início real da sessão. Cada retomada desloca este valor para a
        /// frente pelo tanto de tempo que ficou pausado, então o widget só
        /// precisa calcular `now - referenceStart` para exibir o tempo
        /// correndo -- sem receber updates a cada segundo.
        public var referenceStart: Date
        /// Segundos acumulados enquanto pausado nesta pausa atual (0 quando
        /// não está pausado). Usado para mostrar um valor congelado no
        /// widget durante a pausa.
        public var frozenElapsedSeconds: Double
        public var distanceKm: Double
        public var title: String

        public init(
            isPaused: Bool,
            referenceStart: Date,
            frozenElapsedSeconds: Double,
            distanceKm: Double,
            title: String
        ) {
            self.isPaused = isPaused
            self.referenceStart = referenceStart
            self.frozenElapsedSeconds = frozenElapsedSeconds
            self.distanceKm = distanceKm
            self.title = title
        }
    }

    public var sessionId: String
    public var isCardio: Bool

    public init(sessionId: String, isCardio: Bool) {
        self.sessionId = sessionId
        self.isCardio = isCardio
    }
}

/// Nome do App Group compartilhado entre App e InvictusActivityWidget --
/// usado tanto pelas entitlements quanto pela troca de mensagens
/// intent -> bridge JS. LiveActivityIntent pode executar no processo do app
/// sem abrir sua UI; o UserDefaults do App Group funciona como handoff durável
/// caso a bridge/listener JavaScript ainda não tenha sido criada.
public enum InvictusActivityIPC {
    public static let appGroupId = "group.com.desafiosemdesculpa.app.activity"
    public static let pendingActionKey = "invictus.activity.pendingAction"
    public static let darwinNotificationName = "com.desafiosemdesculpa.app.activityAction" as CFString

    /// Ações que um App Intent dos botões da Live Activity pode disparar.
    /// Strings simples (não enum) para serem fáceis de escrever/ler do lado
    /// nativo e de mapear 1:1 para os handlers existentes no lado JS
    /// (handleTogglePause / handleEndActivity).
    public enum Action: String {
        case togglePause = "toggle_pause"
        case finish = "finish"
    }
}

private func postPendingActivityAction(_ action: InvictusActivityIPC.Action) {
    guard let defaults = UserDefaults(suiteName: InvictusActivityIPC.appGroupId) else { return }
    defaults.set(action.rawValue, forKey: InvictusActivityIPC.pendingActionKey)
    CFNotificationCenterPostNotification(
        CFNotificationCenterGetDarwinNotifyCenter(),
        CFNotificationName(InvictusActivityIPC.darwinNotificationName),
        nil,
        nil,
        true
    )
}

// Apple executa LiveActivityIntent no processo do app host. Manter estes tipos
// neste source compartilhado (que já pertence aos targets App e Widget) evita
// a configuração anterior em que os intents existiam somente no target da
// extensão e garante descoberta consistente dos botões interativos.
@available(iOS 17.0, *)
struct ToggleActivityPauseIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Pausar ou retomar atividade"
    static var description = IntentDescription("Pausa ou retoma a atividade em andamento no Invictus.")

    func perform() async throws -> some IntentResult {
        postPendingActivityAction(.togglePause)
        return .result()
    }
}

@available(iOS 17.0, *)
struct FinishActivityIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Finalizar atividade"
    static var description = IntentDescription("Finaliza e envia a atividade em andamento no Invictus para validação.")

    func perform() async throws -> some IntentResult {
        postPendingActivityAction(.finish)
        return .result()
    }
}

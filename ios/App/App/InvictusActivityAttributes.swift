import ActivityKit
import Foundation

// #328: tipo compartilhado entre o app principal e a Widget Extension
// (InvictusActivityWidget) para a Live Activity da atividade em andamento
// (cardio/treino). Precisa ser Codable/Hashable e compilar nos dois alvos
// -- por isso não importa nada além de ActivityKit/Foundation (sem
// Capacitor/UIKit), evitando puxar dependências pesadas para dentro do
// processo da extension.
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
/// intent -> app (ação pendente escrita em UserDefaults(suiteName:) e
/// sinalizada via Darwin notification, já que um App Intent roda fora do
/// processo do app principal).
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

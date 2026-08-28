import AppIntents
import Foundation

// #328: App Intents que rodam os botões "Pausar/Retomar" e "Finalizar" da
// Live Activity SEM abrir o app (exige LiveActivityIntent, iOS 17+). Como
// esse código roda no processo da extension, não há como chamar o JS do
// app diretamente daqui -- em vez disso, gravamos a ação pendente no
// UserDefaults do App Group compartilhado e avisamos o app via Darwin
// notification. O InvictusActivityPlugin (no alvo do app) escuta essa
// notification e repassa pro JS via notifyListeners("activityAction", ...).
//
// Em iOS 16.1-16.9 (ActivityKit existe, mas App Intents interativos em Live
// Activity não), esses intents nunca são usados -- a view cai para um
// fallback sem botão interativo (ver InvictusActivityLiveActivityWidget).

private func postPendingAction(_ action: InvictusActivityIPC.Action) {
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

@available(iOS 17.0, *)
struct ToggleActivityPauseIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Pausar ou retomar atividade"
    static var description = IntentDescription("Pausa ou retoma a atividade em andamento no Invictus.")

    func perform() async throws -> some IntentResult {
        postPendingAction(.togglePause)
        return .result()
    }
}

@available(iOS 17.0, *)
struct FinishActivityIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Finalizar atividade"
    static var description = IntentDescription("Finaliza e envia a atividade em andamento no Invictus para validação.")

    func perform() async throws -> some IntentResult {
        postPendingAction(.finish)
        return .result()
    }
}

import ActivityKit
import SwiftUI
import WidgetKit

// #328: apresentação nativa (tela de bloqueio + Dynamic Island) da Live
// Activity da atividade em andamento. Não depende de nenhum plugin de
// terceiros -- só ActivityKit/SwiftUI/WidgetKit (+ AppIntents para os
// botões em iOS 17+, ver InvictusActivityIntents.swift).
struct InvictusActivityLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: InvictusActivityAttributes.self) { context in
            InvictusActivityLockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color.black)
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    InvictusActivityTimerText(state: context.state)
                        .font(.caption)
                        .foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.attributes.isCardio && context.state.distanceKm > 0 {
                        Text(String(format: "%.2f km", context.state.distanceKm))
                            .font(.caption)
                            .foregroundStyle(.white)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    InvictusActivityButtonsRow(state: context.state)
                }
            } compactLeading: {
                Image(systemName: context.state.isPaused ? "pause.fill" : "figure.run")
            } compactTrailing: {
                InvictusActivityTimerText(state: context.state)
                    .font(.caption2)
                    .frame(width: 44)
            } minimal: {
                Image(systemName: context.state.isPaused ? "pause.fill" : "figure.run")
            }
        }
    }
}

/// Cronômetro exibido sem precisar de updates nativos a cada segundo:
/// enquanto rodando, `Text(_:style:.timer)` conta a partir de uma data no
/// passado sozinho (renderizado pelo sistema); pausado, mostra um valor
/// congelado formatado à mão.
struct InvictusActivityTimerText: View {
    let state: InvictusActivityAttributes.ContentState

    var body: some View {
        if state.isPaused {
            Text(Self.formatFrozen(state.frozenElapsedSeconds))
                .monospacedDigit()
        } else {
            Text(state.referenceStart, style: .timer)
                .monospacedDigit()
        }
    }

    static func formatFrozen(_ seconds: Double) -> String {
        let total = max(0, Int(seconds))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }
}

/// Botões "Pausar/Retomar" e "Finalizar". Em iOS 17+ rodam via App Intent
/// sem abrir o app; em 16.1-16.9 (App Intents interativos não existem em
/// Live Activity ainda) cai para um link que abre o app.
struct InvictusActivityButtonsRow: View {
    let state: InvictusActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            if #available(iOS 17.0, *) {
                Button(intent: ToggleActivityPauseIntent()) {
                    Label(state.isPaused ? "Retomar" : "Pausar", systemImage: state.isPaused ? "play.fill" : "pause.fill")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(.white)

                Button(intent: FinishActivityIntent()) {
                    Label("Finalizar", systemImage: "flag.checkered")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            } else if let url = URL(string: "invictus://activity") {
                Link(destination: url) {
                    Label("Abrir no app", systemImage: "arrow.up.forward.app")
                        .font(.caption.weight(.semibold))
                }
            }
        }
    }
}

struct InvictusActivityLockScreenView: View {
    let attributes: InvictusActivityAttributes
    let state: InvictusActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(state.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                Spacer()
                if state.isPaused {
                    Text("EM PAUSA")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.orange)
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 16) {
                InvictusActivityTimerText(state: state)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)

                if attributes.isCardio && state.distanceKm > 0 {
                    Text(String(format: "%.2f km", state.distanceKm))
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.8))
                }
            }

            InvictusActivityButtonsRow(state: state)
        }
        .padding(16)
    }
}

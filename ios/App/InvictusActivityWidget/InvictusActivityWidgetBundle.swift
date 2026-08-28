import SwiftUI
import WidgetKit

// #328: ponto de entrada da Widget Extension. O deployment target deste
// alvo já é 16.1 (mínimo para ActivityKit), então não precisa de guard de
// disponibilidade aqui -- só no app principal, que continua em 15.0 para
// não restringir quem pode instalar o app inteiro.
@main
struct InvictusActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        InvictusActivityLiveActivityWidget()
    }
}

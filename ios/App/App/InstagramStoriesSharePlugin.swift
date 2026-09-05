import Capacitor
import Foundation
import UIKit

// #202: plugin Capacitor local (vive no alvo do app, igual InvictusActivityPlugin
// -- não é um pacote npm) que implementa o mesmo mecanismo que o Strava usa
// pros "Stats Stickers": em vez de gerar UMA imagem já fechada (o que
// handleExport em RunShareCard.tsx já faz, entregando pro share sheet
// genérico do sistema), este plugin manda um STICKER transparente (só os
// números) direto pro editor de Stories do Instagram via UIPasteboard + URL
// scheme oficial da Meta -- o usuário arrasta, redimensiona e escolhe a
// própria foto/vídeo de fundo dentro do Instagram, exatamente como o Strava
// faz. Opcionalmente também aceita uma imagem de fundo (o mapa da rota, por
// exemplo) para pré-preencher o Story, mantendo o sticker de estatísticas
// como uma camada separada e ainda móvel por cima.
//
// Chaves do pasteboard documentadas pela própria Meta:
// developers.facebook.com/docs/instagram/sharing-to-stories (seção iOS).
@objc(InstagramStoriesSharePlugin)
public class InstagramStoriesSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InstagramStoriesSharePlugin"
    public let jsName = "InstagramStoriesShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)
    ]

    private static let shareUrlScheme = URL(string: "instagram-stories://share")!

    @objc func isAvailable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["available": UIApplication.shared.canOpenURL(InstagramStoriesSharePlugin.shareUrlScheme)])
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard UIApplication.shared.canOpenURL(InstagramStoriesSharePlugin.shareUrlScheme) else {
                call.reject("Instagram não está instalado neste aparelho.")
                return
            }

            let backgroundBase64 = call.getString("backgroundBase64")
            let stickerBase64 = call.getString("stickerBase64")
            let topColor = call.getString("topColor")
            let bottomColor = call.getString("bottomColor")
            // source_application é usado pela Meta só para atribuição; não exige
            // um Facebook App ID registrado/aprovado para este fluxo funcionar,
            // o bundle id do app já basta.
            let appId = call.getString("appId") ?? Bundle.main.bundleIdentifier ?? "invictus"

            guard backgroundBase64 != nil || stickerBase64 != nil else {
                call.reject("Envie ao menos uma imagem (fundo ou sticker).")
                return
            }

            var pasteboardItems: [String: Any] = [:]

            if let backgroundBase64, let backgroundData = Data(base64Encoded: backgroundBase64) {
                pasteboardItems["com.instagram.sharedSticker.backgroundImage"] = backgroundData
            }
            if let stickerBase64, let stickerData = Data(base64Encoded: stickerBase64) {
                pasteboardItems["com.instagram.sharedSticker.stickerImage"] = stickerData
            }
            if let topColor {
                pasteboardItems["com.instagram.sharedSticker.backgroundTopColor"] = topColor
            }
            if let bottomColor {
                pasteboardItems["com.instagram.sharedSticker.backgroundBottomColor"] = bottomColor
            }

            guard !pasteboardItems.isEmpty else {
                call.reject("Dados de imagem inválidos (base64 malformado).")
                return
            }

            // Expira em 5 minutos -- mesma janela usada pela implementação de
            // referência da própria Meta, evita deixar dados sensíveis parados
            // indefinidamente na área de transferência do sistema.
            let pasteboardOptions = [UIPasteboard.OptionsKey.expirationDate: Date().addingTimeInterval(60 * 5)]
            UIPasteboard.general.setItems([pasteboardItems], options: pasteboardOptions)

            guard let shareUrl = URL(string: "instagram-stories://share?source_application=\(appId)") else {
                call.reject("Não foi possível montar a URL do Instagram Stories.")
                return
            }

            UIApplication.shared.open(shareUrl, options: [:]) { success in
                if success {
                    call.resolve()
                } else {
                    call.reject("Não foi possível abrir o Instagram Stories.")
                }
            }
        }
    }
}

import Capacitor
import Foundation
import Photos
import UIKit

@objc(InvictusShareCardPlugin)
public class InvictusShareCardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InvictusShareCardPlugin"
    public let jsName = "InvictusShareCard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    @objc func share(_ call: CAPPluginCall) {
        guard let data = imageData(from: call) else {
            call.reject("Imagem inválida.")
            return
        }

        let requestedName = call.getString("fileName") ?? "invictus-atividade.png"
        let safeName = requestedName.lowercased().hasSuffix(".png") ? requestedName : requestedName + ".png"
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)

        do {
            try data.write(to: fileURL, options: .atomic)
        } catch {
            call.reject("Não foi possível preparar a imagem para compartilhar.", nil, error)
            return
        }

        DispatchQueue.main.async {
            let controller = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            if let popover = controller.popoverPresentationController {
                popover.sourceView = self.bridge?.viewController?.view
                popover.sourceRect = self.bridge?.viewController?.view.bounds ?? .zero
            }
            controller.completionWithItemsHandler = { _, _, _, _ in
                try? FileManager.default.removeItem(at: fileURL)
                call.resolve()
            }

            guard let presenter = self.bridge?.viewController else {
                try? FileManager.default.removeItem(at: fileURL)
                call.reject("Tela de compartilhamento indisponível.")
                return
            }
            presenter.present(controller, animated: true)
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let data = imageData(from: call) else {
            call.reject("Imagem inválida.")
            return
        }

        let saveImage = {
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = call.getString("fileName") ?? "invictus-atividade.png"
                request.addResource(with: .photo, data: data, options: options)
            }) { success, error in
                if success { call.resolve() }
                else { call.reject("Não foi possível salvar a imagem na galeria.", nil, error) }
            }
        }

        if #available(iOS 14, *) {
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                if status == .authorized || status == .limited { saveImage() }
                else { call.reject("Permita adicionar fotos para salvar o card.") }
            }
        } else {
            PHPhotoLibrary.requestAuthorization { status in
                if status == .authorized { saveImage() }
                else { call.reject("Permita o acesso às fotos para salvar o card.") }
            }
        }
    }

    private func imageData(from call: CAPPluginCall) -> Data? {
        guard let base64 = call.getString("base64") else { return nil }
        return Data(base64Encoded: base64)
    }
}

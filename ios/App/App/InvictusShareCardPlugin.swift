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
        guard let image = image(from: call) else {
            call.reject("Imagem inválida.")
            return
        }
        DispatchQueue.main.async {
            let controller = UIActivityViewController(activityItems: [image], applicationActivities: nil)
            if let popover = controller.popoverPresentationController {
                popover.sourceView = self.bridge?.viewController?.view
                popover.sourceRect = self.bridge?.viewController?.view.bounds ?? .zero
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("Tela de compartilhamento indisponível.")
                return
            }
            presenter.present(controller, animated: true) { call.resolve() }
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let image = image(from: call) else {
            call.reject("Imagem inválida.")
            return
        }

        let saveImage = {
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
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

    private func image(from call: CAPPluginCall) -> UIImage? {
        guard let base64 = call.getString("base64"), let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }
}


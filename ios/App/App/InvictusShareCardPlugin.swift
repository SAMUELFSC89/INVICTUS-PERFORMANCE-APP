import Capacitor
import Foundation
import Photos
import UIKit
import WebKit

@objc(InvictusShareCardPlugin)
public class InvictusShareCardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InvictusShareCardPlugin"
    public let jsName = "InvictusShareCard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    private struct CardRect: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
    }

    @objc func share(_ call: CAPPluginCall) {
        resolveBestImageData(from: call) { data in
            guard let data else {
                call.reject("Imagem inválida.")
                return
            }

            let requestedName = call.getString("fileName") ?? "invictus-atividade.png"
            let safeName = self.safeFileName(requestedName)
            let shareDirectory = FileManager.default.temporaryDirectory
                .appendingPathComponent("invictus-share-\(UUID().uuidString)", isDirectory: true)
            let fileURL = shareDirectory.appendingPathComponent(safeName, isDirectory: false)

            do {
                try FileManager.default.createDirectory(at: shareDirectory, withIntermediateDirectories: true)
                try data.write(to: fileURL, options: .atomic)
            } catch {
                try? FileManager.default.removeItem(at: shareDirectory)
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
                    try? FileManager.default.removeItem(at: shareDirectory)
                    call.resolve()
                }

                guard let presenter = self.bridge?.viewController else {
                    try? FileManager.default.removeItem(at: shareDirectory)
                    call.reject("Tela de compartilhamento indisponível.")
                    return
                }
                presenter.present(controller, animated: true)
            }
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        resolveBestImageData(from: call) { data in
            guard let data else {
                call.reject("Imagem inválida.")
                return
            }

            let saveImage = {
                PHPhotoLibrary.shared().performChanges({
                    let request = PHAssetCreationRequest.forAsset()
                    let options = PHAssetResourceCreationOptions()
                    options.originalFilename = self.safeFileName(call.getString("fileName") ?? "invictus-atividade.png")
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
    }

    private func resolveBestImageData(from call: CAPPluginCall, completion: @escaping (Data?) -> Void) {
        captureCardSnapshot { snapshotData in
            if let snapshotData {
                completion(snapshotData)
                return
            }
            completion(self.imageData(from: call))
        }
    }

    private func captureCardSnapshot(completion: @escaping (Data?) -> Void) {
        guard let webView = bridge?.webView else {
            completion(nil)
            return
        }

        let script = """
        (() => {
          const card = document.querySelector('.share-card-art');
          if (!card) return null;
          const rect = card.getBoundingClientRect();
          if (!rect.width || !rect.height) return null;
          return JSON.stringify({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
        })();
        """

        DispatchQueue.main.async {
            webView.evaluateJavaScript(script) { result, _ in
                guard
                    let json = result as? String,
                    let jsonData = json.data(using: .utf8),
                    let rect = try? JSONDecoder().decode(CardRect.self, from: jsonData),
                    rect.width > 0,
                    rect.height > 0
                else {
                    completion(nil)
                    return
                }

                let configuration = WKSnapshotConfiguration()
                configuration.rect = CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
                configuration.afterScreenUpdates = true

                // O snapshot é renderizado pelo próprio WebKit, como o preview/screenshot
                // nativo. Isso evita rasterizar o DOM via SVG foreignObject (html-to-image),
                // que era a fonte da perda de nitidez no iOS.
                configuration.snapshotWidth = NSNumber(value: 1080)

                webView.takeSnapshot(with: configuration) { image, _ in
                    guard let image, let png = image.pngData() else {
                        completion(nil)
                        return
                    }
                    completion(png)
                }
            }
        }
    }

    private func imageData(from call: CAPPluginCall) -> Data? {
        guard let base64 = call.getString("base64") else { return nil }
        return Data(base64Encoded: base64)
    }

    private func safeFileName(_ value: String) -> String {
        let sanitized = value.replacingOccurrences(
            of: "[^a-zA-Z0-9._-]",
            with: "-",
            options: .regularExpression
        )
        let nonEmpty = sanitized.isEmpty ? "invictus-atividade" : sanitized
        return nonEmpty.lowercased().hasSuffix(".png") ? nonEmpty : nonEmpty + ".png"
    }
}

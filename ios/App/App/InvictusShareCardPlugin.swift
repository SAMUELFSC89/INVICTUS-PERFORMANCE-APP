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

            let requestedName = call.getString("fileName") ?? "invictus-atividade.jpg"
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
                    options.originalFilename = self.safeFileName(call.getString("fileName") ?? "invictus-atividade.jpg")
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

        let prepareScript = """
        (() => {
          const card = document.querySelector('.share-card-art');
          if (!card) return null;
          const rect = card.getBoundingClientRect();
          if (!rect.width || !rect.height) return null;

          document.querySelectorAll(
            '.share-screen-toolbar, .share-context-controls, .share-card-notices, .share-customizer-backdrop'
          ).forEach((element) => {
            if (element.getAttribute('data-invictus-share-hidden') === 'true') return;
            element.setAttribute('data-invictus-share-hidden', 'true');
            element.setAttribute('data-invictus-share-prev-visibility', element.style.visibility || '');
            element.style.visibility = 'hidden';
          });

          if (!card.classList.contains('is-exporting')) {
            card.classList.add('is-exporting');
            card.setAttribute('data-invictus-native-added-exporting', 'true');
          }

          return JSON.stringify({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
        })();
        """

        DispatchQueue.main.async {
            webView.evaluateJavaScript(prepareScript) { result, _ in
                guard
                    let json = result as? String,
                    let jsonData = json.data(using: .utf8),
                    let rect = try? JSONDecoder().decode(CardRect.self, from: jsonData),
                    rect.width > 0,
                    rect.height > 0
                else {
                    self.restoreEditorChrome(in: webView)
                    completion(nil)
                    return
                }

                // Dá ao WebKit dois frames para aplicar visibility/is-exporting
                // antes da captura nativa. Assim nenhum controle do editor entra
                // no arquivo compartilhado.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.04) {
                    let configuration = WKSnapshotConfiguration()
                    configuration.rect = CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
                    configuration.afterScreenUpdates = true
                    configuration.snapshotWidth = NSNumber(value: 1080)

                    webView.takeSnapshot(with: configuration) { image, _ in
                        self.restoreEditorChrome(in: webView)
                        guard let image, let jpeg = self.storyJpegData(from: image) else {
                            completion(nil)
                            return
                        }
                        completion(jpeg)
                    }
                }
            }
        }
    }

    private func restoreEditorChrome(in webView: WKWebView) {
        let restoreScript = """
        (() => {
          document.querySelectorAll('[data-invictus-share-hidden="true"]').forEach((element) => {
            const previous = element.getAttribute('data-invictus-share-prev-visibility') || '';
            element.style.visibility = previous;
            element.removeAttribute('data-invictus-share-hidden');
            element.removeAttribute('data-invictus-share-prev-visibility');
          });

          const card = document.querySelector('.share-card-art');
          if (card?.getAttribute('data-invictus-native-added-exporting') === 'true') {
            card.classList.remove('is-exporting');
            card.removeAttribute('data-invictus-native-added-exporting');
          }
        })();
        """
        DispatchQueue.main.async {
            webView.evaluateJavaScript(restoreScript, completionHandler: nil)
        }
    }

    private func storyJpegData(from image: UIImage) -> Data? {
        let targetSize = CGSize(width: 1080, height: 1920)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true

        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        let rendered = renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: targetSize))

            let source = image.size
            guard source.width > 0, source.height > 0 else { return }
            let scale = max(targetSize.width / source.width, targetSize.height / source.height)
            let drawSize = CGSize(width: source.width * scale, height: source.height * scale)
            let drawRect = CGRect(
                x: (targetSize.width - drawSize.width) / 2,
                y: (targetSize.height - drawSize.height) / 2,
                width: drawSize.width,
                height: drawSize.height
            )
            image.draw(in: drawRect)
        }
        return rendered.jpegData(compressionQuality: 0.94)
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
        let lower = nonEmpty.lowercased()
        if lower.hasSuffix(".jpg") || lower.hasSuffix(".jpeg") { return nonEmpty }
        if lower.hasSuffix(".png") {
            return String(nonEmpty.dropLast(4)) + ".jpg"
        }
        return nonEmpty + ".jpg"
    }
}

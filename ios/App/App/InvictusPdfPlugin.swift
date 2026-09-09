import Capacitor
import Foundation
import UIKit
import WebKit

@objc(InvictusPdfPlugin)
public class InvictusPdfPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InvictusPdfPlugin"
    public let jsName = "InvictusPdf"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "export", returnType: CAPPluginReturnPromise)
    ]

    @objc func export(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("Relatório indisponível para exportação.")
                return
            }
            let fileName = self.safeFileName(call.getString("fileName") ?? "invictus-saude.pdf")
            let paperRect = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
            let printableRect = paperRect.insetBy(dx: 28, dy: 28)
            let renderer = UIPrintPageRenderer()
            renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
            renderer.setValue(NSValue(cgRect: paperRect), forKey: "paperRect")
            renderer.setValue(NSValue(cgRect: printableRect), forKey: "printableRect")

            let data = NSMutableData()
            UIGraphicsBeginPDFContextToData(data, paperRect, nil)
            renderer.prepare(forDrawingPages: NSRange(location: 0, length: 1))
            guard renderer.numberOfPages > 0 else {
                UIGraphicsEndPDFContext()
                call.reject("O relatório não possui conteúdo para exportar.")
                return
            }
            for page in 0..<renderer.numberOfPages {
                UIGraphicsBeginPDFPage()
                renderer.drawPage(at: page, in: UIGraphicsGetPDFContextBounds())
            }
            UIGraphicsEndPDFContext()

            do {
                let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
                try data.write(to: fileURL, options: .atomic)
                guard let presenter = self.bridge?.viewController else {
                    call.reject("Tela de compartilhamento indisponível.")
                    return
                }
                let controller = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
                if let popover = controller.popoverPresentationController {
                    popover.sourceView = presenter.view
                    popover.sourceRect = presenter.view.bounds
                }
                controller.completionWithItemsHandler = { _, _, _, _ in
                    try? FileManager.default.removeItem(at: fileURL)
                }
                presenter.present(controller, animated: true) { call.resolve() }
            } catch {
                call.reject("Não foi possível gerar o arquivo PDF.", nil, error)
            }
        }
    }

    private func safeFileName(_ value: String) -> String {
        let sanitized = value.replacingOccurrences(of: "[^a-zA-Z0-9._-]", with: "-", options: .regularExpression)
        return sanitized.lowercased().hasSuffix(".pdf") ? sanitized : sanitized + ".pdf"
    }
}

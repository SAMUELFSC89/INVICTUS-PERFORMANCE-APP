import AuthenticationServices
import Capacitor
import CryptoKit
import Foundation
import Security
import UIKit

/// Registra plugins nativos que vivem diretamente no target do aplicativo.
/// Eles não entram no `packageClassList` gerado pelo `cap sync`, portanto sem
/// este registro a ponte JavaScript não encontra os plugins locais do Invictus.
final class InvictusBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(InvictusActivityPlugin())
        bridge?.registerPluginInstance(InstagramStoriesSharePlugin())
        bridge?.registerPluginInstance(InvictusShareCardPlugin())
        bridge?.registerPluginInstance(InvictusPdfPlugin())
        bridge?.registerPluginInstance(InvictusGoogleAuthPlugin())
    }
}

/// Login Google nativo para iOS sem depender de popup/redirect dentro do
/// WKWebView. O fluxo usa ASWebAuthenticationSession + OAuth 2.0 com PKCE e
/// devolve os tokens ao Firebase Web SDK, que continua sendo a fonte única da
/// sessão do usuário no app.
@objc(InvictusGoogleAuthPlugin)
public final class InvictusGoogleAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "InvictusGoogleAuthPlugin"
    public let jsName = "InvictusGoogleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    private var authSession: ASWebAuthenticationSession?

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Não foi possível iniciar o login com Google.")
                return
            }

            // ASWebAuthenticationSession representa uma transação única. Um
            // segundo toque enquanto a primeira janela ainda está aberta não
            // pode substituir `authSession` e deixar a primeira Promise órfã.
            guard self.authSession == nil else {
                call.reject("Já existe um login com Google em andamento.")
                return
            }

            guard
                let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
                !clientID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                let reversedClientID = Bundle.main.object(forInfoDictionaryKey: "GIDReversedClientID") as? String,
                !reversedClientID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                call.reject("Configuração do Google Sign-In ausente no app iOS.")
                return
            }

            let verifier = Self.randomURLSafeString()
            let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
            let state = Self.randomURLSafeString(byteCount: 24)
            let redirectURI = "\(reversedClientID):/oauthredirect"

            var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
            components.queryItems = [
                URLQueryItem(name: "client_id", value: clientID),
                URLQueryItem(name: "redirect_uri", value: redirectURI),
                URLQueryItem(name: "response_type", value: "code"),
                URLQueryItem(name: "scope", value: "openid email profile"),
                URLQueryItem(name: "code_challenge", value: challenge),
                URLQueryItem(name: "code_challenge_method", value: "S256"),
                URLQueryItem(name: "state", value: state),
                URLQueryItem(name: "prompt", value: "select_account")
            ]

            guard let authorizationURL = components.url else {
                call.reject("Não foi possível montar a autenticação do Google.")
                return
            }

            let session = ASWebAuthenticationSession(
                url: authorizationURL,
                callbackURLScheme: reversedClientID
            ) { [weak self] callbackURL, error in
                guard let self else { return }
                self.authSession = nil

                if let authError = error as? ASWebAuthenticationSessionError,
                   authError.code == .canceledLogin {
                    call.reject("Login com Google cancelado.")
                    return
                }
                if let error {
                    call.reject("Falha ao autenticar com Google: \(error.localizedDescription)")
                    return
                }

                guard let callbackURL,
                      callbackURL.scheme?.lowercased() == reversedClientID.lowercased(),
                      callbackURL.host == nil,
                      callbackURL.path == "/oauthredirect",
                      let callback = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                    call.reject("O Google retornou um callback inválido.")
                    return
                }

                // Dictionary(uniqueKeysWithValues:) causa fatalError quando a
                // URL contém a mesma chave duas vezes. Além do crash, aceitar
                // parâmetros duplicados em state/code é ambíguo. Parseamos de
                // forma fail-closed e rejeitamos qualquer duplicidade.
                guard let values = Self.uniqueQueryValues(callback.queryItems ?? []) else {
                    call.reject("O Google retornou parâmetros de autenticação duplicados.")
                    return
                }
                if let oauthError = values["error"], !oauthError.isEmpty {
                    call.reject("O Google recusou o login: \(oauthError)")
                    return
                }
                guard values["state"] == state else {
                    call.reject("Resposta de autenticação inválida. Tente novamente.")
                    return
                }
                guard let code = values["code"], !code.isEmpty else {
                    call.reject("O Google não retornou o código de autenticação.")
                    return
                }

                self.exchangeCode(
                    code: code,
                    verifier: verifier,
                    clientID: clientID,
                    redirectURI: redirectURI,
                    call: call
                )
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session

            if !session.start() {
                self.authSession = nil
                call.reject("Não foi possível abrir a autenticação do Google.")
            }
        }
    }

    private func exchangeCode(
        code: String,
        verifier: String,
        clientID: String,
        redirectURI: String,
        call: CAPPluginCall
    ) {
        guard let url = URL(string: "https://oauth2.googleapis.com/token") else {
            call.reject("Endpoint de autenticação inválido.")
            return
        }

        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code_verifier", value: verifier)
        ]

        guard let body = form.percentEncodedQuery?.data(using: .utf8) else {
            call.reject("Não foi possível finalizar o login com Google.")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                call.reject("Falha ao validar o login com Google: \(error.localizedDescription)")
                return
            }

            guard let http = response as? HTTPURLResponse,
                  let data else {
                call.reject("Resposta inválida ao validar o login com Google.")
                return
            }

            guard (200..<300).contains(http.statusCode) else {
                let details = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                let message = (details?["error_description"] as? String)
                    ?? (details?["error"] as? String)
                    ?? "HTTP \(http.statusCode)"
                call.reject("O Google não concluiu o login: \(message)")
                return
            }

            guard
                let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                let idToken = payload["id_token"] as? String,
                !idToken.isEmpty
            else {
                call.reject("O Google não retornou um token de identidade válido.")
                return
            }

            var result: [String: Any] = ["idToken": idToken]
            if let accessToken = payload["access_token"] as? String, !accessToken.isEmpty {
                result["accessToken"] = accessToken
            }
            call.resolve(result)
        }.resume()
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        if let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
           let window = windowScene.windows.first(where: { $0.isKeyWindow }) ?? windowScene.windows.first {
            return window
        }
        return ASPresentationAnchor()
    }

    private static func uniqueQueryValues(_ items: [URLQueryItem]) -> [String: String]? {
        var values: [String: String] = [:]
        for item in items {
            if values[item.name] != nil { return nil }
            values[item.name] = item.value ?? ""
        }
        return values
    }

    private static func randomURLSafeString(byteCount: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status == errSecSuccess {
            return base64URL(Data(bytes))
        }
        return UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

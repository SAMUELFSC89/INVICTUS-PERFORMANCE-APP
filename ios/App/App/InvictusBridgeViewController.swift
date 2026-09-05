import Capacitor

/// Registra plugins nativos que vivem diretamente no target do aplicativo.
/// Eles não entram no `packageClassList` gerado pelo `cap sync`, portanto sem
/// este registro a ponte JavaScript não encontra `InvictusActivity`.
final class InvictusBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(InvictusActivityPlugin())
        bridge?.registerPluginInstance(InstagramStoriesSharePlugin())
    }
}

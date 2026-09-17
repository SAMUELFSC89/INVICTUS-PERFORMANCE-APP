package com.desafiosemdesculpa.app;

import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.auth.api.signin.GoogleSignInStatusCodes;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

/**
 * Login Google nativo do Android.
 *
 * O Firebase Web Auth não pode depender de signInWithRedirect()/popup dentro
 * do WebView do Capacitor: em Android esse fluxo pode falhar antes mesmo de
 * abrir o seletor de contas com auth/argument-error. O plugin abaixo abre o
 * seletor nativo do Google Play Services, devolve somente o ID token ao JS e
 * deixa o Firebase Web SDK criar a sessão canônica com signInWithCredential.
 */
@CapacitorPlugin(name = "InvictusGoogleAuth")
public class InvictusGoogleAuthPlugin extends Plugin {
    private GoogleSignInClient googleClient;

    @PluginMethod
    public void signIn(PluginCall call) {
        final String serverClientId;
        try {
            serverClientId = getContext().getString(R.string.default_web_client_id);
        } catch (Exception error) {
            call.reject("Configuração do Google Sign-In ausente no Android. Atualize o google-services.json.");
            return;
        }

        if (serverClientId == null || serverClientId.trim().isEmpty()) {
            call.reject("Configuração do Google Sign-In ausente no Android. Atualize o google-services.json.");
            return;
        }

        GoogleSignInOptions options = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestProfile()
            .requestIdToken(serverClientId)
            .build();

        googleClient = GoogleSignIn.getClient(getActivity(), options);

        // O produto pede explicitamente seleção de conta a cada toque. Limpar
        // apenas o estado local do Google Sign-In não encerra a sessão Firebase;
        // serve para evitar que uma conta anterior seja escolhida silenciosamente.
        googleClient.signOut().addOnCompleteListener(task -> {
            Intent intent = googleClient.getSignInIntent();
            startActivityForResult(call, intent, "handleGoogleSignInResult");
        });
    }

    @ActivityCallback
    private void handleGoogleSignInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result != null ? result.getData() : null;
        if (data == null) {
            call.reject("Login com Google cancelado.");
            return;
        }

        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            String idToken = account != null ? account.getIdToken() : null;
            if (idToken == null || idToken.trim().isEmpty()) {
                call.reject("O Google não retornou um token de identidade válido.");
                return;
            }

            JSObject response = new JSObject();
            response.put("idToken", idToken);
            call.resolve(response);
        } catch (ApiException error) {
            int status = error.getStatusCode();
            if (status == GoogleSignInStatusCodes.SIGN_IN_CANCELLED) {
                call.reject("Login com Google cancelado.");
                return;
            }
            if (status == 10) {
                // DEVELOPER_ERROR: normalmente package/SHA-1/SHA-256 do APK não
                // está registrado no OAuth Android do mesmo projeto Firebase.
                call.reject("Google Sign-In do Android não está autorizado para a assinatura deste aplicativo. Registre o SHA-1/SHA-256 do APK no Firebase e atualize o google-services.json.");
                return;
            }
            call.reject("Não foi possível entrar com Google no Android (código " + status + ").");
        } catch (Exception error) {
            call.reject("Não foi possível concluir o login com Google no Android.");
        }
    }
}

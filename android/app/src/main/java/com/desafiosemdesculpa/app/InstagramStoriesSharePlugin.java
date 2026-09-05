package com.desafiosemdesculpa.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Equivalente Android do InstagramStoriesSharePlugin.swift (ver comentário lá
 * para o contexto completo do recurso -- #202: "Stats Stickers" do Strava).
 * Usa o intent oficial ADD_TO_STORY da Meta em vez do UIPasteboard, que só
 * existe no iOS.
 *
 * IMPORTANTE -- nível de confiança dos 3 caminhos abaixo:
 * - "só sticker" (interactive_asset_uri) e "só fundo" (setDataAndType) são os
 *   dois formatos com documentação e exemplos públicos amplamente
 *   confirmados (developers.facebook.com/docs/sharing/sharing-to-stories).
 * - "fundo + sticker simultâneos" (background_asset_uri + interactive_asset_uri
 *   ao mesmo tempo) é o formato que a documentação da Meta descreve para
 *   Android, mas com muito menos exemplos públicos verificáveis do que o par
 *   equivalente no iOS. Só deve ser considerado validado depois de um teste
 *   real num Android físico com o Instagram instalado -- não presuma que
 *   funciona só porque compilou (regra do projeto: nunca declarar testado
 *   sem testar de verdade).
 */
@CapacitorPlugin(name = "InstagramStoriesShare")
public class InstagramStoriesSharePlugin extends Plugin {
    private static final String INSTAGRAM_PACKAGE = "com.instagram.android";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", isInstagramInstalled());
        call.resolve(result);
    }

    @PluginMethod
    public void share(PluginCall call) {
        if (!isInstagramInstalled()) {
            call.reject("Instagram não está instalado neste aparelho.");
            return;
        }

        String backgroundBase64 = call.getString("backgroundBase64");
        String stickerBase64 = call.getString("stickerBase64");
        String topColor = call.getString("topColor");
        String bottomColor = call.getString("bottomColor");
        // source_application é usado pela Meta só para atribuição; não exige um
        // Facebook App ID registrado/aprovado para este fluxo funcionar.
        String appId = call.getString("appId", getContext().getPackageName());

        if (backgroundBase64 == null && stickerBase64 == null) {
            call.reject("Envie ao menos uma imagem (fundo ou sticker).");
            return;
        }

        try {
            Uri backgroundUri = backgroundBase64 != null ? writeTempPng(backgroundBase64, "ig_bg") : null;
            Uri stickerUri = stickerBase64 != null ? writeTempPng(stickerBase64, "ig_sticker") : null;

            Intent intent = new Intent("com.instagram.share.ADD_TO_STORY");
            intent.putExtra("source_application", appId);
            if (topColor != null) intent.putExtra("top_background_color", topColor);
            if (bottomColor != null) intent.putExtra("bottom_background_color", bottomColor);

            if (backgroundUri != null && stickerUri != null) {
                intent.setType("image/*");
                intent.putExtra("interactive_asset_uri", stickerUri);
                intent.putExtra("background_asset_uri", backgroundUri);
                grantUriPermission(INSTAGRAM_PACKAGE, backgroundUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                grantUriPermission(INSTAGRAM_PACKAGE, stickerUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else if (stickerUri != null) {
                intent.setType("image/*");
                intent.putExtra("interactive_asset_uri", stickerUri);
                grantUriPermission(INSTAGRAM_PACKAGE, stickerUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                intent.setDataAndType(backgroundUri, "image/*");
                grantUriPermission(INSTAGRAM_PACKAGE, backgroundUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setPackage(INSTAGRAM_PACKAGE);

            if (getActivity().getPackageManager().resolveActivity(intent, 0) != null) {
                getActivity().startActivityForResult(intent, 0);
                call.resolve();
            } else {
                call.reject("O Instagram não conseguiu abrir os Stories.");
            }
        } catch (Exception error) {
            call.reject("Não foi possível preparar a imagem para o Instagram.", error);
        }
    }

    private boolean isInstagramInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(INSTAGRAM_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private Uri writeTempPng(String base64, String prefix) throws Exception {
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        File dir = new File(getContext().getCacheDir(), "instagram_share");
        if (!dir.exists()) dir.mkdirs();
        File file = new File(dir, prefix + "_" + System.currentTimeMillis() + ".png");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        // Mesma authority do FileProvider já declarado no AndroidManifest.xml
        // (usado por outros fluxos de compartilhamento) -- cache-path com
        // path="." já cobre esta subpasta, sem precisar editar o manifest.
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }
}

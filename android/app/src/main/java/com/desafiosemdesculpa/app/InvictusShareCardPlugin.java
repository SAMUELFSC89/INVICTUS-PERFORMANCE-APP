package com.desafiosemdesculpa.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "InvictusShareCard",
    permissions = @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "legacyStorage")
)
public class InvictusShareCardPlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        try {
            byte[] image = decodeImage(call);
            String fileName = safeFileName(call.getString("fileName", "invictus-atividade.png"));
            File directory = new File(getContext().getCacheDir(), "share_cards");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Não foi possível criar a pasta temporária.");
            File file = new File(directory, fileName);
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(image); }

            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("image/png");
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(intent, "Compartilhar atividade"));
            call.resolve();
        } catch (Exception error) {
            call.reject("Não foi possível compartilhar a imagem.", error);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("legacyStorage") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyStorage", call, "legacyStorageCallback");
            return;
        }
        saveToGallery(call);
    }

    @PermissionCallback
    private void legacyStorageCallback(PluginCall call) {
        if (getPermissionState("legacyStorage") != PermissionState.GRANTED) {
            call.reject("Permita o acesso ao armazenamento para salvar o card.");
            return;
        }
        saveToGallery(call);
    }

    private void saveToGallery(PluginCall call) {
        try {
            byte[] image = decodeImage(call);
            String fileName = safeFileName(call.getString("fileName", "invictus-atividade.png"));
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");

            Uri collection;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Invictus");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            } else {
                collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            }

            Uri uri = resolver.insert(collection, values);
            if (uri == null) throw new IllegalStateException("A galeria recusou o arquivo.");
            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("Não foi possível abrir o arquivo na galeria.");
                output.write(image);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, ready, null, null);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Não foi possível salvar a imagem na galeria.", error);
        }
    }

    private byte[] decodeImage(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) throw new IllegalArgumentException("Imagem ausente.");
        return Base64.decode(base64, Base64.DEFAULT);
    }

    private String safeFileName(String value) {
        String sanitized = value.replaceAll("[^a-zA-Z0-9._-]", "-");
        return sanitized.endsWith(".png") ? sanitized : sanitized + ".png";
    }
}

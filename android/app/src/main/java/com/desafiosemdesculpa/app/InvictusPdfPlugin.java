package com.desafiosemdesculpa.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "InvictusPdf")
public class InvictusPdfPlugin extends Plugin {
    @PluginMethod
    public void export(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                if (webView == null) {
                    call.reject("Relatório indisponível para exportação.");
                    return;
                }
                String fileName = safeFileName(call.getString("fileName", "invictus-saude.pdf"));
                PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) {
                    call.reject("O serviço de PDF não está disponível neste dispositivo.");
                    return;
                }
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(fileName);
                manager.print(fileName, adapter, new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                    .build());
                call.resolve();
            } catch (Exception error) {
                call.reject("Não foi possível abrir a exportação do PDF.", error);
            }
        });
    }

    private String safeFileName(String value) {
        String sanitized = value.replaceAll("[^a-zA-Z0-9._-]", "-");
        return sanitized.toLowerCase().endsWith(".pdf") ? sanitized : sanitized + ".pdf";
    }
}

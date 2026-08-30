package com.desafiosemdesculpa.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Coletor nativo do percurso no Android. O ForegroundService de atividade
 * mantém o processo elegível para localização enquanto a tela está apagada;
 * este plugin registra os pontos independentemente do WebView/JavaScript.
 */
@CapacitorPlugin(name = "InvictusActivity")
public class InvictusActivityPlugin extends Plugin implements LocationListener {
    private static final String PREFS_NAME = "invictus_activity";
    private static final String LOCATIONS_KEY = "background_locations";
    private static final int MAX_POINTS = 5000;
    private static final long MIN_TIME_MS = 2000L;
    private static final float MIN_DISTANCE_METERS = 3f;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final JSONArray trackedLocations = new JSONArray();
    private LocationManager locationManager;
    private int pointsSincePersist = 0;

    @Override
    public void load() {
        locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        restoreLocations();
    }

    @PluginMethod
    public void startLocationTracking(PluginCall call) {
        if (!hasLocationPermission()) {
            call.reject("Permissão de localização não concedida.");
            return;
        }

        mainHandler.post(() -> {
            try {
                clearLocations();
                boolean providerStarted = false;
                if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        MIN_TIME_MS,
                        MIN_DISTANCE_METERS,
                        this,
                        Looper.getMainLooper()
                    );
                    providerStarted = true;
                }
                if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        5000L,
                        10f,
                        this,
                        Looper.getMainLooper()
                    );
                    providerStarted = true;
                }
                if (!providerStarted) {
                    call.reject("Ative a localização do aparelho para registrar a atividade.");
                    return;
                }
                call.resolve();
            } catch (SecurityException error) {
                call.reject("Não foi possível iniciar a localização.", error);
            }
        });
    }

    @PluginMethod
    public void getTrackedLocations(PluginCall call) {
        call.resolve(locationResult());
    }

    @PluginMethod
    public void stopLocationTracking(PluginCall call) {
        mainHandler.post(() -> {
            try {
                if (locationManager != null) locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {
                // A permissão pode ser removida durante uma atividade.
            }
            persistLocations();
            call.resolve(locationResult());
        });
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null || !location.hasAccuracy() || location.getAccuracy() < 0 || location.getAccuracy() > 100) {
            return;
        }

        try {
            JSONObject point = new JSONObject();
            point.put("lat", location.getLatitude());
            point.put("lng", location.getLongitude());
            point.put("accuracy", location.getAccuracy());
            point.put("timestamp", isoTimestamp(location.getTime()));
            point.put("speedKmH", location.hasSpeed() ? Math.max(0, location.getSpeed() * 3.6) : 0);
            point.put("isSimulated", isMockLocation(location));
            trackedLocations.put(point);
            while (trackedLocations.length() > MAX_POINTS) trackedLocations.remove(0);

            pointsSincePersist++;
            if (pointsSincePersist >= 5) persistLocations();
        } catch (JSONException ignored) {
            // Todos os valores acima são tipos JSON primitivos válidos.
        }
    }

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    @Override
    @SuppressWarnings("deprecation")
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isMockLocation(Location location) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return location.isMock();
        return location.isFromMockProvider();
    }

    private String isoTimestamp(long timestampMs) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(timestampMs));
    }

    private synchronized JSObject locationResult() {
        JSObject result = new JSObject();
        try {
            result.put("locations", new JSONArray(trackedLocations.toString()));
        } catch (JSONException error) {
            result.put("locations", new JSONArray());
        }
        return result;
    }

    private synchronized void clearLocations() {
        while (trackedLocations.length() > 0) trackedLocations.remove(0);
        persistLocations();
    }

    private synchronized void persistLocations() {
        pointsSincePersist = 0;
        getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(LOCATIONS_KEY, trackedLocations.toString())
            .apply();
    }

    private synchronized void restoreLocations() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String saved = prefs.getString(LOCATIONS_KEY, "[]");
        try {
            JSONArray restored = new JSONArray(saved);
            int start = Math.max(0, restored.length() - MAX_POINTS);
            for (int index = start; index < restored.length(); index++) {
                trackedLocations.put(restored.getJSONObject(index));
            }
        } catch (JSONException ignored) {
            clearLocations();
        }
    }
}

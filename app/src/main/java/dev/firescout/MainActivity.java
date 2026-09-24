package dev.firescout;

import android.Manifest;
import android.app.*;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.webkit.*;
import org.json.*;
import java.util.*;

/** Foreground-only prototype. All UI and BLE lifecycle operations run on main thread. */
public class MainActivity extends Activity {
    private static final UUID SERVICE=UUID.fromString("9a9d0001-6b5e-4e21-8b3f-12a6a66a9200");
    private static final UUID TELEMETRY=UUID.fromString("9a9d0002-6b5e-4e21-8b3f-12a6a66a9200");
    private static final UUID CCCD=UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Map<String,BluetoothDevice> devices=new HashMap<>();
    private WebView web;
    private BluetoothAdapter adapter;
    private BluetoothLeScanner scanner;
    private BluetoothGatt gatt;
    private boolean scanning=false, ready=false;
    private int notificationId=100;
    private final Runnable scanTimeout=()->stopScan();
    private final Runnable connectTimeout=()->{if(gatt!=null&&!ready){disconnect();say("Подключение не завершилось за 15 секунд. Попробуй снова.");}};

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().setStatusBarColor(0xff101713);
        getWindow().setNavigationBarColor(0xff101713);
        web=new WebView(this);
        web.setBackgroundColor(0xff101713);
        web.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
        });
        web.addJavascriptInterface(new Bridge(),"Android");
        web.loadUrl("file:///android_asset/index.html");
        BluetoothManager manager=getSystemService(BluetoothManager.class);
        adapter=manager==null?null:manager.getAdapter();
        NotificationChannel channel=new NotificationChannel("fire","Возможный пожар",NotificationManager.IMPORTANCE_HIGH);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    private void js(String function,Object value){
        String arg=value instanceof JSONArray?value.toString():JSONObject.quote(String.valueOf(value));
        handler.post(()->{if(web!=null)web.evaluateJavascript("window."+function+" && window."+function+"("+arg+")",null);});
    }
    private void say(String text){js("nativeStatus",text);}
    private boolean permissions(){
        if(Build.VERSION.SDK_INT>=31)return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED;
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
    }
    private void scan(){
        disconnect();devices.clear();
        if(adapter==null){say("Bluetooth LE отсутствует на этом устройстве.");return;}
        if(!permissions()){
            requestPermissions(Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION},10);return;
        }
        try{
            if(!adapter.isEnabled()){say("Включи Bluetooth в настройках и повтори поиск.");return;}
            scanner=adapter.getBluetoothLeScanner();
            if(scanner==null){say("Сканер Bluetooth недоступен.");return;}
            ScanFilter filter=new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build();
            scanner.startScan(Collections.singletonList(filter),new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),scanCallback);
            scanning=true;handler.postDelayed(scanTimeout,10000);say("Поиск FireScout…");
        }catch(SecurityException|IllegalStateException e){say("Поиск недоступен: проверь разрешения и Bluetooth.");}
    }
    private void stopScan(){
        handler.removeCallbacks(scanTimeout);
        if(scanning&&scanner!=null){try{scanner.stopScan(scanCallback);}catch(SecurityException|IllegalStateException ignored){}}
        boolean was=scanning;scanning=false;
        if(was)say(devices.isEmpty()?"Устройства не найдены. Без оборудования используй симуляцию.":"Поиск завершён. Выбери устройство.");
    }
    private final ScanCallback scanCallback=new ScanCallback(){
        @Override public void onScanResult(int type,ScanResult result){handler.post(()->{
            if(!scanning)return;
            try{
                BluetoothDevice device=result.getDevice();String address=device.getAddress();
                if(devices.containsKey(address))return;devices.put(address,device);
                String name=device.getName();
                web.evaluateJavascript("window.nativeDevice("+JSONObject.quote(address)+","+JSONObject.quote(name==null?"FireScout":name)+")",null);
            }catch(SecurityException e){say("Доступ к устройству запрещён.");}
        });}
        @Override public void onScanFailed(int code){handler.post(()->{stopScan();say("Ошибка поиска BLE: "+code);});}
    };
    private void connect(String address){
        BluetoothDevice device=devices.get(address);if(device==null){say("Устройство не найдено. Повтори поиск.");return;}
        disconnect();
        try{gatt=device.connectGatt(this,false,callback,BluetoothDevice.TRANSPORT_LE);handler.postDelayed(connectTimeout,15000);say("Подключаемся к устройству…");}
        catch(SecurityException|IllegalArgumentException e){say("Подключение недоступно. Проверь разрешения.");}
    }
    private void disconnect(){
        stopScan();handler.removeCallbacks(connectTimeout);ready=false;
        BluetoothGatt previous=gatt;gatt=null;
        if(previous!=null){try{previous.disconnect();previous.close();}catch(SecurityException ignored){}}
    }
    private void fail(String reason){disconnect();js("nativeDisconnected","");say(reason);}
    private final BluetoothGattCallback callback=new BluetoothGattCallback(){
        @Override public void onConnectionStateChange(BluetoothGatt current,int status,int state){handler.post(()->{
            if(current!=gatt)return;
            if(status!=BluetoothGatt.GATT_SUCCESS||state==BluetoothProfile.STATE_DISCONNECTED){fail("BLE отключён. Подключись повторно.");return;}
            if(state==BluetoothProfile.STATE_CONNECTED){try{if(!current.discoverServices())fail("Не удалось начать поиск сервисов.");}catch(SecurityException e){fail("Нет разрешения Bluetooth.");}}
        });}
        @Override public void onServicesDiscovered(BluetoothGatt current,int status){handler.post(()->{
            if(current!=gatt)return;
            if(status!=BluetoothGatt.GATT_SUCCESS){fail("Не удалось прочитать сервисы.");return;}
            BluetoothGattService service=current.getService(SERVICE);
            BluetoothGattCharacteristic characteristic=service==null?null:service.getCharacteristic(TELEMETRY);
            BluetoothGattDescriptor descriptor=characteristic==null?null:characteristic.getDescriptor(CCCD);
            if(descriptor==null||(characteristic.getProperties()&BluetoothGattCharacteristic.PROPERTY_NOTIFY)==0){fail("Устройство не поддерживает протокол FireScout.");return;}
            try{
                if(!current.setCharacteristicNotification(characteristic,true)){fail("Не удалось включить уведомления BLE.");return;}
                descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                if(!current.writeDescriptor(descriptor))fail("Не удалось подписаться на данные.");
            }catch(SecurityException e){fail("Нет разрешения Bluetooth.");}
        });}
        @Override public void onDescriptorWrite(BluetoothGatt current,BluetoothGattDescriptor descriptor,int status){handler.post(()->{
            if(current!=gatt)return;
            if(status!=BluetoothGatt.GATT_SUCCESS){fail("Подписка на телеметрию отклонена.");return;}
            ready=true;handler.removeCallbacks(connectTimeout);say("BLE подключён. Ожидаем пакет телеметрии.");
            handler.postDelayed(()->{if(current==gatt&&ready)say("BLE активен. Если показаний нет, проверь отправку пакетов устройством.");},6000);
        });}
        @Override public void onCharacteristicChanged(BluetoothGatt current,BluetoothGattCharacteristic characteristic){deliver(current,characteristic,characteristic.getValue());}
        @Override public void onCharacteristicChanged(BluetoothGatt current,BluetoothGattCharacteristic characteristic,byte[] value){deliver(current,characteristic,value);}
    };
    private void deliver(BluetoothGatt current,BluetoothGattCharacteristic characteristic,byte[] value){
        if(value==null||!TELEMETRY.equals(characteristic.getUuid()))return;
        byte[] copy=value.clone();handler.post(()->{if(current!=gatt||!ready)return;JSONArray a=new JSONArray();for(byte b:copy)a.put(b&255);js("nativePacket",a);});
    }
    private class Bridge {
        @JavascriptInterface public void scan(){handler.post(()->MainActivity.this.scan());}
        @JavascriptInterface public void stopScan(){handler.post(()->MainActivity.this.stopScan());}
        @JavascriptInterface public void connect(String address){handler.post(()->MainActivity.this.connect(address));}
        @JavascriptInterface public void disconnect(){handler.post(()->MainActivity.this.disconnect());}
        @JavascriptInterface public void enableNotifications(){handler.post(()->{
            if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},11);
            else say(getSystemService(NotificationManager.class).areNotificationsEnabled()?"Уведомления включены.":"Разреши уведомления в настройках приложения.");
        });}
        @JavascriptInterface public void alert(String body){handler.post(()->{
            NotificationManager manager=getSystemService(NotificationManager.class);
            if(!manager.areNotificationsEnabled()){say("Событие записано. Системные уведомления отключены.");return;}
            PendingIntent intent=PendingIntent.getActivity(MainActivity.this,0,new Intent(MainActivity.this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            try{manager.notify(notificationId++,new Notification.Builder(MainActivity.this,"fire").setSmallIcon(android.R.drawable.ic_dialog_alert).setContentTitle("FireScout: возможный пожар").setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setContentIntent(intent).setAutoCancel(true).build());}catch(SecurityException e){say("Уведомления запрещены.");}
        });}
    }
    @Override public void onRequestPermissionsResult(int request,String[] names,int[] grants){
        super.onRequestPermissionsResult(request,names,grants);
        if(request==10){if(permissions())scan();else say("Разрешение Bluetooth не выдано. Симуляция доступна.");}
        if(request==11)say(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED?"Уведомления включены.":"Уведомления не разрешены. События останутся в журнале.");
    }
    @Override protected void onStop(){disconnect();js("nativePaused","");super.onStop();}
    @Override protected void onDestroy(){disconnect();handler.removeCallbacksAndMessages(null);if(web!=null){web.removeJavascriptInterface("Android");web.destroy();web=null;}super.onDestroy();}
}

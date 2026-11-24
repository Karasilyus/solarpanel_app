# Güneş paneli backend'i

## Veritabanı

Veritabanında iki tabloda, her panel ve dakika için bir kayıt tutulur:

- `takipli_panel_kayitlari`: Her iki servo açısı ile güneş azimut ve yükseklik
  açılarını da içeren hareketli/takipli panel kayıtları.
- `sabit_panel_kayitlari`: Sabit panel kayıtları.

Her iki tabloda da birincil anahtar olarak
`(cihaz_id, acilis_sayaci, kayit_sira_no)` kullanılır. Yeni bir veritabanı için
`db/schema.sql` dosyasını uygulayın. İki tablonun zaten bulunduğu bir veritabanı
için sırasıyla `db/migrations/002_dashboard_latest_series.sql` ve
`db/migrations/003_dashboard_api_v1.sql` dosyalarını birer kez çalıştırın.
Önceki `minute_records` veritabanından geçiş yaparken önce
`db/migrations/001_split_panel_tables.sql` dosyasını, ardından 002 ve 003
migration'larını birer kez çalıştırın. 001 numaralı migration,
`minute_records` tablosunu siler; saklamak istediğiniz verileri önceden
yedekleyin. 003 numaralı migration, kayıtlı panel akımını amperden
miliampere dönüştürür.

## Docker kullanmadan çalıştırma

Node.js 20 veya daha yeni bir sürüm kullanın:

```sh
npm install
cp .env.example .env
npm start
```

`DATABASE_URL` değişkenini veya standart `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER` ve `PGPASSWORD` değişkenlerini ayarlayın. Varsayılan `PORT` değeri
`3000`'dür. `CORS_ORIGIN` varsayılan olarak `*` değerini kullanır. Dağıtım
ortamında bu değişkeni izin verilen origin'leri virgülle ayırarak belirtecek
şekilde ayarlayın.

## Donanım I2C adresleri

Cihaz yazılımı, şemadaki I2C adreslerini kullanmalıdır: PCA9685 için `0x40`,
iki INA219 sensörü için `0x41` ve `0x44`. Bu backend I2C hattına erişmez;
ölçümleri `POST /api/records` isteğiyle alır. Cihaz yazılımı, INA219
okumalarını takipli veya sabit panelin ilgili payload alanlarına (`trk_*` ya da
`fix_*`) yerleştirmelidir. API veya veritabanında adres ayarı gerekmez.

## Cihaz payload'ı

### `POST /api/records`

1–20 adet dakikalık kayıt içeren bir JSON dizisi gönderin:

```json
{
  "cihaz_id": "panel-01",
  "acilis_sayaci": 3,
  "kayit_sira_no": 142,
  "zaman_saniye": 1794268800,
  "gece_modu": false,
  "olcum_sayisi": 5,
  "takipli_gecerli_olcum_sayisi": 5,
  "sabit_gecerli_olcum_sayisi": 5,
  "calisma_suresi_saniye": 86400,
  "servo_azimut_derece": 15,
  "servo_yukseklik_derece": 35,
  "gunes_azimut_derece": 22,
  "gunes_yukseklik_derece": 48,
  "takipli_panel": {
    "enerji_wh": 0.42,
    "guc_w": 25,
    "max_guc_w": 28,
    "min_guc_w": 21,
    "gerilim_v": 12.5,
    "akim_a": 2
  },
  "sabit_panel": {
    "enerji_wh": 0.31,
    "guc_w": 18,
    "max_guc_w": 20,
    "min_guc_w": 15,
    "gerilim_v": 12,
    "akim_a": 1.5
  }
}
```

API, özgün Türkçe payload anahtarlarını ve ESP/frontend v1 anahtarlarını kabul
eder (`device_id`, `boot`, `seq`, `ts`, `night`, `n`, `trk_ok`, `fix_ok`,
`trk_wh`/`fix_wh`, `trk_v`/`trk_ma`, `fix_v`/`fix_ma`, `sun_az`/`sun_el`,
`servo_az`/`servo_el`, `uptime_s`). `ts`/`zaman_saniye`, saniye cinsinden Unix
epoch zamanıdır; `0` değeri SQL `NULL` olarak kaydedilir.
`calisma_suresi_saniye` isteğe bağlıdır ve cihaz tarafından gönderilir.
Sunucu yeni bir kayıt aldığında `alindi_at` değeri PostgreSQL tarafından
atanır. Yinelenen kayıtların yeniden gönderilmesi, ölçüm değerlerini
değiştirmeden bu alınma zamanını günceller. v1 sözleşmesinde gerilim V,
akım mA cinsindendir; eski `akim_a` girdisi amperden dönüştürülür. Yeni
gerilim/akım/açı alanları gönderilmeyebilir; cihaz bu alanları gönderene kadar
`NULL` olarak saklanırlar. `enerji_wh`, kaydedilen dakikanın enerjisidir;
ortalama güç gönderilmezse `enerji_wh * 60` olarak hesaplanır.
Her iki panel kaydı tek bir işlem içinde yazılır. Veritabanı hatası veya
yinelenen kayıtlar arasında tutarsızlık olması durumunda tüm paket geri alınır.
HTTP 200 yanıtı, cihazın gönderdiği kayıtları temizleyebileceğini belirtir.

## Gösterge paneli API'si

Tüm gösterge paneli uç noktaları `device_id` (veya eski adıyla `cihaz_id`)
parametresini kabul eder. Tarihler `Europe/Istanbul` saat dilimine göre
yorumlanır.

### `GET /api/dashboard/series?device_id=panel-01&date=2026-11-09&interval=5`

İstenen güne ait eşleştirilmiş dakika verilerini v1 yanıt biçiminde döndürür.
`interval` isteğe bağlıdır; 1–60 dakika arasında bir değere ayarlanarak kaç
dakikada bir veri noktası alınacağını belirler. Varsayılan değeri `1`'dir.
Zaman damgaları UTC anlarını, gün sınırları ise `Europe/Istanbul` saat dilimini
kullanır. Her veri noktası `ts`, `night`, `n`, `trk_ok`, `fix_ok`, `trk_wh`,
`fix_wh`, `trk_v`, `trk_ma`, `fix_v`, `fix_ma`, `sun_az`, `sun_el`,
`servo_az`, `servo_el`, `trk_cumulative_wh` ve `fix_cumulative_wh` alanlarını
içerir. Henüz gönderilmemiş sensör ölçümleri `null` olur.

### `GET /api/dashboard/daily?device_id=panel-01&from=2026-11-01&to=2026-11-09`

Belirtilen tarih aralığındaki (başlangıç ve bitiş tarihleri dahil, en fazla
366 gün) veri bulunan günleri bir dizi olarak döndürür: `date`, `trk_wh`,
`fix_wh`, `gain_wh`, `gain_percent`, `trk_peak_w`, `fix_peak_w`,
`complete_minutes`, `total_minutes` ve `coverage_percent`. Enerji hesabına
sadece gündüz alınan eksiksiz örnekler katılır. Kapsama oranı, eksiksiz
örneklerin o gün zaman damgası bilinen tüm alınmış örneklere bölünmesiyle
hesaplanır. Sabit panelin enerjisi sıfırsa `gain_percent: null` döner.

### `GET /api/dashboard/status?device_id=panel-01`

En son örneğin `night`, `uptime_s`, `boot`, panel değerleri, kazanç, güneşin
azimut/yükseklik açıları, servo azimut/yükseklik açıları ve çevrimiçi olma
durumunu döndürür. `last_record_at`, kaydın sunucuya ulaştığı zamandır.
`online` durumu varsayılan olarak 180 saniyelik bir eşik kullanır; bu değer
`ONLINE_THRESHOLD_SECONDS` ile değiştirilebilir. Bulunmayan cihazlar ve henüz
gönderilmemiş sensör alanları `null` olarak döndürülür.
`/api/dashboard/latest`, bu uç noktanın diğer adıdır.

### `GET /api/devices`

Bilinen her cihaz için `device_id`, çevrimiçi olma durumu, sunucunun son kayıt
alım zamanı, açılış sayacı ve sıra numarasını döndürür.

### `GET /api/dashboard/health?device_id=panel-01&from=2026-11-01&to=2026-11-09`

Günlük kayıt sayısını, beklenen dakika sayısını (1440), kapsama oranını,
zaman damgası bilinmeyen kayıt sayısını ve gözlemlenen açılış sayaçlarını
döndürür. Ayrıca zaman damgalarındaki boşlukları ve eksik dakika sayılarını
belirtir. Zaman damgası bilinmeyen kayıtlar, sunucuya ulaştıkları güne
atanır. Yanıt `{ "device_id", "days", "gaps" }` biçimindedir; kapsama
eksikliklerinin görülebilmesi için `days` alanında kayıt bulunmayan takvim
günleri de yer alır.

### `GET /healthz`

Veritabanı bağlantısını kontrol eder.

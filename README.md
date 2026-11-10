# Solar panel app

- [`backend/`](./backend) — Node.js/Express API ve PostgreSQL şeması (kurulum ve API için `backend/README.md`)
- [`frontend/`](./frontend) — Dashboard arayüzü (frontend geliştiricisi için ayrılmıştır)

Backend komutları `backend/` klasöründen çalıştırılır:

```sh
cd backend
npm install
npm start
```

## Docker ile çalıştırma

Proje kökünde `.env.example` dosyasını `.env` olarak kopyalayın, `POSTGRES_PASSWORD`
değerini değiştirin ve Docker Desktop/Engine çalışırken kök dizinden başlatın:

```sh
cp .env.example .env
docker compose up -d --build
```

API `http://localhost:3000`, PostgreSQL ise host makinede `localhost:5433`
üzerinden erişilir. Sağlık kontrolü: `http://localhost:3000/healthz`.
Online cihaz eşiği `.env` içindeki `ONLINE_THRESHOLD_SECONDS` ile ayarlanır
(varsayılan 180 saniye).
Şema, PostgreSQL volume ilk oluşturulduğunda otomatik uygulanır. Eski test
veritabanından geçiş için [migration dosyalarını](./backend/db/migrations/)
uygulayın.

Backend endpoint'leri, cihaz payload'ı ve veritabanı kurulumu için
[backend/README.md](./backend/README.md) dosyasına bakın.

### Windows kullanan frontend geliştiricisine erişim

Docker Compose PostgreSQL ve backend API'yi çalıştırır; frontend klasörü şu an
boştur ve frontend Docker imajına dahil değildir. Arkadaşınız aynı yerel ağda
olduğu sürece kendi Windows bilgisayarından Ubuntu'daki API'yi kullanabilir:

1. Ubuntu'daki API'yi `docker compose up -d --build` ile başlatın.
2. Ubuntu'nun yerel IP adresini `hostname -I` komutuyla öğrenin.
3. Frontend'in API adresini `http://UBUNTU_IP_ADRESI:3000` yapın; örneğin
   `http://192.168.1.25:3000`.
4. `http://UBUNTU_IP_ADRESI:3000/healthz` adresinin Windows tarayıcısından
   açıldığını kontrol edin.

Compose, API portu 3000'i ağ arayüzlerinde yayınlar; PostgreSQL portu 5433 ise
yalnızca Ubuntu'daki `localhost` üzerinden erişilir. Frontend doğrudan
PostgreSQL'e değil API'ye bağlanmalıdır. Erişim yoksa Ubuntu güvenlik duvarında
TCP 3000'e yerel ağdan izin verin ve iki bilgisayarın aynı/erişilebilir yerel
ağda olduğundan emin olun. `CORS_ORIGIN=*` geliştirme içindir; internete açık
sunucuda frontend origin'iyle sınırlandırın.

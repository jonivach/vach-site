# VACH* App (Android + iOS)

Este proyecto empaqueta el sitio `vach.com.ar` (carpeta `../vach-site`) como una app nativa instalable en Google Play y App Store, usando [Capacitor](https://capacitorjs.com/). No reescribe nada del sitio: lo reutiliza tal cual.

Estos archivos están preparados, pero **`npm install` y los siguientes pasos hay que correrlos desde tu computadora** (este entorno no tiene acceso al registro de npm).

## 0. Requisitos

- Node.js 18+ y npm (ya los usás para el sitio).
- Para compilar Android: [Android Studio](https://developer.android.com/studio) + JDK 17.
- Para compilar iOS: una Mac con [Xcode](https://apps.apple.com/app/xcode/id497799835) + [CocoaPods](https://cocoapods.org/) (`sudo gem install cocoapods`). Apple no permite compilar iOS desde Windows/Linux.
- Cuentas de desarrollador (solo para publicar en las tiendas, no para probar):
  - Google Play Console: pago único ~US$25.
  - Apple Developer Program: ~US$99/año.

## 1. Instalar dependencias

```bash
cd app
npm install
```

## 2. Generar los proyectos nativos

```bash
npx cap add android
npx cap add ios
```

Esto crea las carpetas `android/` y `ios/` con los proyectos nativos completos. Se generan una sola vez; después solo se sincronizan (paso 4).

## 3. Generar íconos y splash screen

Ya están los archivos base en `assets/` (ícono 1024x1024 y splash 2732x2732 con los colores y el asterisco de la marca). Para que Capacitor los aplique a todos los tamaños que piden Android/iOS:

```bash
npm install @capacitor/assets --save-dev
npx capacitor-assets generate
```

## 4. Sincronizar el sitio web con la app

Cada vez que cambies algo en `../vach-site`, corré:

```bash
npx cap sync
```

Esto copia el sitio actualizado adentro de los proyectos nativos.

## 5. Abrir y probar

```bash
npx cap open android   # abre Android Studio
npx cap open ios       # abre Xcode (solo en Mac)
```

Desde ahí podés correr la app en un emulador o en tu celular conectado por cable, igual que cualquier app nativa.

## 6. Publicar

- **Android**: en Android Studio, `Build > Generate Signed Bundle / APK`, subir el `.aab` a Google Play Console.
- **iOS**: en Xcode, `Product > Archive`, subir con Xcode Organizer o Transporter a App Store Connect.

Ambas tiendas piden: capturas de pantalla, descripción, ícono (ya generado), política de privacidad (una URL — podemos armar una página simple en el sitio si no tenés), y clasificación de contenido.

## Configuración actual

- **App ID**: `com.vach.app` (se puede cambiar antes de la primera publicación; después queda fijo de por vida en cada tienda).
- **Nombre**: VACH*
- **Color de fondo / splash**: `#0A0A0A` (negro de marca)
- **webDir**: `../vach-site` (el sitio se sirve embebido dentro de la app, sin necesitar conexión para la interfaz; las imágenes de la galería sí se cargan según estén alojadas)

## Notificaciones push (opcional, a futuro)

Si más adelante querés notificaciones push nativas (más confiables que las de la PWA, sobre todo en iOS), se agrega con `@capacitor/push-notifications` + Firebase Cloud Messaging (Android) y un certificado APNs (iOS). Es un paso aparte, no incluido todavía.
